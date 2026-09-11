// Real backend-enforced VBU data isolation — the sibling of
// dashboardAccess.js, but for row-level BUSINESS data rather than
// page/connection-level RBAC. Before this existed, VBU was purely a
// reporting/identity dimension (see server/services/dashboardViews.js's
// own former scope-boundary note) — every business API returned the same
// company-wide dataset to everyone regardless of their own VBU. These
// functions are the one place that changes: each takes already-fetched
// data plus `req.access` (already carries the caller's own resolved
// `vbu` and `canWrite`, see server/auth/authorize.js) and returns the
// caller's own-VBU-only subset.
//
// Deliberately GENERIC — there is no "if vbu === 'SSP UK & Ireland'"
// anywhere. `access.allowedVbus` (Dashboard View VBU Data Assignment spec)
// is the caller's fully-resolved effective scope: for almost every real
// user it's a single-entry array (their own vbu — a Dashboard View can
// only ever NARROW that, never widen it, see
// server/services/dashboardViews.js#computeAllowedVbusForUser), and for a
// local administrator previewing a multi-VBU view (e.g. SSP Central
// Services) it can genuinely be several. Whatever is in that array is the
// only data a caller sees. Admins (`access.canWrite`, the one existing,
// already-established "is this user an admin" check in this codebase —
// see server/auth/authorize.js's own comment on why canWrite always
// implies the admin role) bypass every function below entirely and see
// the full, unscoped dataset, matching "Admins remain global."
//
// A record's OWN `vbu` field is never trustworthy — every provider
// normalizer leaves it null (VBU is a Microsoft-365-exclusive
// authoritative field, see src/utils/userModel.js#AUTHORITATIVE_FIELDS).
// So a flat record's ownership is only ever resolvable by looking up its
// `email` in the Microsoft directory Map (buildMicrosoftDirectory) — a
// record with no directory match is EXCLUDED for a non-admin (never
// assumed to be theirs) rather than shown.
//
// A non-admin with NO resolvable VBU at all never reaches these functions
// in practice — server/auth/middleware.js#withAuth now blocks that case
// at the door with a clear "contact your administrator" 403, the same
// existing default-deny mechanism every other access denial already uses.
// The `!access?.allowedVbus?.length` branches below are still real,
// defense-in-depth: fail closed (empty), never fail open, if a caller with
// no accessible VBU somehow reaches this far.

// `canWrite` ALONE is sufficient — an admin is globally unrestricted,
// full stop, regardless of which Dashboard View they are currently
// previewing/branded as (server/services/dashboardViews.js#
// applyLocalAdminPreview). This is a deliberate reversal of an earlier
// design (kept here as the historical record, since the mistake is
// instructive): an earlier revision also required `!access.isPreviewingVbu`,
// on the theory that a previewing admin's business DATA should look
// scoped to the previewed VBU for QA/testing purposes. In practice that
// meant an admin who selected ANY Dashboard View (including one an
// administrator had only partially configured, or one intentionally
// scoped to a single VBU like SSP Worldwide/SSP UK & Ireland) silently
// lost access to every OTHER VBU's users/products/cost data — real,
// existing people the admin is unquestionably authorized to inspect
// started 404ing from Users/Products/Microsoft 365 detail views with no
// obvious cause, purely because of which Dashboard View happened to be
// selected for BRANDING purposes at that moment. Confirmed live against
// production data: previewing SSP Worldwide alone made 153 of 296 real
// canonical users inaccessible; previewing SSP UK & Ireland made 163
// inaccessible — despite the admin never having done anything to revoke
// their own authorization.
//
// The corrected invariant (this is the ONE function every scoping
// function below funnels through, so this is the ONE place this needs to
// be true): RBAC authorization (`canWrite`) and Dashboard View
// PRESENTATION (branding/theme/visible-pages, still fully governed by
// `dashboardView`/`effectiveAllowedPages` — completely untouched by this
// change) are different concepts. An admin's own authorization is never
// narrowed by which view they happen to be looking at. `isPreviewingVbu`/
// `access.allowedVbus` are still computed and attached by
// applyLocalAdminPreview (still used for the profile-menu's own VBU
// display logic and available for any future non-security use), but no
// longer gate real business-data access for an admin session — there is
// no other kind of session `isPreviewingVbu` can ever be set on (it is
// only ever set by applyLocalAdminPreview, which only ever runs for a
// local-admin, always-canWrite:true identity — never reachable by, or
// settable for, a real non-admin Microsoft-authenticated user), so this
// change can never weaken a real non-admin's own VBU boundary.
export function isAdminAccess(access) {
  return !!access?.canWrite
}

function normalizeVbu(v) {
  return v ? String(v).trim().toLowerCase() : null
}

export function belongsToVbu(rowVbu, callerVbu) {
  const normalizedCaller = normalizeVbu(callerVbu)
  if (!normalizedCaller) return false
  return normalizeVbu(rowVbu) === normalizedCaller
}

// Dashboard View VBU Data Assignment spec: a caller's accessible scope is
// now potentially SEVERAL VBUs (e.g. SSP Central Services configured with
// multiple selected VBUs), not just one — this is the set-membership
// equivalent of belongsToVbu above, reusing its exact same normalization
// so a row matches if it belongs to ANY of the caller's allowed VBUs.
export function belongsToAnyVbu(rowVbu, allowedVbus) {
  if (!allowedVbus || !allowedVbus.length) return false
  return allowedVbus.some((v) => belongsToVbu(rowVbu, v))
}

function normalizeEmail(email) {
  return email ? String(email).trim().toLowerCase() : null
}

// The caller's effective allowed-VBU set. Prefers `access.allowedVbus`
// (server/auth/authorize.js#withDashboardView / applyLocalAdminPreview —
// every real request in this app sets it), but falls back to wrapping the
// legacy singular `access.vbu` in a one-element array when `allowedVbus`
// is entirely absent (`undefined`) — never when it's an explicit empty
// array, which is a real "no accessible VBU" result, not "not provided."
// This keeps every function below correct for any caller that only ever
// knew about the older single-vbu shape, with zero behavior change for
// the common single-VBU case either way.
function resolveAllowedVbus(access) {
  if (access?.allowedVbus !== undefined && access?.allowedVbus !== null) return access.allowedVbus
  return access?.vbu ? [access.vbu] : []
}

// A comma-joined string of the caller's own currently-allowed VBUs, for
// the handful of call sites that take a single string filter value in the
// same shape a user could type into a query param (e.g.
// microsoftLicenses.js's own matchesAny, which already accepts a comma-
// separated list) rather than an access object. `undefined` for an admin
// (no filter = everything, same as an admin's own optional query-string
// choice); a sentinel that can never match a real VBU for a caller with
// an empty accessible set — never silently "everything".
const NO_VBU_ACCESS_SENTINEL = '__no_vbu_access__'
export function effectiveVbuFilterValue(access) {
  if (isAdminAccess(access)) return undefined
  const allowed = resolveAllowedVbus(access)
  return allowed && allowed.length ? allowed.join(',') : NO_VBU_ACCESS_SENTINEL
}

// Canonical users (src/utils/userModel.js#buildCanonicalUsers) already
// carry a real, authoritative `.vbu` — no directory lookup needed here.
export function scopeCanonicalUsersByVbu(canonicalUsers, access) {
  if (isAdminAccess(access)) return canonicalUsers
  const allowed = resolveAllowedVbus(access)
  if (!allowed || !allowed.length) return []
  return canonicalUsers.filter((u) => belongsToAnyVbu(u.vbu, allowed))
}

// Flat per-product/usage records (each has `.email`, never a real `.vbu`
// of their own) — resolves ownership through the Microsoft directory Map
// (the exact shape buildMicrosoftDirectory returns: Map<normalizedEmail,
// {vbu, ...}>), the same convention used everywhere else in this app.
export function scopeRecordsByVbu(records, directoryMap, access) {
  if (isAdminAccess(access)) return records
  const allowed = resolveAllowedVbus(access)
  if (!allowed || !allowed.length) return []
  return records.filter((r) => {
    const email = normalizeEmail(r.email)
    const info = email ? directoryMap.get(email) : null
    return !!info && belongsToAnyVbu(info.vbu, allowed)
  })
}

// Raw microsoft_users rows (server/repositories/microsoftRepo.js) — these
// carry `.vbu` directly.
export function scopeMicrosoftUsers(users, access) {
  if (isAdminAccess(access)) return users
  const allowed = resolveAllowedVbus(access)
  if (!allowed || !allowed.length) return []
  return users.filter((u) => belongsToAnyVbu(u.vbu, allowed))
}

// The Map<normalizedEmail, info> shape sent to the client as
// GET /api/dashboard's `microsoftDirectory` field — scoped the same way as
// scopeMicrosoftUsers, just over the Map shape instead of raw rows. Closes
// a real, pre-existing gap: today this ships the ENTIRE tenant directory
// (every name/department/job-title) to anyone with cross-provider page
// access, regardless of VBU.
export function scopeMicrosoftDirectory(directoryMap, access) {
  if (isAdminAccess(access)) return directoryMap
  const scoped = new Map()
  const allowed = resolveAllowedVbus(access)
  if (!allowed || !allowed.length) return scoped
  for (const [key, info] of directoryMap.entries()) {
    if (belongsToAnyVbu(info.vbu, allowed)) scoped.set(key, info)
  }
  return scoped
}

// The one joined helper for GET /api/microsoft/data and
// GET /api/microsoft/applications-overview — scopes `users` first, then
// filters every other dataset by whichever join key it actually has to a
// scoped user (ms_id, or normalized upn/mail for tables that only carry
// user_principal_name). `groups` (Microsoft 365 Groups & Teams) is
// deliberately left out — there is no group MEMBERSHIP data synced at all
// (same honest gap costAnalytics.js#groupsAvailability already documents),
// so there is no join key to scope it by.
export function scopeMicrosoftDataset({ users, devices, applications, deviceApplications, licenses, signIns }, access) {
  if (isAdminAccess(access)) {
    return { users, devices, applications, deviceApplications, licenses, signIns }
  }
  const scopedUsers = scopeMicrosoftUsers(users || [], access)
  const scopedMsIds = new Set(scopedUsers.map((u) => u.ms_id))
  const scopedUpns = new Set(
    scopedUsers.flatMap((u) => [normalizeEmail(u.upn), normalizeEmail(u.mail)]).filter(Boolean)
  )
  const scopedDevices = (devices || []).filter((d) => scopedMsIds.has(d.user_ms_id) || scopedUpns.has(normalizeEmail(d.user_principal_name)))
  const scopedDeviceMsIds = new Set(scopedDevices.map((d) => d.ms_id))
  const scopedLicenses = (licenses || []).filter((l) => scopedMsIds.has(l.user_ms_id))
  const scopedSignIns = (signIns || []).filter((s) => scopedUpns.has(normalizeEmail(s.user_principal_name)))
  const scopedDeviceApplications = (deviceApplications || []).filter((da) => scopedDeviceMsIds.has(da.device_ms_id))
  const scopedApplicationMsIds = new Set(scopedDeviceApplications.map((da) => da.application_ms_id))
  const scopedApplications = (applications || []).filter((a) => scopedApplicationMsIds.has(a.ms_id))
  return {
    users: scopedUsers,
    devices: scopedDevices,
    applications: scopedApplications,
    deviceApplications: scopedDeviceApplications,
    licenses: scopedLicenses,
    signIns: scopedSignIns
  }
}

// Same idea, for GET /api/microsoft/applications-overview — that route
// only ever fetches listAllDeviceUserLinks() ({ms_id, user_principal_name}
// pairs, not full device rows), so it needs its own narrower device-
// scoping by upn only. `users` is the caller's own already-fetched
// msRepo.listAllUsers() (needed to know which upns are in-scope).
export function scopeApplicationsOverview({ users, deviceUserLinks, deviceApplications, applications }, access) {
  if (isAdminAccess(access)) return { deviceUserLinks, deviceApplications, applications }
  if (!resolveAllowedVbus(access).length) return { deviceUserLinks: [], deviceApplications: [], applications: [] }
  const scopedUsers = scopeMicrosoftUsers(users || [], access)
  const scopedUpns = new Set(scopedUsers.flatMap((u) => [normalizeEmail(u.upn), normalizeEmail(u.mail)]).filter(Boolean))
  const scopedLinks = (deviceUserLinks || []).filter((d) => scopedUpns.has(normalizeEmail(d.user_principal_name)))
  const scopedDeviceMsIds = new Set(scopedLinks.map((d) => d.ms_id))
  const scopedDeviceApplications = (deviceApplications || []).filter((da) => scopedDeviceMsIds.has(da.device_ms_id))
  const scopedApplicationMsIds = new Set(scopedDeviceApplications.map((da) => da.application_ms_id))
  const scopedApplications = (applications || []).filter((a) => scopedApplicationMsIds.has(a.ms_id))
  return { deviceUserLinks: scopedLinks, deviceApplications: scopedDeviceApplications, applications: scopedApplications }
}

// GET /api/microsoft/users/:msId and /devices/:msId — a device/user detail
// isn't a list to filter, it's a single resource to allow or deny. `user`
// is the resolved owning Microsoft user row (or null); true for an admin
// regardless, or for a non-admin whose own vbu matches the owner's.
export function ownsMicrosoftUser(user, access) {
  if (isAdminAccess(access)) return true
  return !!user && belongsToAnyVbu(user.vbu, resolveAllowedVbus(access))
}

// GET /api/microsoft/applications/:name and /linkage — an application
// itself isn't VBU-owned (a tenant-wide software catalog entry), only its
// per-device installations are, so only the `devices` list inside the
// existing detail response is narrowed; `summary`/`versions`/
// `linkageCoverage` stay as the tenant-wide catalog stats they already
// are. `users` is the caller's own already-fetched msRepo.listAllUsers().
export function scopeApplicationDetailDevices(detail, users, access) {
  if (isAdminAccess(access)) return detail
  if (!resolveAllowedVbus(access).length) return { ...detail, devices: [] }
  const scopedUsers = scopeMicrosoftUsers(users || [], access)
  const scopedUpns = new Set(scopedUsers.flatMap((u) => [normalizeEmail(u.upn), normalizeEmail(u.mail)]).filter(Boolean))
  return { ...detail, devices: detail.devices.filter((d) => scopedUpns.has(normalizeEmail(d.user_principal_name))) }
}
