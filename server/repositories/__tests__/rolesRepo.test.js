// Role definitions (Part 2/3 of the custom-roles spec): the built-in
// Read_Only identifier's exact spelling/casing, custom role CRUD, name
// uniqueness, and the legacy-mapping migration that must never lose an
// existing mapping's actual permissions. Runs against an isolated temp
// SQLite file (never the real app.sqlite).
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `roles-repo-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run, all } = await import('../../db/index.js')
const rolesRepo = await import('../rolesRepo.js')
const { PAGE_KEYS } = await import('../../auth/pages.js')

function getRoleIdForMapping(id) {
  return all('SELECT role_id FROM role_group_mappings WHERE id = ?', [id])[0]?.role_id
}

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run('DELETE FROM roles')
  run('DELETE FROM role_group_mappings')
})

test('migrateLegacyRoleMappings seeds the built-in roles with the EXACT canonical Read_Only identifier', () => {
  rolesRepo.migrateLegacyRoleMappings()
  const readOnly = rolesRepo.getRole('Read_Only')
  assert.ok(readOnly, 'the built-in role id must be exactly "Read_Only" (case-sensitive)')
  assert.equal(readOnly.isBuiltin, true)
  assert.equal(rolesRepo.getRole('read_only'), null, 'the old lowercase id must not exist as a separate role')
  assert.equal(rolesRepo.getRole('ReadOnly'), null)

  const admin = rolesRepo.getRole('admin')
  assert.ok(admin)
  assert.equal(admin.isBuiltin, true)
  assert.deepEqual(admin.allowedPages.sort(), [...PAGE_KEYS].sort())
  assert.equal(admin.canWrite, true)
})

test('migrateLegacyRoleMappings is idempotent — running it again never duplicates the built-ins or re-seeds over an admin edit', () => {
  rolesRepo.migrateLegacyRoleMappings()
  rolesRepo.updateRole('Read_Only', { description: 'Customized by an admin.' })
  rolesRepo.migrateLegacyRoleMappings()
  const readOnly = rolesRepo.getRole('Read_Only')
  assert.equal(readOnly.description, 'Customized by an admin.', 'a re-run must never overwrite an admin\'s existing edit to a built-in role')
  const allRoles = rolesRepo.listRoles().filter((r) => r.id.toLowerCase().includes('read'))
  assert.equal(allRoles.length, 1, 'no duplicate Read_Only variant may exist')
})

test('migrateLegacyRoleMappings preserves an existing legacy "read_only"-tagged mapping\'s EXACT pages/write — no permissions lost', () => {
  rolesRepo.migrateLegacyRoleMappings() // seeds built-ins with the default (empty-pages) Read_Only first
  const now = new Date().toISOString()
  run(
    `INSERT INTO role_group_mappings (id, security_group_name, security_group_id, role, allowed_pages_json, can_write, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['legacy-1', 'Legacy Read Only Group', 'grp-legacy-1', 'read_only', JSON.stringify(['dashboard', 'users', 'cost']), 0, now, now]
  )
  rolesRepo.migrateLegacyRoleMappings()

  const roleId = getRoleIdForMapping('legacy-1')
  assert.equal(roleId, 'Read_Only', 'a legacy "read_only" tag must resolve to the canonical Read_Only role')
  const readOnly = rolesRepo.getRole('Read_Only')
  assert.deepEqual(readOnly.allowedPages.sort(), ['cost', 'dashboard', 'users'], 'the real historical pages must define Read_Only, not be discarded in favor of the empty seed default')
})

test('a SECOND legacy "read only"-tagged mapping with DIFFERENT pages gets its own role, never silently merged into Read_Only\'s now-different definition', () => {
  rolesRepo.migrateLegacyRoleMappings()
  const now = new Date().toISOString()
  run(
    `INSERT INTO role_group_mappings (id, security_group_name, security_group_id, role, allowed_pages_json, can_write, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    ['legacy-a', 'Group A', 'grp-legacy-a', 'read only', JSON.stringify(['dashboard']), 0, now, now]
  )
  run(
    `INSERT INTO role_group_mappings (id, security_group_name, security_group_id, role, allowed_pages_json, can_write, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    ['legacy-b', 'Group B', 'grp-legacy-b', 'read-only', JSON.stringify(['cost', 'optimization']), 0, now, now]
  )
  rolesRepo.migrateLegacyRoleMappings()

  const roleIdA = getRoleIdForMapping('legacy-a')
  const roleIdB = getRoleIdForMapping('legacy-b')
  assert.equal(roleIdA, 'Read_Only')
  assert.notEqual(roleIdB, 'Read_Only', 'the second, differently-configured mapping must not overwrite or share Read_Only\'s definition')
  const roleB = rolesRepo.getRole(roleIdB)
  assert.deepEqual(roleB.allowedPages.sort(), ['cost', 'optimization'], 'its own original permissions must be fully preserved under its own role')
})

test('createRole derives a stable snake_case id from the display name and rejects duplicates', () => {
  const result = rolesRepo.createRole({ name: 'License Manager', description: 'Can view and manage licensing information.', allowedPages: ['cost', 'users'], canWrite: false })
  assert.equal(result.ok, true)
  assert.equal(result.role.id, 'license_manager')
  assert.equal(result.role.name, 'License Manager')

  const dup = rolesRepo.createRole({ name: 'License Manager', allowedPages: [], canWrite: false })
  assert.equal(dup.ok, false)
  assert.equal(dup.status, 409)
})

test('createRole rejects a blank/whitespace-only name', () => {
  const result = rolesRepo.createRole({ name: '   ', allowedPages: [], canWrite: false })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
})

test('updateRole changes description/pages/write without changing the stable id', () => {
  const { role } = rolesRepo.createRole({ name: 'Department Viewer', allowedPages: ['users'], canWrite: false })
  const updated = rolesRepo.updateRole(role.id, { description: 'Updated description.', allowedPages: ['users', 'products'], canWrite: true })
  assert.equal(updated.id, role.id)
  assert.equal(updated.description, 'Updated description.')
  assert.deepEqual(updated.allowedPages.sort(), ['products', 'users'])
  assert.equal(updated.canWrite, true)
})

test('deleteRole removes a custom role', () => {
  const { role } = rolesRepo.createRole({ name: 'Temporary Role', allowedPages: [], canWrite: false })
  const existed = rolesRepo.deleteRole(role.id)
  assert.equal(existed, true)
  assert.equal(rolesRepo.getRole(role.id), null)
})
