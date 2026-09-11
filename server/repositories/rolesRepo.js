// Role definitions (Part 3 of the custom-roles spec) — a role OWNS a
// permission set (allowed pages + write access). server/repositories/
// rbacRepo.js's role_group_mappings reference a role by id; this file never
// touches mappings itself (see migrateLegacyRoleMappings below for the one
// exception — a one-time startup backfill that has to touch both tables to
// move existing data onto the new model).
import { run, all, get, persist } from '../db/index.js'
import { PAGE_KEYS } from '../auth/pages.js'

function nowIso() { return new Date().toISOString() }

function slugify(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function rowToRole(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    allowedPages: JSON.parse(r.allowed_pages_json || '[]'),
    canWrite: !!r.can_write,
    isBuiltin: !!r.is_builtin,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

// Built-ins first, then alphabetical by name — matches the "Built-in Roles
// / Custom Roles" grouping the Administration page renders.
export function listRoles() {
  return all('SELECT * FROM roles ORDER BY is_builtin DESC, name COLLATE NOCASE').map(rowToRole)
}

export function getRole(id) {
  return rowToRole(get('SELECT * FROM roles WHERE id = ?', [id]))
}

export function getRoleByName(name) {
  return rowToRole(get('SELECT * FROM roles WHERE lower(name) = lower(?)', [String(name || '').trim()]))
}

// Custom roles only (Part 3) — the id is derived once from the name and
// never changes afterward, even if the name is later edited (stable
// identifiers, editable display names — existing mappings/audit history
// keep referencing the same id).
export function createRole({ name, description, allowedPages, canWrite }) {
  const cleanName = String(name || '').trim()
  const id = slugify(cleanName)
  if (!id) return { ok: false, status: 400, error: 'Role name is required.' }
  if (get('SELECT id FROM roles WHERE id = ?', [id]) || getRoleByName(cleanName)) {
    return { ok: false, status: 409, error: 'A role with this name already exists.' }
  }
  const now = nowIso()
  run(
    `INSERT INTO roles (id, name, description, allowed_pages_json, can_write, is_builtin, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)`,
    [id, cleanName, description || '', JSON.stringify(allowedPages || []), canWrite ? 1 : 0, now, now]
  )
  persist()
  return { ok: true, role: getRole(id) }
}

// name/description/allowedPages/canWrite are all editable — including on a
// built-in role (an admin may reasonably want to adjust Read Only's default
// pages) — id/isBuiltin are never part of the patch and can't change here.
export function updateRole(id, patch) {
  const current = getRole(id)
  if (!current) return null
  const name = patch.name !== undefined ? String(patch.name).trim() : current.name
  const description = patch.description !== undefined ? patch.description : current.description
  const allowedPages = patch.allowedPages !== undefined ? patch.allowedPages : current.allowedPages
  const canWrite = patch.canWrite !== undefined ? patch.canWrite : current.canWrite
  run(
    `UPDATE roles SET name = ?, description = ?, allowed_pages_json = ?, can_write = ?, updated_at = ? WHERE id = ?`,
    [name, description, JSON.stringify(allowedPages), canWrite ? 1 : 0, nowIso(), id]
  )
  persist()
  return getRole(id)
}

export function deleteRole(id) {
  const existed = !!get('SELECT id FROM roles WHERE id = ?', [id])
  run('DELETE FROM roles WHERE id = ?', [id])
  persist()
  return existed
}

// ---------------------------------------------------------------------------
// Startup migration (called once from server/index.js, after initDb()) —
// idempotent and safe to run on every boot. Two jobs:
//   1. Ensure the built-in roles exist (fixed ids: 'admin' and 'Read_Only').
//   2. Point every pre-existing role_group_mappings row (role_id IS NULL —
//      i.e. created before this table existed) at a real role, creating one
//      from that row's OWN existing role/allowed_pages_json/can_write
//      columns when needed, so no mapping's actual effective permissions
//      change as a side effect of migrating.
// ---------------------------------------------------------------------------
const LEGACY_READ_ONLY_TAGS = new Set(['read_only', 'read only', 'readonly', 'read-only'])

export function migrateLegacyRoleMappings() {
  const now = nowIso()
  if (!get('SELECT id FROM roles WHERE id = ?', ['admin'])) {
    run(
      `INSERT INTO roles (id, name, description, allowed_pages_json, can_write, is_builtin, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)`,
      ['admin', 'Admin', 'Full access to every page, with write permissions.', JSON.stringify(PAGE_KEYS), 1, now, now]
    )
  } else {
    // The built-in Admin role's definition ("all pages + write") is fixed
    // by convention (see the comment on roleId = 'admin' below) — but a
    // page key added to the central registry (server/auth/pages.js) AFTER
    // this row was first created would otherwise never reach an
    // already-existing database's Admin role. Self-healing on every boot
    // keeps it in sync with PAGE_KEYS without a one-off migration per new
    // page (e.g. the VBU-aware Dashboard Views admin screen).
    run('UPDATE roles SET allowed_pages_json = ? WHERE id = ?', [JSON.stringify(PAGE_KEYS), 'admin'])
  }
  if (!get('SELECT id FROM roles WHERE id = ?', ['Read_Only'])) {
    run(
      `INSERT INTO roles (id, name, description, allowed_pages_json, can_write, is_builtin, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)`,
      ['Read_Only', 'Read Only', 'View-only access — no write permissions.', '[]', 0, now, now]
    )
  }

  const legacyRows = all('SELECT * FROM role_group_mappings WHERE role_id IS NULL')
  if (!legacyRows.length) return

  let readOnlyDefinedFromLegacyData = false
  let customCounter = 0

  for (const row of legacyRows) {
    const pages = JSON.parse(row.allowed_pages_json || '[]')
    const pagesJson = JSON.stringify(pages)
    const canWrite = !!row.can_write
    const legacyTag = String(row.role || '').trim().toLowerCase()
    let roleId

    if (legacyTag === 'admin') {
      // The Admin role's definition (all pages + write) is fixed by
      // convention — never overwritten from a legacy row.
      roleId = 'admin'
    } else if (LEGACY_READ_ONLY_TAGS.has(legacyTag) && !readOnlyDefinedFromLegacyData) {
      // The FIRST read-only-tagged legacy mapping gets to define the real
      // Read_Only role's permissions (real historical config is more
      // authoritative than this migration's own empty-pages seed default)
      run('UPDATE roles SET allowed_pages_json = ?, can_write = ?, updated_at = ? WHERE id = ?', [pagesJson, canWrite ? 1 : 0, now, 'Read_Only'])
      roleId = 'Read_Only'
      readOnlyDefinedFromLegacyData = true
    } else {
      // A genuinely custom legacy tag, OR a second read-only-tagged
      // mapping whose permissions differ from the first (which already
      // claimed Read_Only) — reuse a role with the exact same permissions
      // if one already exists (including Read_Only/Admin themselves),
      // otherwise create a new custom role so this mapping's permissions
      // are preserved exactly rather than merged into an unrelated role.
      const match = all('SELECT * FROM roles WHERE allowed_pages_json = ? AND can_write = ?', [pagesJson, canWrite ? 1 : 0])[0]
      if (match) {
        roleId = match.id
      } else {
        customCounter += 1
        const baseName = row.role && row.role.trim() ? row.role.trim() : `Migrated Role ${customCounter}`
        let id = slugify(baseName) || `migrated_role_${customCounter}`
        while (get('SELECT id FROM roles WHERE id = ?', [id])) id = `${id}_${customCounter}`
        run(
          `INSERT INTO roles (id, name, description, allowed_pages_json, can_write, is_builtin, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)`,
          [id, baseName, 'Migrated automatically from an existing role/group mapping.', pagesJson, canWrite ? 1 : 0, now, now]
        )
        roleId = id
      }
    }
    run('UPDATE role_group_mappings SET role_id = ? WHERE id = ?', [roleId, row.id])
  }
  persist()
}
