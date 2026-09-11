// Microsoft Entra ID SSO — the authorization-code flow (Part 1/14 of the
// auth spec: "follow Microsoft Entra recommended authentication patterns").
// Everything here is about AUTHENTICATION ("who is this person"); effective
// PAGE/WRITE authorization is computed separately (server/auth/authorize.js)
// and only ever cached on the session this flow creates — this file never
// makes an authorization decision itself beyond "did Microsoft actually
// authenticate someone."
import express from 'express'
import crypto from 'crypto'
import { getMsalClient, LOGIN_SCOPES } from './msalClient.js'
import { redirectUri, postLoginRedirect, postLogoutRedirect, isSsoConfigured, getEffectiveEntraConfig } from './config.js'
import { computeEffectiveAccess } from './authorize.js'
import { getOrRefreshAccess } from './middleware.js'
import { fetchOwnProfilePhoto } from '../services/microsoft/profilePhoto.js'
import * as auditLogRepo from '../repositories/auditLogRepo.js'

export const authRouter = express.Router()

authRouter.get('/auth/microsoft/login', async (req, res) => {
  const msalClient = getMsalClient()
  if (!msalClient) return res.status(503).send('Microsoft Entra ID sign-in is not configured on this server. Contact your administrator.')
  const state = crypto.randomBytes(16).toString('hex')
  req.session.oauthState = state
  try {
    const url = await msalClient.getAuthCodeUrl({ scopes: LOGIN_SCOPES, redirectUri, state })
    res.redirect(url)
  } catch (e) {
    res.status(502).send('Failed to start Microsoft sign-in: ' + (e.message || 'unknown error'))
  }
})

authRouter.get('/auth/microsoft/callback', async (req, res) => {
  const msalClient = getMsalClient()
  if (!msalClient) return res.status(503).send('Microsoft Entra ID sign-in is not configured on this server.')
  const { code, state, error, error_description: errorDescription } = req.query
  if (error) {
    auditLogRepo.record({ eventType: 'login_failed', detail: { error, errorDescription } })
    return res.status(401).send(`Microsoft sign-in failed: ${errorDescription || error}`)
  }
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid or expired sign-in request. Please try signing in again.')
  }
  delete req.session.oauthState

  try {
    const result = await msalClient.acquireTokenByCode({ code, scopes: LOGIN_SCOPES, redirectUri })
    const claims = result.idTokenClaims || {}
    // oid (the stable Entra object id) is the identity this whole app keys
    // authorization checks on (Part 15: "matched using the stable Entra
    // identity/claims rather than relying only on display name") — never
    // the mutable display name/email alone.
    const user = {
      oid: claims.oid || result.account?.homeAccountId || null,
      name: claims.name || result.account?.name || null,
      upn: claims.preferred_username || claims.email || result.account?.username || null,
      authenticationProvider: 'microsoft'
    }
    if (!user.oid) throw new Error('Microsoft did not return a stable user identity (oid) in the ID token.')

    // Regenerate the session id on login (not just its contents) — standard
    // session-fixation defense: a session id issued before authentication
    // must never become a valid authenticated session id.
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).send('Failed to establish a session after sign-in.')
      req.session.user = user
      // Fetched with THIS user's own delegated token (never the app's
      // client-credentials token, never another user's id) and cached on
      // the session so GET /api/auth/profile/photo never needs a live
      // Graph token later — the token itself is never stored anywhere.
      // Missing photo / any Graph failure here is a normal outcome (most
      // accounts have no photo) and must never affect login.
      try {
        req.session.photo = await fetchOwnProfilePhoto(result.accessToken)
      } catch (e) {
        req.session.photo = null
      }
      try {
        const access = await computeEffectiveAccess(user)
        access.computedAt = Date.now()
        req.session.access = access
        auditLogRepo.record({
          eventType: access.allowedPages.length || access.canWrite ? 'login_success' : 'login_denied',
          actorUpn: user.upn, actorOid: user.oid,
          detail: { role: access.role, pageCount: access.allowedPages.length }
        })
      } catch (e) {
        // A failed access computation must not fail the login itself — the
        // user still ends up signed in, just with no access yet (the same
        // default-deny state as anyone with no configured group), and can
        // retry once the underlying problem (e.g. Microsoft 365 connection
        // down) is fixed.
        req.session.access = { role: null, allowedPages: [], canWrite: false, isBootstrapAdmin: false, vbu: null, dashboardView: null, effectiveAllowedPages: [], computedAt: Date.now() }
      }
      req.session.save(() => res.redirect(postLoginRedirect))
    })
  } catch (e) {
    auditLogRepo.record({ eventType: 'login_failed', detail: { error: e.message } })
    res.status(401).send('Microsoft sign-in failed: ' + (e.message || 'unknown error'))
  }
})

// This is the ONE logout endpoint for every identity (local admin or
// Microsoft) — a provider-aware fix (Part 9 of the local-admin auth spec):
// a local admin's logout must never redirect to Microsoft's own logout
// endpoint, which would be at best confusing and at worst hand a local-only
// session over to an unrelated Microsoft account picker.
authRouter.post('/auth/microsoft/logout', (req, res) => {
  const user = req.session?.user
  if (user) {
    auditLogRepo.record({
      eventType: user.authenticationProvider === 'local' ? 'local_logout' : 'logout',
      actorUpn: user.upn || user.username, actorOid: user.oid
    })
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid')
    const logoutUrl = (user?.authenticationProvider === 'microsoft' && isSsoConfigured())
      ? `https://login.microsoftonline.com/${getEffectiveEntraConfig()?.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirect)}`
      : postLogoutRedirect
    res.json({ logoutUrl })
  })
})

// The one endpoint the frontend polls on boot to decide what to render:
// not signed in -> show a sign-in screen; signed in but no access -> show
// Access Denied; signed in with access -> render the dashboard with these
// exact allowedPages/canWrite values (Part 6: the sidebar/routing must
// reflect this, never assume access). `configured` only tells the frontend
// whether to render the "Sign in with Microsoft" button — it must NEVER
// gate authentication itself, since a local admin must be able to sign in
// and stay signed in even when Entra ID is not configured at all (Part 3:
// the emergency-recovery path).
authRouter.get('/api/auth/me', async (req, res) => {
  if (!req.session?.user) return res.json({ configured: isSsoConfigured(), authenticated: false })
  // Bug fix: this used to fall back to a hardcoded EMPTY access object
  // whenever req.session.access was merely missing (not yet computed, or
  // cleared by sqliteSessionStore.js#invalidateAllCachedAccess on the last
  // server restart) — indistinguishable, in the browser, from a genuine
  // "not authorized" result, and this route never wrote a real value back,
  // so an affected session stayed stuck on Access Denied forever (this IS
  // the frontend's own boot-time check — no other protected route ever ran
  // to self-heal it). getOrRefreshAccess is the exact same recompute-or-
  // reuse-cache logic every other protected route already uses (server/auth/
  // middleware.js) — a genuinely unauthorized user still correctly gets an
  // empty access object back, just now for the RIGHT reason.
  let access
  try {
    access = await getOrRefreshAccess(req)
  } catch (e) {
    access = { role: null, allowedPages: [], canWrite: false, vbu: null, dashboardView: null, effectiveAllowedPages: [] }
  }
  res.json({
    configured: isSsoConfigured(),
    authenticated: true,
    user: {
      name: req.session.user.name,
      upn: req.session.user.upn,
      authenticationProvider: req.session.user.authenticationProvider || 'microsoft',
      // Tells the frontend whether it's worth requesting
      // /api/auth/profile/photo at all — never the photo/token itself.
      hasPhoto: !!req.session.photo
    },
    role: access.role,
    // Raw RBAC allowed pages (kept for backward compatibility/audit
    // clarity) — the frontend should use effectiveAllowedPages below for
    // both sidebar visibility and route-access checks (VBU-aware Dashboard
    // View spec, Part 6: a view can only narrow RBAC, never widen it).
    allowedPages: access.allowedPages,
    effectiveAllowedPages: access.effectiveAllowedPages ?? access.allowedPages,
    canWrite: access.canWrite,
    // VBU/Dashboard View are resolved purely from the server-authoritative
    // session identity (server/auth/authorize.js#computeEffectiveAccess) —
    // this is a parameterless GET reading only the session, so there is no
    // query/body input a client could use to influence either value.
    vbu: access.vbu ?? null,
    // Informational only (Dashboard View VBU Data Assignment spec, Part 5:
    // "the frontend can display the current scope... but must not be
    // responsible for enforcing it") — the real enforcement lives entirely
    // server-side in server/auth/vbuScope.js, keyed off this exact same
    // session-computed value, never re-derived from anything the client
    // sends back.
    allowedVbus: access.allowedVbus ?? null,
    dashboardView: access.dashboardView ?? null,
    // Whether the frontend should render the Choose Dashboard View gate
    // (VBU-aware-views spec, "Local Administrator" section) — a Microsoft-
    // authenticated user's view is always auto-resolved from their VBU, so
    // this is always true for them; a local-admin session starts false on
    // every fresh login and becomes true once they select a view
    // (POST /api/auth/local/dashboard-view).
    dashboardViewChosen: req.session.user.authenticationProvider !== 'local' || !!access.selectedDashboardViewId
  })
})

// Returns the SIGNED-IN user's own cached profile photo (fetched at login
// time — see the callback above) — never any other user's, and never
// accepts a user id from the client; the only "which user" input is the
// current session. 401 if not signed in, 404 if this account genuinely has
// no photo (or is a local admin, who never has one) — both are ordinary,
// expected outcomes the frontend already falls back for (initials/icon),
// never a hard error.
authRouter.get('/api/auth/profile/photo', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required.' })
  const photo = req.session.photo
  if (!photo) return res.status(404).json({ error: 'No profile photo available.' })
  res.set('Content-Type', photo.contentType)
  res.set('Cache-Control', 'private, max-age=3600')
  res.send(Buffer.from(photo.base64, 'base64'))
})
