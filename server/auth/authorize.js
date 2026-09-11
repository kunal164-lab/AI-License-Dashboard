// Authorization core (Part 2/9/10/17/18 of the auth spec). AUTHENTICATION
// (who is this person — Entra ID SSO, server/auth/routes.js) is completely
// separate from AUTHORIZATION (what can they access — computed here from
// Microsoft security group membership + the admin-configured role_group_mappings
// table). Nothing in this file ever authenticates anyone; it only answers
// "given an already-authenticated user, what are they allowed to do."
import * as connectionsRepo from '../repositories/connectionsRepo.js'
import * as rbacRepo from '../repositories/rbacRepo.js'
import { findGroupsByDisplayName } from '../services/freshservice/graphGroup.js'
import { checkMemberGroups } from './graphMembership.js'
import { getEffectiveEntraConfig, isGuid } from './config.js'
import { PAGE_KEYS } from './pages.js'
import { resolveVbuForUpn, resolveDashboardView, toPublicViewConfig, effectivePages, applyLocalAdminPreview, computeAllowedVbusForUser } from '../services/dashboardViews.js'

// Access checks reuse this SAME connected Microsoft 365 connection's own
// application permissions — never the signed-in user's own token, and
// never a second Microsoft credential store (Part 13).
function activeMicrosoftConnection() {
  const conns = connectionsRepo.listConnections('microsoft')
  return conns.find((c) => c.status === 'connected') || conns[0] || null
}

// Resolves a security group by display name (or passes a raw Entra GUID
// straight through) to its stable Graph group id — the SAME "never
// silently pick one" rule Freshservice's own group lookup already
// implements, reused here rather than reimplemented (Part 7/8: "if
// multiple groups have the same name, do not silently select one").
export async function resolveGroupId(nameOrId) {
  if (isGuid(nameOrId)) return { id: nameOrId, displayName: nameOrId }
  const msConn = activeMicrosoftConnection()
  if (!msConn) throw new Error('Microsoft 365 connection is required to resolve a security group.')
  const matches = await findGroupsByDisplayName(msConn.credentials, nameOrId)
  if (!matches.length) throw new Error('Security group not found. Check the group name and try again.')
  if (matches.length > 1) {
    const err = new Error('Multiple security groups share this name. Select the correct group.')
    err.multipleGroups = matches
    throw err
  }
  return { id: matches[0].id, displayName: matches[0].displayName }
}

async function resolveBootstrapGroupId() {
  const bootstrapAdminGroup = getEffectiveEntraConfig()?.bootstrapAdminGroup
  if (!bootstrapAdminGroup) return null
  try {
    return (await resolveGroupId(bootstrapAdminGroup)).id
  } catch (e) {
    // A misconfigured/unresolvable bootstrap group must never break normal
    // login for everyone else — it just means the bootstrap safety net
    // doesn't apply this request; real configured mappings still work.
    return null
  }
}

// Pure combination logic — no I/O, so this is the part unit-tested directly
// (server/auth/__tests__/authorize.test.js) without needing to mock
// Microsoft Graph or the database. Everything ABOVE this (resolving which
// groups to check, actually calling Graph) is I/O; everything the result
// depends on lives here: given the mappings that exist, which of their
// groups the user actually matched, and whether the bootstrap group
// matched, what is their combined effective access?
//
// Part 9 — multiple memberships combine ADDITIVELY (pages/canWrite/role are
// unioned across every matched mapping; a second group membership never
// REMOVES access a first one granted). Part 18 — the bootstrap admin
// always applies on top when it matches, regardless of what's configured
// in role_group_mappings.
export function combineEffectiveAccess(mappings, matchedGroupIds, { bootstrapGroupId = null, allPageKeys = PAGE_KEYS } = {}) {
  const isBootstrapAdmin = !!(bootstrapGroupId && matchedGroupIds.includes(bootstrapGroupId))
  const allowedPages = new Set()
  let canWrite = false
  const roles = new Set()
  for (const m of mappings) {
    if (!matchedGroupIds.includes(m.securityGroupId)) continue
    for (const p of m.allowedPages) allowedPages.add(p)
    if (m.canWrite) canWrite = true
    roles.add(m.role)
  }
  if (isBootstrapAdmin) {
    for (const key of allPageKeys) allowedPages.add(key)
    canWrite = true
    roles.add('admin')
  }

  // canWrite implies the "Admin" label regardless of any configured role
  // name — this is the one place administrative precedence is automatic;
  // everything else (which pages, which groups) stays exactly what was
  // explicitly configured (Part 9: "Administrative permissions take
  // precedence over read-only restrictions ONLY where explicitly
  // configured" — here, "explicitly configured" means a mapping's own
  // can_write flag, never inferred from a role label string).
  const role = canWrite ? 'admin' : (roles.size ? Array.from(roles).join(' + ') : null)
  return { role, allowedPages: Array.from(allowedPages), canWrite, isBootstrapAdmin }
}

// The user's EFFECTIVE access, end to end: which mappings exist, which of
// their groups (plus the bootstrap group, if configured) the user actually
// belongs to right now (a live Microsoft Graph check), combined via
// combineEffectiveAccess above. Never caches across users; caller
// (server/auth/middleware.js) decides how long to cache this per-session.
// Adds the VBU-aware Dashboard View resolution (branding/theme/sidebar-page-
// visibility spec) on top of an already-computed RBAC access object — the
// SAME cached object every caller already refreshes on the same cadence
// (server/auth/middleware.js's withAuth), so this never needs a second
// cache. `dashboardView` can only ever NARROW `allowedPages` (via
// `effectiveAllowedPages`), never widen it — see
// server/services/dashboardViews.js#effectivePages.
//
// `selectedDashboardViewId` is ONLY ever meaningful for a local-admin
// session (server/auth/localRoutes.js's dashboard-view selection routes;
// a Microsoft-authenticated caller never has one to pass, see
// server/auth/routes.js's own call site below, which passes nothing) — it
// switches this local admin's OWN preview to a specific configured view
// (server/services/dashboardViews.js#applyLocalAdminPreview) instead of
// the normal VBU-driven resolution, purely for testing/validation. RBAC
// (`access.role`/`canWrite`/`allowedPages`) is never touched by this —
// only vbu/dashboardView/effectiveAllowedPages/isPreviewingVbu change.
function withDashboardView(user, access, selectedDashboardViewId) {
  if (selectedDashboardViewId && user?.authenticationProvider === 'local') {
    const preview = applyLocalAdminPreview(selectedDashboardViewId, access)
    if (preview) return preview
  }
  const vbu = resolveVbuForUpn(user?.upn)
  const view = resolveDashboardView(vbu)
  return {
    ...access,
    vbu,
    // Dashboard View VBU Data Assignment spec — the caller's fully-
    // resolved effective business-data scope (server/auth/vbuScope.js's
    // one true input for every scoping function). For a real user this is
    // never wider than their own single vbu — see
    // computeAllowedVbusForUser's own comment for exactly how the view's
    // configured allowedVbuIds can narrow (never widen) it.
    allowedVbus: computeAllowedVbusForUser(vbu, view),
    dashboardView: toPublicViewConfig(view),
    effectiveAllowedPages: effectivePages(access.allowedPages, view),
    isPreviewingVbu: false,
    selectedDashboardViewId: null
  }
}

export async function computeEffectiveAccess(user, { selectedDashboardViewId } = {}) {
  // A local-admin identity (server/auth/localAuth.js) resolves SYNCHRONOUSLY
  // to full admin access, with no Microsoft Graph/network dependency at all
  // — this is the core resilience property that makes the emergency-
  // recovery account actually reliable when Entra ID/Graph is unconfigured
  // or unreachable (Part 3/9/14 of the local-admin auth spec). It never
  // consults role_group_mappings or the bootstrap group — those only ever
  // apply to Microsoft-authenticated identities. It has no Microsoft
  // identity either, so its VBU is always null — the built-in SSP view,
  // unless it has selected a different one to preview (see above).
  if (user?.authenticationProvider === 'local') {
    return withDashboardView(user, { role: 'admin', allowedPages: [...PAGE_KEYS], canWrite: true, isBootstrapAdmin: false }, selectedDashboardViewId)
  }

  const empty = { role: null, allowedPages: [], canWrite: false, isBootstrapAdmin: false }
  const mappings = rbacRepo.listMappings()
  const bootstrapGroupId = await resolveBootstrapGroupId()

  const groupIdsToCheck = mappings.map((m) => m.securityGroupId)
  if (bootstrapGroupId && !groupIdsToCheck.includes(bootstrapGroupId)) groupIdsToCheck.push(bootstrapGroupId)
  if (!groupIdsToCheck.length) return withDashboardView(user, empty)

  const msConn = activeMicrosoftConnection()
  if (!msConn) return withDashboardView(user, empty)

  const matchedGroupIds = await checkMemberGroups(msConn.credentials, user.oid, groupIdsToCheck)
  const access = combineEffectiveAccess(mappings, matchedGroupIds, { bootstrapGroupId, allPageKeys: PAGE_KEYS })
  return withDashboardView(user, access)
}
