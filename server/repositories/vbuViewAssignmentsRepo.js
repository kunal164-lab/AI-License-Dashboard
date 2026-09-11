// VBU -> Dashboard View assignment storage — the same relationship
// rbacRepo.js's role_group_mappings has to rolesRepo.js's roles: one row =
// "this VBU string gets this dashboard view." Combining/falling back is
// server/services/dashboardViews.js's job, not this file's.
import crypto from 'crypto'
import { run, all, get, persist } from '../db/index.js'

function nowIso() { return new Date().toISOString() }

// VBU values come from the Microsoft directory (microsoft_users.vbu) as
// free text — matched trimmed + case-insensitively, the same convention
// microsoftRepo.js#isSspCompany already uses for company-name matching, so
// "SSP UK & I" and "ssp uk & i " resolve to the same assignment.
function normalizeVbu(vbu) {
  return String(vbu || '').trim().toLowerCase()
}

function rowToAssignment(r) {
  if (!r) return null
  return {
    id: r.id,
    vbu: r.vbu,
    dashboardViewId: r.dashboard_view_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listAssignments() {
  return all('SELECT * FROM vbu_view_assignments ORDER BY vbu COLLATE NOCASE').map(rowToAssignment)
}

export function getAssignment(id) {
  return rowToAssignment(get('SELECT * FROM vbu_view_assignments WHERE id = ?', [id]))
}

export function getAssignmentByVbu(vbu) {
  if (!vbu) return null
  const norm = normalizeVbu(vbu)
  return all('SELECT * FROM vbu_view_assignments').map(rowToAssignment).find((a) => normalizeVbu(a.vbu) === norm) || null
}

export function createAssignment({ vbu, dashboardViewId }) {
  const cleanVbu = String(vbu || '').trim()
  if (!cleanVbu) return { ok: false, status: 400, error: 'VBU is required.' }
  if (getAssignmentByVbu(cleanVbu)) return { ok: false, status: 409, error: 'This VBU already has an assigned dashboard view. Edit the existing assignment instead.' }
  const id = crypto.randomBytes(8).toString('hex')
  const now = nowIso()
  run(
    'INSERT INTO vbu_view_assignments (id, vbu, dashboard_view_id, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, cleanVbu, dashboardViewId, now, now]
  )
  persist()
  return { ok: true, assignment: getAssignment(id) }
}

export function updateAssignment(id, patch) {
  const current = getAssignment(id)
  if (!current) return null
  const vbu = patch.vbu !== undefined ? String(patch.vbu).trim() : current.vbu
  const dashboardViewId = patch.dashboardViewId !== undefined ? patch.dashboardViewId : current.dashboardViewId
  run(
    'UPDATE vbu_view_assignments SET vbu = ?, dashboard_view_id = ?, updated_at = ? WHERE id = ?',
    [vbu, dashboardViewId, nowIso(), id]
  )
  persist()
  return getAssignment(id)
}

export function deleteAssignment(id) {
  const existed = !!get('SELECT id FROM vbu_view_assignments WHERE id = ?', [id])
  run('DELETE FROM vbu_view_assignments WHERE id = ?', [id])
  persist()
  return existed
}
