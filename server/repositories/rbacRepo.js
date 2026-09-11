// Role/Group/Page mapping storage (Part 2/5/7 of the auth spec, Part 3 of
// the custom-roles spec) — the single source of authorization truth. One
// row = "members of this Entra security group get this role" — the role
// itself (server/repositories/rolesRepo.js) owns the actual permission set
// (allowed pages + write access); this file only owns WHICH group maps to
// WHICH role. Combining multiple matched mappings is server/auth/
// authorize.js's job, not this file's.
import crypto from 'crypto'
import { run, all, get, persist } from '../db/index.js'
import * as rolesRepo from './rolesRepo.js'

function nowIso() { return new Date().toISOString() }

// The shape every consumer (server/auth/authorize.js#combineEffectiveAccess,
// the admin UI) already expects: role/allowedPages/canWrite as plain
// properties on the mapping, resolved here from the referenced role so
// combineEffectiveAccess itself never needs to know roles exist as a
// separate concept — it just sees "this mapping's role/pages/write",
// exactly like before this table existed.
function rowToMapping(r, rolesById) {
  if (!r) return null
  const role = rolesById.get(r.role_id) || null
  return {
    id: r.id,
    securityGroupName: r.security_group_name,
    securityGroupId: r.security_group_id,
    roleId: r.role_id,
    role: role ? role.id : null,
    roleName: role ? role.name : null,
    allowedPages: role ? role.allowedPages : [],
    canWrite: role ? role.canWrite : false,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function rolesById() {
  return new Map(rolesRepo.listRoles().map((r) => [r.id, r]))
}

export function listMappings() {
  const roles = rolesById()
  return all('SELECT * FROM role_group_mappings ORDER BY created_at').map((r) => rowToMapping(r, roles))
}

export function getMapping(id) {
  return rowToMapping(get('SELECT * FROM role_group_mappings WHERE id = ?', [id]), rolesById())
}

export function getMappingByGroupId(securityGroupId) {
  return rowToMapping(get('SELECT * FROM role_group_mappings WHERE security_group_id = ?', [securityGroupId]), rolesById())
}

// How many mappings currently reference a given role — used by the role
// deletion route to refuse deleting a role that's still in use rather than
// leaving a mapping pointing at nothing.
export function countMappingsForRole(roleId) {
  return get('SELECT COUNT(*) as c FROM role_group_mappings WHERE role_id = ?', [roleId])?.c || 0
}

export function createMapping({ securityGroupName, securityGroupId, roleId }) {
  const id = crypto.randomBytes(8).toString('hex')
  const now = nowIso()
  run(
    // The legacy `role` column is kept in sync with role_id (both store the
    // same id string) purely so it never sits at a misleading stale value —
    // nothing reads it anymore; role_id is authoritative (see rolesRepo.js).
    `INSERT INTO role_group_mappings (id, security_group_name, security_group_id, role, role_id, allowed_pages_json, can_write, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, securityGroupName, securityGroupId, roleId, roleId, '[]', 0, now, now]
  )
  persist()
  return getMapping(id)
}

// patch may include: securityGroupName, roleId
export function updateMapping(id, patch) {
  const current = get('SELECT * FROM role_group_mappings WHERE id = ?', [id])
  if (!current) return null
  const securityGroupName = patch.securityGroupName !== undefined ? patch.securityGroupName : current.security_group_name
  const roleId = patch.roleId !== undefined ? patch.roleId : current.role_id
  run(
    `UPDATE role_group_mappings SET security_group_name = ?, role = ?, role_id = ?, updated_at = ? WHERE id = ?`,
    [securityGroupName, roleId, roleId, nowIso(), id]
  )
  persist()
  return getMapping(id)
}

export function deleteMapping(id) {
  const existed = !!get('SELECT id FROM role_group_mappings WHERE id = ?', [id])
  run('DELETE FROM role_group_mappings WHERE id = ?', [id])
  persist()
  return existed
}
