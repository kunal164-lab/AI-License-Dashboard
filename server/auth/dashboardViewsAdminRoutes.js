// Dashboard Views admin API (VBU-aware branding/theme/sidebar spec) —
// configuring the three (or more) Dashboard Views and which VBU gets which
// one. Mirrors server/auth/adminRoutes.js exactly: every route requires
// requireAdminAccess, every mutation writes an audit log entry.
import express from 'express'
import * as dashboardViewsRepo from '../repositories/dashboardViewsRepo.js'
import * as auditLogRepo from '../repositories/auditLogRepo.js'
import * as microsoftRepo from '../repositories/microsoftRepo.js'
import { requireAdminAccess } from './middleware.js'
import { PAGE_BY_KEY } from './pages.js'
import { belongsToVbu } from './vbuScope.js'
import { DEFAULT_VIEW_ID } from '../services/dashboardViews.js'
import { LOGO_KEYS, THEME_TOKEN_KEYS, HEADER_GRAPHIC_KEYS, HEADER_DECORATION_KEYS, SIDEBAR_DECORATION_KEYS } from '../../src/utils/dashboardViewAssets.js'

export const dashboardViewsAdminRouter = express.Router()

function actorUpn(req) { return req.user.upn || req.user.username }

// Same filtering rule adminRoutes.js#validAllowedPages already applies to
// roles — a Dashboard View's page list is also never allowed to invent a
// page key the central registry doesn't define. Unlike roles, this list
// has no canWrite/adminOnly distinction of its own: a view can list an
// adminOnly key, but that grants nothing on its own (RBAC still decides —
// see server/services/dashboardViews.js#effectivePages, which intersects).
function validPages(pages) {
  if (!Array.isArray(pages)) return []
  return pages.filter((p) => !!PAGE_BY_KEY[p])
}

function validLogoKey(logoKey) {
  return LOGO_KEYS.includes(logoKey) ? logoKey : undefined
}

// Dashboard View VBU Data Assignment spec — a view's allowedVbuIds may
// only ever contain REAL, currently-known VBU values (the same list the
// admin UI's own multi-select is populated from, GET .../vbus below),
// never an arbitrary/fabricated string an admin's request happened to
// submit. Deduplicated, trimmed, blanks dropped.
function validAllowedVbuIds(vbuIds) {
  if (!Array.isArray(vbuIds)) return []
  const known = new Set(microsoftRepo.listDistinctVbus())
  const cleaned = vbuIds.map((v) => String(v || '').trim()).filter(Boolean)
  return Array.from(new Set(cleaned)).filter((v) => known.has(v))
}

// A NON-DEFAULT view's allowedVbuIds is the ONE place both branding
// resolution (server/services/dashboardViews.js#resolveDashboardView) and
// business-data scope (computeAllowedVbusForUser) read from — so the same
// VBU must never be claimed by two non-default views at once, the same
// guarantee the old, separate vbu_view_assignments table enforced with a
// DB-level UNIQUE column. Without this, resolveDashboardView's ordering
// would silently and arbitrarily pick one of the claiming views for
// login-time branding.
//
// The DEFAULT view (SSP Central Services) is exempt on both sides of this
// check — confirmed live against the real database, an administrator had
// already configured it with a broader allowedVbuIds (several VBUs,
// including ones ALSO claimed by SSP UK & Ireland/Worldwide) purely for a
// wider business-data aggregate, never as a branding claim —
// resolveDashboardView's own comment explains why it excludes the default
// view from the claim search for the same reason. So: (1) the default
// view's own allowedVbuIds can freely overlap with anything and is never
// itself conflict-checked, and (2) a non-default view's allowedVbuIds is
// only checked against OTHER non-default views, never against the
// default's.
function vbusClaimedByOtherViews(excludeViewId) {
  const claimed = new Map()
  for (const v of dashboardViewsRepo.listViews()) {
    if (v.id === excludeViewId || v.id === DEFAULT_VIEW_ID) continue
    for (const vbu of v.allowedVbuIds || []) claimed.set(vbu, v.displayName)
  }
  return claimed
}

function findVbuConflicts(vbuIds, excludeViewId) {
  if (excludeViewId === DEFAULT_VIEW_ID) return []
  const claimed = vbusClaimedByOtherViews(excludeViewId)
  const conflicts = []
  for (const vbu of vbuIds) {
    for (const [claimedVbu, viewName] of claimed) {
      if (belongsToVbu(claimedVbu, vbu)) conflicts.push({ vbu, viewName })
    }
  }
  return conflicts
}

// Sparse theme override — only the fixed, known token keys are ever
// stored; an unrecognized key (typo, or an attempt to smuggle in something
// unexpected) is silently dropped rather than persisted verbatim.
// headerGraphicKey/sidebarTagline are NOT CSS color tokens (they don't
// apply as document.documentElement custom properties, see
// src/utils/theme.js) — they're stored in the same theme JSON blob purely
// for convenience (no separate DB column needed), so they're validated
// here alongside the color tokens rather than silently stripped.
function validTheme(theme) {
  if (!theme || typeof theme !== 'object') return {}
  const out = {}
  for (const key of THEME_TOKEN_KEYS) {
    if (typeof theme[key] === 'string' && theme[key]) out[key] = theme[key]
  }
  if (HEADER_GRAPHIC_KEYS.includes(theme.headerGraphicKey)) out.headerGraphicKey = theme.headerGraphicKey
  if (HEADER_DECORATION_KEYS.includes(theme.headerDecorationKey)) out.headerDecorationKey = theme.headerDecorationKey
  if (SIDEBAR_DECORATION_KEYS.includes(theme.sidebarDecorationKey)) out.sidebarDecorationKey = theme.sidebarDecorationKey
  if (typeof theme.sidebarTagline === 'string' && theme.sidebarTagline.trim() && theme.sidebarTagline.length <= 120) {
    out.sidebarTagline = theme.sidebarTagline.trim()
  }
  // Internal bookkeeping only (server/services/dashboardViews.js's
  // per-view CONFIG_VERSION constants) — not a real theme choice, never
  // shown/editable in the admin UI, but must round-trip through a save
  // unchanged: the admin form's state is seeded from the existing theme
  // object and only mutates the fields it actually has controls for (see
  // ViewForm in AdminDashboardViews.jsx), so whatever version the server
  // last reported comes back unchanged on save — this is what lets a real
  // administrator's post-correction edit be recognized as "already at the
  // shipped version" and never silently overwritten by a later restart.
  if (Number.isFinite(Number(theme._configVersion))) out._configVersion = Number(theme._configVersion)
  return out
}

dashboardViewsAdminRouter.get('/api/admin/dashboard-views', requireAdminAccess, (req, res) => {
  res.json({ views: dashboardViewsRepo.listViews() })
})

// The authoritative VBU list (Dashboard View VBU Data Assignment spec,
// Part A: "DO NOT hardcode a fixed list of VBUs") — every distinct real
// value currently on record, for the admin UI's "VBU Data" multi-select.
dashboardViewsAdminRouter.get('/api/admin/dashboard-views/vbus', requireAdminAccess, (req, res) => {
  res.json({ vbus: microsoftRepo.listDistinctVbus() })
})

dashboardViewsAdminRouter.post('/api/admin/dashboard-views', requireAdminAccess, (req, res) => {
  const { displayName, description, logoKey, theme, pages, allowedVbuIds } = req.body || {}
  if (!displayName || !String(displayName).trim()) return res.status(400).json({ error: 'Display name is required.' })
  const cleanedVbuIds = validAllowedVbuIds(allowedVbuIds)
  const conflicts = findVbuConflicts(cleanedVbuIds, null)
  if (conflicts.length) {
    return res.status(409).json({ error: `${conflicts[0].vbu} is already assigned to "${conflicts[0].viewName}". Remove it there first.` })
  }
  const result = dashboardViewsRepo.createView({
    displayName, description,
    logoKey: validLogoKey(logoKey),
    theme: validTheme(theme),
    pages: validPages(pages),
    allowedVbuIds: cleanedVbuIds
  })
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  auditLogRepo.record({
    eventType: 'dashboard_view_created', actorUpn: actorUpn(req), actorOid: req.user.oid,
    detail: { viewId: result.view.id, displayName: result.view.displayName }
  })
  res.status(201).json({ view: result.view })
})

dashboardViewsAdminRouter.put('/api/admin/dashboard-views/:id', requireAdminAccess, (req, res) => {
  const existing = dashboardViewsRepo.getView(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Dashboard view not found.' })
  const { displayName, description, logoKey, theme, pages, allowedVbuIds, isActive } = req.body || {}
  if (displayName !== undefined && !String(displayName).trim()) return res.status(400).json({ error: 'Display name cannot be blank.' })
  let cleanedVbuIds
  if (allowedVbuIds !== undefined) {
    cleanedVbuIds = validAllowedVbuIds(allowedVbuIds)
    const conflicts = findVbuConflicts(cleanedVbuIds, req.params.id)
    if (conflicts.length) {
      return res.status(409).json({ error: `${conflicts[0].vbu} is already assigned to "${conflicts[0].viewName}". Remove it there first.` })
    }
  }
  const view = dashboardViewsRepo.updateView(req.params.id, {
    displayName, description,
    logoKey: logoKey !== undefined ? validLogoKey(logoKey) : undefined,
    theme: theme !== undefined ? validTheme(theme) : undefined,
    pages: pages !== undefined ? validPages(pages) : undefined,
    allowedVbuIds: cleanedVbuIds,
    isActive
  })
  auditLogRepo.record({
    eventType: 'dashboard_view_updated', actorUpn: actorUpn(req), actorOid: req.user.oid,
    detail: { viewId: view.id, displayName: view.displayName }
  })
  res.json({ view })
})

dashboardViewsAdminRouter.delete('/api/admin/dashboard-views/:id', requireAdminAccess, (req, res) => {
  const existing = dashboardViewsRepo.getView(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Dashboard view not found.' })
  if (existing.isBuiltin) return res.status(403).json({ error: 'Built-in dashboard views cannot be deleted.' })
  // A view's own allowedVbuIds IS its VBU assignment now (see
  // resolveDashboardView) — no separate assignments table to check.
  if ((existing.allowedVbuIds || []).length > 0) {
    return res.status(409).json({ error: 'This dashboard view is currently assigned to one or more VBUs. Remove them from "VBU Data" first.' })
  }
  dashboardViewsRepo.deleteView(existing.id)
  auditLogRepo.record({
    eventType: 'dashboard_view_deleted', actorUpn: actorUpn(req), actorOid: req.user.oid,
    detail: { viewId: existing.id, displayName: existing.displayName }
  })
  res.json({ ok: true })
})
