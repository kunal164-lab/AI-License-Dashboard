// Access-management admin API (Part 7 of the auth spec) — configuring
// which Microsoft 365 security group maps to which role/pages/write access.
// Every route here requires requireAdminAccess (write access AND the
// dedicated 'admin-access' page key) — this is the single most sensitive
// surface in the app, since it controls everyone else's authorization.
import express from 'express'
import * as rbacRepo from '../repositories/rbacRepo.js'
import * as rolesRepo from '../repositories/rolesRepo.js'
import * as auditLogRepo from '../repositories/auditLogRepo.js'
import * as localAuth from './localAuth.js'
import * as entraConfig from './entraConfig.js'
import { resolveGroupId } from './authorize.js'
import { requireAdminAccess } from './middleware.js'
import { PAGES, PAGE_KEYS, PAGE_BY_KEY } from './pages.js'
import { neutralizeFormula } from '../../src/reports/formulaSafety.js'

export const adminRouter = express.Router()

adminRouter.get('/api/admin/access/pages', requireAdminAccess, (req, res) => {
  res.json({ pages: PAGES })
})

adminRouter.get('/api/admin/access/mappings', requireAdminAccess, (req, res) => {
  res.json({ mappings: rbacRepo.listMappings() })
})

// Resolves a security group NAME to its stable Graph group id before it's
// ever saved (Part 7/8: "prefer storing the stable Entra group ID
// internally once resolved rather than relying only on display name" —
// and "if multiple groups have the same name, do not silently choose
// one"). The admin UI calls this first; a 409 with `multipleGroups` means
// the administrator must pick one and resubmit with securityGroupId set.
adminRouter.post('/api/admin/access/resolve-group', requireAdminAccess, async (req, res) => {
  const { securityGroupName } = req.body || {}
  if (!securityGroupName) return res.status(400).json({ error: 'securityGroupName is required.' })
  try {
    const resolved = await resolveGroupId(securityGroupName)
    res.json({ securityGroupId: resolved.id, securityGroupName: resolved.displayName })
  } catch (e) {
    if (e.multipleGroups) return res.status(409).json({ error: e.message, multipleGroups: e.multipleGroups })
    res.status(404).json({ error: e.message })
  }
})

// Filters a submitted page list down to real page keys — AND, critically,
// strips any `adminOnly` key (currently just 'admin-access') unless this
// SAME mapping also grants canWrite. pages.js's own registry comment says
// adminOnly pages are "never grantable to a non-admin mapping"; before this
// fix that was only true by coincidence (requireAdminAccess happens to
// check canWrite too), not enforced here — a request could otherwise save
// a read-only mapping that lists 'admin-access' among its allowedPages,
// which is misleading configuration state even though it granted no real
// access. Enforced server-side (not just hidden in the UI) so a direct API
// call can't create that state either.
function validAllowedPages(allowedPages, { canWrite = false } = {}) {
  if (!Array.isArray(allowedPages)) return []
  return allowedPages.filter((p) => {
    const def = PAGE_BY_KEY[p]
    if (!def) return false
    if (def.adminOnly && !canWrite) return false
    return true
  })
}

adminRouter.post('/api/admin/access/mappings', requireAdminAccess, async (req, res) => {
  const { securityGroupName, securityGroupId, roleId } = req.body || {}
  if (!securityGroupName) return res.status(400).json({ error: 'securityGroupName is required.' })
  if (!roleId) return res.status(400).json({ error: 'roleId is required.' })
  if (!rolesRepo.getRole(roleId)) return res.status(400).json({ error: 'That role does not exist.' })

  let resolvedId = securityGroupId || null
  let resolvedName = securityGroupName
  if (!resolvedId) {
    try {
      const resolved = await resolveGroupId(securityGroupName)
      resolvedId = resolved.id
      resolvedName = resolved.displayName
    } catch (e) {
      if (e.multipleGroups) return res.status(409).json({ error: e.message, multipleGroups: e.multipleGroups })
      return res.status(404).json({ error: e.message })
    }
  }
  if (rbacRepo.getMappingByGroupId(resolvedId)) {
    return res.status(409).json({ error: 'This security group already has a role mapping. Edit the existing one instead.' })
  }

  const mapping = rbacRepo.createMapping({ securityGroupName: resolvedName, securityGroupId: resolvedId, roleId })
  auditLogRepo.record({
    eventType: 'rbac_mapping_created', actorUpn: req.user.upn, actorOid: req.user.oid,
    detail: { mappingId: mapping.id, securityGroupName: mapping.securityGroupName, role: mapping.role }
  })
  res.status(201).json({ mapping })
})

adminRouter.put('/api/admin/access/mappings/:id', requireAdminAccess, (req, res) => {
  const existing = rbacRepo.getMapping(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Mapping not found.' })
  const { securityGroupName, roleId } = req.body || {}
  if (roleId !== undefined && !rolesRepo.getRole(roleId)) return res.status(400).json({ error: 'That role does not exist.' })
  const mapping = rbacRepo.updateMapping(req.params.id, { securityGroupName, roleId })
  auditLogRepo.record({
    eventType: 'rbac_mapping_updated', actorUpn: req.user.upn, actorOid: req.user.oid,
    detail: { mappingId: mapping.id, securityGroupName: mapping.securityGroupName, role: mapping.role }
  })
  res.json({ mapping })
})

adminRouter.delete('/api/admin/access/mappings/:id', requireAdminAccess, (req, res) => {
  const existing = rbacRepo.getMapping(req.params.id)
  const ok = rbacRepo.deleteMapping(req.params.id)
  if (existing) {
    auditLogRepo.record({
      eventType: 'rbac_mapping_deleted', actorUpn: req.user.upn, actorOid: req.user.oid,
      detail: { mappingId: existing.id, securityGroupName: existing.securityGroupName }
    })
  }
  res.json({ ok })
})

// Audit events viewer (Part 1 of the audit-retention/VBU spec) — backend-
// enforced range/limit (auditLogRepo.queryEvents clamps both, never trusts
// whatever a caller asks for), admin-only (requireAdminAccess, same as
// every other route in this file — a Read Only user's own valid session
// still 403s here, never just a hidden UI control). Query params are
// optional; omitted entirely falls back to the same defaults the frontend
// itself defaults to (1 day / 5 events) so a bare GET behaves sensibly.
adminRouter.get('/api/admin/access/audit-log', requireAdminAccess, (req, res) => {
  const { events, rangeDays, limit } = auditLogRepo.queryEvents({ rangeDays: req.query.rangeDays, limit: req.query.limit })
  res.json({ events, rangeDays, limit, maxRangeDays: auditLogRepo.MAX_RETENTION_DAYS, maxLimit: auditLogRepo.MAX_LIMIT })
})

// Security-audit fix (CSV formula injection, CWE-1236) — actor_upn and the
// detail JSON blob can carry admin-entered values (a Dashboard View name, a
// VBU/group string, ...), the same directory-/admin-controlled field class
// src/reports/csvReport.js and excelReport.js already neutralize.
function csvEscape(v) {
  if (v === null || v === undefined) return ''
  return '"' + neutralizeFormula(String(v)).replace(/"/g, '""') + '"'
}

// Export obeys the EXACT SAME backend-enforced range/limit boundary as the
// viewer above (queryEvents is the one place either is applied) — never a
// second, more permissive query path. Only real, already-stored fields are
// written; there is no separate "Action"/"Result" categorization to
// duplicate server-side (see AdminAccess.jsx's own AUDIT_EVENT_META for
// that purely cosmetic client-side mapping) — event_type is the precise,
// authoritative value for offline analysis.
adminRouter.get('/api/admin/access/audit-log/export', requireAdminAccess, (req, res) => {
  const { events, rangeDays, limit } = auditLogRepo.queryEvents({ rangeDays: req.query.rangeDays, limit: req.query.limit })
  const header = ['Timestamp', 'Event Type', 'User', 'Details']
  const lines = [header.join(',')]
  for (const e of events) {
    const details = e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : ''
    lines.push([e.at, e.event_type, e.actor_upn || '', details].map(csvEscape).join(','))
  }
  const csv = lines.join('\r\n')
  const filename = `audit-events_${rangeDays}d_${limit}.csv`
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
})

// ---- Role management (Part 3 of the custom-roles spec) — a role owns a
// permission set (allowed pages + write access); role_group_mappings just
// reference one. Built-in roles ('admin', 'Read_Only') are never created/
// deleted through this API — only their description/pages/write are
// editable, same as a custom role. ----
adminRouter.get('/api/admin/access/roles', requireAdminAccess, (req, res) => {
  res.json({ roles: rolesRepo.listRoles() })
})

adminRouter.post('/api/admin/access/roles', requireAdminAccess, (req, res) => {
  const { name, description, allowedPages, canWrite } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Role name is required.' })
  if (String(name).trim().length > 60) return res.status(400).json({ error: 'Role name is too long (60 characters max).' })
  const result = rolesRepo.createRole({
    name, description,
    allowedPages: validAllowedPages(allowedPages, { canWrite: !!canWrite }),
    canWrite: !!canWrite
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  auditLogRepo.record({
    eventType: 'role_created', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid,
    detail: { roleId: result.role.id, name: result.role.name, canWrite: result.role.canWrite, allowedPages: result.role.allowedPages }
  })
  res.status(201).json({ role: result.role })
})

adminRouter.put('/api/admin/access/roles/:id', requireAdminAccess, (req, res) => {
  const existing = rolesRepo.getRole(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Role not found.' })
  const { name, description, allowedPages, canWrite } = req.body || {}
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Role name cannot be blank.' })
  if (name !== undefined && String(name).trim().length > 60) return res.status(400).json({ error: 'Role name is too long (60 characters max).' })
  // A rename must not collide with a DIFFERENT existing role's name.
  if (name !== undefined) {
    const collision = rolesRepo.getRoleByName(name)
    if (collision && collision.id !== existing.id) return res.status(409).json({ error: 'A role with this name already exists.' })
  }
  const effectiveCanWrite = canWrite !== undefined ? !!canWrite : existing.canWrite
  const role = rolesRepo.updateRole(req.params.id, {
    name, description,
    allowedPages: allowedPages !== undefined ? validAllowedPages(allowedPages, { canWrite: effectiveCanWrite }) : undefined,
    canWrite
  })
  auditLogRepo.record({
    eventType: 'role_updated', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid,
    detail: { roleId: role.id, name: role.name, canWrite: role.canWrite, allowedPages: role.allowedPages }
  })
  res.json({ role })
})

adminRouter.delete('/api/admin/access/roles/:id', requireAdminAccess, (req, res) => {
  const existing = rolesRepo.getRole(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Role not found.' })
  if (existing.isBuiltin) return res.status(403).json({ error: 'Built-in roles cannot be deleted.' })
  const inUse = rbacRepo.countMappingsForRole(existing.id)
  if (inUse > 0) {
    return res.status(409).json({ error: 'This role is currently assigned to one or more security groups. Remove or reassign those mappings before deleting the role.' })
  }
  rolesRepo.deleteRole(existing.id)
  auditLogRepo.record({
    eventType: 'role_deleted', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid,
    detail: { roleId: existing.id, name: existing.name }
  })
  res.json({ ok: true })
})

// ---- Local administrator management (Part 10 of the local-admin auth
// spec) — change password, enable/disable, view status. Never returns the
// password hash; requires an already-authenticated admin session (local OR
// Microsoft), same as every other route in this file. ----
adminRouter.get('/api/admin/local-admin', requireAdminAccess, (req, res) => {
  res.json({ localAdmin: localAuth.getLocalAdminInfo() })
})

adminRouter.post('/api/admin/local-admin/password', requireAdminAccess, async (req, res) => {
  const { newPassword } = req.body || {}
  const result = await localAuth.changeLocalAdminPassword(newPassword)
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  auditLogRepo.record({ eventType: 'local_password_changed', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid })
  res.json({ ok: true })
})

adminRouter.put('/api/admin/local-admin/enabled', requireAdminAccess, (req, res) => {
  const { enabled } = req.body || {}
  const result = localAuth.setLocalAdminEnabled(!!enabled)
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  auditLogRepo.record({
    eventType: enabled ? 'local_admin_enabled' : 'local_admin_disabled',
    actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid
  })
  res.json({ localAdmin: localAuth.getLocalAdminInfo() })
})

// ---- Microsoft Entra ID SSO configuration (Part 6/7) — replaces the old
// token-gated setup flow. Saving/testing requires an already-authenticated
// administrator session; the client secret is never returned. ----
adminRouter.get('/api/admin/entra-config', requireAdminAccess, (req, res) => {
  res.json(entraConfig.getSavedEntraConfigSafeView())
})

adminRouter.put('/api/admin/entra-config', requireAdminAccess, (req, res) => {
  const { tenantId, clientId, clientSecret, bootstrapAdminGroup } = req.body || {}
  const result = entraConfig.saveEntraConfig({ tenantId, clientId, clientSecret, bootstrapAdminGroup })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  auditLogRepo.record({
    eventType: 'entra_config_changed', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid,
    detail: { tenantId, clientId, bootstrapAdminGroup }
  })
  res.json(entraConfig.getSavedEntraConfigSafeView())
})

adminRouter.post('/api/admin/entra-config/test', requireAdminAccess, async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body || {}
  // A blank secret in the test form means "test with whatever is already
  // saved" (matches the save behavior above) rather than forcing the
  // administrator to re-enter a secret just to re-run the test.
  let effectiveSecret = clientSecret
  if (!effectiveSecret) {
    const existing = entraConfig.getSavedEntraConfig()
    effectiveSecret = existing?.clientSecret || ''
  }
  const result = await entraConfig.testEntraConfig({ tenantId, clientId, clientSecret: effectiveSecret })
  auditLogRepo.record({
    eventType: 'entra_config_tested', actorUpn: req.user.upn || req.user.username, actorOid: req.user.oid,
    detail: { ok: result.ok, tenantId, clientId }
  })
  res.status(result.ok ? 200 : 400).json(result)
})
