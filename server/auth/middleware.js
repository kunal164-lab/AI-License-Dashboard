// Express middleware enforcing authorization on every protected route
// (Part 11: "Do NOT rely on React route protection alone"). Every one of
// these builds on `withAuth`, which does the two things EVERY protected
// route needs first: confirm a real session exists (authentication), then
// confirm the user has SOME configured access at all (authorization
// default-deny — Part 17: an authenticated user with no configured access
// is denied, never silently granted access just for existing in Microsoft
// 365).
import { computeEffectiveAccess } from './authorize.js'
import * as auditLogRepo from '../repositories/auditLogRepo.js'

// Effective access is a live Microsoft Graph check (checkMemberGroups) —
// too expensive to redo on every single request, so it's cached on the
// session and refreshed at most this often. Revocation (removing someone
// from an Entra group) takes effect within this window, matching Part 18's
// "after the next authorization evaluation/session refresh" — not
// necessarily on their very next click, but never more than 15 minutes
// stale, and always fresh again on their next login.
const ACCESS_REFRESH_MS = 15 * 60 * 1000

// The one place a session's cached `access` is read-or-recomputed —
// factored out of withAuth below so GET /api/auth/me (server/auth/routes.js)
// can use the exact same logic instead of its own fallback. Bug found while
// investigating a real Access Denied report: /api/auth/me used to fall back
// to a hardcoded EMPTY access object whenever `req.session.access` was
// missing, rather than recomputing it — indistinguishable, to the user,
// from a genuine "not authorized" result. `req.session.access` goes missing
// any time server/auth/sqliteSessionStore.js#invalidateAllCachedAccess runs
// (every server restart/redeploy, by design — see its own comment: "every
// session's very next request recomputes it fresh"), and /api/auth/me is
// very often that very next request (it's the frontend's own boot-time
// check, called before any other protected route). A user whose FIRST
// request after any restart happened to be /api/auth/me would see "Access
// Denied" — permanently, since /api/auth/me never writes the real access
// back to the session, so it never self-heals — despite having perfectly
// valid, unchanged RBAC access the whole time.
export async function getOrRefreshAccess(req) {
  let access = req.session.access
  if (!access || Date.now() - (access.computedAt || 0) > ACCESS_REFRESH_MS) {
    // selectedDashboardViewId only ever exists for a local-admin session
    // (server/auth/localRoutes.js's dashboard-view selection routes) —
    // carrying it through the periodic refresh keeps a chosen preview
    // alive across the same 15-minute cache window real RBAC already
    // uses, until the admin clears it or logs out.
    access = await computeEffectiveAccess(req.session.user, { selectedDashboardViewId: req.session.selectedDashboardViewId })
    access.computedAt = Date.now()
    req.session.access = access
  }
  return access
}

function withAuth(handler) {
  return async (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Authentication required.' })
    try {
      const access = await getOrRefreshAccess(req)
      req.user = req.session.user
      req.access = access
      // Default-deny also covers a non-admin whose VBU cannot be resolved
      // (blank/not-yet-synced onPremisesExtensionAttributes.extensionAttribute3)
      // — real VBU data scoping (server/auth/vbuScope.js) can only ever be
      // enforced for someone whose own VBU is known, so treat "no
      // configured access" and "no resolvable VBU" identically: the same
      // clear, existing "contact your administrator" response, not a
      // silently-empty dashboard. Admins (canWrite) are never subject to
      // this — they are global regardless of their own VBU.
      if ((!access.allowedPages.length && !access.canWrite) || (!access.canWrite && !access.vbu)) {
        auditLogRepo.record({ eventType: 'access_denied', actorUpn: req.user.upn, actorOid: req.user.oid, detail: { path: req.originalUrl } })
        return res.status(403).json({ error: 'You are not authorized to use this application. Contact your administrator.' })
      }
      handler(req, res, next)
    } catch (e) {
      res.status(502).json({ error: 'Failed to verify authorization: ' + (e.message || 'unknown error') })
    }
  }
}

// Any authenticated user with at least SOME configured access — used for
// routes shared across many pages (e.g. GET /api/dashboard) where scoping
// to one specific page key isn't practical without splitting that shared
// endpoint into several (see server/index.js's own comment at the mount
// point for why that's out of scope here).
export const requireAuth = withAuth((req, res, next) => next())

// Requires access to a SPECIFIC page key from the central registry
// (server/auth/pages.js) — used for routes that clearly belong to one
// page/product (Microsoft 365, Freshservice, Kiro, Claude, Cost, the admin
// access screen).
export function requirePage(pageKey) {
  return withAuth((req, res, next) => {
    if (!req.access.allowedPages.includes(pageKey)) {
      auditLogRepo.record({ eventType: 'access_denied', actorUpn: req.user.upn, actorOid: req.user.oid, detail: { path: req.originalUrl, pageKey } })
      return res.status(403).json({ error: 'You do not have access to this page.' })
    }
    next()
  })
}

// Write/administrative access — replaces the old always-true requireAdmin
// stub (server/authStub.js) at every existing call site. A Read Only user
// (canWrite: false) gets a real 403 here, not just a hidden button
// (Part 3: "Read Only means genuinely read-only... backend APIs must also
// enforce authorization").
export const requireWrite = withAuth((req, res, next) => {
  if (!req.access.canWrite) {
    auditLogRepo.record({ eventType: 'access_denied', actorUpn: req.user.upn, actorOid: req.user.oid, detail: { path: req.originalUrl, reason: 'write_required' } })
    return res.status(403).json({ error: 'Admin access required for this action.' })
  }
  next()
})

// The access-management screen itself is administrative regardless of
// which pages a mapping happens to grant — gated on the dedicated
// 'admin-access' page key AND write access, so a read-only user can never
// reach it even if (by misconfiguration) they were somehow granted that
// page key without write.
export const requireAdminAccess = withAuth((req, res, next) => {
  if (!req.access.canWrite || !req.access.allowedPages.includes('admin-access')) {
    auditLogRepo.record({ eventType: 'access_denied', actorUpn: req.user.upn, actorOid: req.user.oid, detail: { path: req.originalUrl, reason: 'admin_access_required' } })
    return res.status(403).json({ error: 'Access management requires administrative access.' })
  }
  next()
})
