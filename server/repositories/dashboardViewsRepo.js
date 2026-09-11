// Dashboard View definitions (VBU-aware branding/theme/sidebar spec) — a
// view OWNS a display configuration (logo/theme/visible pages); a
// vbu_view_assignments row (see vbuViewAssignmentsRepo.js) just references
// one by id, the same "named config" + "assignment" split rolesRepo.js/
// rbacRepo.js already use for roles/role_group_mappings.
import { run, all, get, persist } from '../db/index.js'

function nowIso() { return new Date().toISOString() }

function rowToView(r) {
  if (!r) return null
  return {
    id: r.id,
    displayName: r.display_name,
    description: r.description || '',
    logoKey: r.logo_key || 'ssp',
    theme: JSON.parse(r.theme_json || '{}'),
    pages: JSON.parse(r.pages_json || '[]'),
    dashboard: JSON.parse(r.dashboard_json || '{}'),
    allowedVbuIds: JSON.parse(r.allowed_vbus_json || '[]'),
    isActive: !!r.is_active,
    isBuiltin: !!r.is_builtin,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

// Built-ins first, then alphabetical by display name — matches the
// existing Roles listing convention (rolesRepo.js#listRoles).
export function listViews() {
  return all('SELECT * FROM dashboard_views ORDER BY is_builtin DESC, display_name COLLATE NOCASE').map(rowToView)
}

export function listActiveViews() {
  return all('SELECT * FROM dashboard_views WHERE is_active = 1 ORDER BY is_builtin DESC, display_name COLLATE NOCASE').map(rowToView)
}

export function getView(id) {
  return rowToView(get('SELECT * FROM dashboard_views WHERE id = ?', [id]))
}

// Only used by the one-time startup seed (seedDefaultDashboardViews) to
// create the three built-in views with their fixed, stable ids — never
// exposed through the admin API (a real admin-created view always gets a
// generated id, see createView below).
export function createViewWithId({ id, displayName, description, logoKey, theme, pages, dashboard, allowedVbuIds, isBuiltin }) {
  const now = nowIso()
  run(
    `INSERT INTO dashboard_views (id, display_name, description, logo_key, theme_json, pages_json, dashboard_json, allowed_vbus_json, is_active, is_builtin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`,
    [id, displayName, description || '', logoKey || 'ssp', JSON.stringify(theme || {}), JSON.stringify(pages || []), JSON.stringify(dashboard || {}), JSON.stringify(allowedVbuIds || []), isBuiltin ? 1 : 0, now, now]
  )
  persist()
  return getView(id)
}

function slugify(name) {
  return String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function createView({ displayName, description, logoKey, theme, pages, allowedVbuIds }) {
  const cleanName = String(displayName || '').trim()
  if (!cleanName) return { ok: false, status: 400, error: 'Display name is required.' }
  let id = slugify(cleanName)
  if (!id) return { ok: false, status: 400, error: 'Display name is required.' }
  if (get('SELECT id FROM dashboard_views WHERE id = ?', [id])) {
    // Same "stable id, never silently collide" defense rolesRepo.createRole
    // takes — append a numeric suffix rather than reject outright, since two
    // views with similar names (e.g. "SSP UK" and "SSP UK 2") are legitimate.
    let n = 2
    while (get('SELECT id FROM dashboard_views WHERE id = ?', [`${id}_${n}`])) n += 1
    id = `${id}_${n}`
  }
  const now = nowIso()
  run(
    `INSERT INTO dashboard_views (id, display_name, description, logo_key, theme_json, pages_json, dashboard_json, allowed_vbus_json, is_active, is_builtin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'{}',?,1,0,?,?)`,
    [id, cleanName, description || '', logoKey || 'ssp', JSON.stringify(theme || {}), JSON.stringify(pages || []), JSON.stringify(allowedVbuIds || []), now, now]
  )
  persist()
  return { ok: true, view: getView(id) }
}

export function updateView(id, patch) {
  const current = getView(id)
  if (!current) return null
  const displayName = patch.displayName !== undefined ? String(patch.displayName).trim() : current.displayName
  const description = patch.description !== undefined ? patch.description : current.description
  const logoKey = patch.logoKey !== undefined ? patch.logoKey : current.logoKey
  const theme = patch.theme !== undefined ? patch.theme : current.theme
  const pages = patch.pages !== undefined ? patch.pages : current.pages
  const allowedVbuIds = patch.allowedVbuIds !== undefined ? patch.allowedVbuIds : current.allowedVbuIds
  const isActive = patch.isActive !== undefined ? !!patch.isActive : current.isActive
  run(
    `UPDATE dashboard_views SET display_name = ?, description = ?, logo_key = ?, theme_json = ?, pages_json = ?, allowed_vbus_json = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    [displayName, description, logoKey, JSON.stringify(theme), JSON.stringify(pages), JSON.stringify(allowedVbuIds || []), isActive ? 1 : 0, nowIso(), id]
  )
  persist()
  return getView(id)
}

export function deleteView(id) {
  const existed = !!get('SELECT id FROM dashboard_views WHERE id = ?', [id])
  run('DELETE FROM dashboard_views WHERE id = ?', [id])
  persist()
  return existed
}
