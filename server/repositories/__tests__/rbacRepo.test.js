// Real-database round-trip test for the role/group mapping store (Part 25:
// "role resolution"; Part 3 of the custom-roles spec: mappings now
// reference a role by id rather than owning pages/write directly). Runs
// against an isolated temp SQLite file (never the real app.sqlite) so it's
// safe to run any time without touching real configuration.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `rbac-repo-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb } = await import('../../db/index.js')
const rbacRepo = await import('../rbacRepo.js')
const rolesRepo = await import('../rolesRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })

// Each call must get its own uniquely-named role (createRole rejects a
// duplicate name with a 409) — these tests intentionally build on top of
// each other's mappings within the same DB/file, so a fixed shared name
// would collide the second time any helper is called.
let roleCounter = 0
const adminRole = () => rolesRepo.createRole({ name: `Test Admin Role ${++roleCounter}`, allowedPages: ['dashboard', 'cost', 'admin-access'], canWrite: true }).role
const readOnlyRole = () => rolesRepo.createRole({ name: `Test Read Role ${++roleCounter}`, allowedPages: ['dashboard'], canWrite: false }).role

test('createMapping stores and round-trips every field, resolving pages/write from the referenced role', () => {
  const role = adminRole()
  const created = rbacRepo.createMapping({ securityGroupName: 'IT Dashboard Admins', securityGroupId: 'grp-1', roleId: role.id })
  assert.ok(created.id)
  assert.equal(created.securityGroupName, 'IT Dashboard Admins')
  assert.equal(created.securityGroupId, 'grp-1')
  assert.equal(created.role, role.id)
  assert.deepEqual([...created.allowedPages].sort(), ['admin-access', 'cost', 'dashboard'])
  assert.equal(created.canWrite, true)

  const fetched = rbacRepo.getMapping(created.id)
  assert.deepEqual(fetched, created)

  const byGroup = rbacRepo.getMappingByGroupId('grp-1')
  assert.equal(byGroup.id, created.id)
})

test('updateMapping can reassign the role, changing the resolved pages/write accordingly', () => {
  const roleA = readOnlyRole()
  const roleB = rolesRepo.createRole({ name: 'Reassigned Role', allowedPages: ['dashboard', 'reports'], canWrite: false }).role
  const created = rbacRepo.createMapping({ securityGroupName: 'Read Only Group', securityGroupId: 'grp-2', roleId: roleA.id })
  const updated = rbacRepo.updateMapping(created.id, { roleId: roleB.id })
  assert.equal(updated.role, roleB.id)
  assert.deepEqual(updated.allowedPages.sort(), ['dashboard', 'reports'])
})

test('updateMapping without a roleId leaves the existing role (and its resolved permissions) unchanged', () => {
  const role = readOnlyRole()
  const created = rbacRepo.createMapping({ securityGroupName: 'Unchanged Group', securityGroupId: 'grp-2b', roleId: role.id })
  const updated = rbacRepo.updateMapping(created.id, { securityGroupName: 'Renamed Group' })
  assert.equal(updated.securityGroupName, 'Renamed Group')
  assert.equal(updated.role, role.id, 'role must be unchanged when the patch does not include roleId')
  assert.equal(updated.canWrite, false)
})

test('deleteMapping removes the row and getMapping/getMappingByGroupId return null afterward', () => {
  const role = readOnlyRole()
  const created = rbacRepo.createMapping({ securityGroupName: 'Temp Group', securityGroupId: 'grp-3', roleId: role.id })
  const ok = rbacRepo.deleteMapping(created.id)
  assert.equal(ok, true)
  assert.equal(rbacRepo.getMapping(created.id), null)
  assert.equal(rbacRepo.getMappingByGroupId('grp-3'), null)
})

test('listMappings returns every mapping created so far, in creation order', () => {
  const all = rbacRepo.listMappings()
  const names = all.map((m) => m.securityGroupName)
  assert.ok(names.includes('IT Dashboard Admins'))
  assert.ok(names.includes('Renamed Group'))
  assert.ok(!names.includes('Temp Group'), 'the deleted mapping must not still be listed')
})

test('countMappingsForRole reflects how many mappings currently reference a role', () => {
  const role = rolesRepo.createRole({ name: 'Counted Role', allowedPages: [], canWrite: false }).role
  assert.equal(rbacRepo.countMappingsForRole(role.id), 0)
  const m1 = rbacRepo.createMapping({ securityGroupName: 'Group A', securityGroupId: 'grp-count-a', roleId: role.id })
  assert.equal(rbacRepo.countMappingsForRole(role.id), 1)
  rbacRepo.createMapping({ securityGroupName: 'Group B', securityGroupId: 'grp-count-b', roleId: role.id })
  assert.equal(rbacRepo.countMappingsForRole(role.id), 2)
  rbacRepo.deleteMapping(m1.id)
  assert.equal(rbacRepo.countMappingsForRole(role.id), 1)
})
