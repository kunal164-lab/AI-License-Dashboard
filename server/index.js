try {
  await import('dotenv/config')
} catch (e) {
  // dotenv not installed or not needed in this environment; proceed using process.env
}
import express from 'express'
import { assertEncryptionKeyConfigured } from './crypto.js'
// Fail fast in production rather than let the server come up and quietly
// encrypt real credentials under the hardcoded dev key — see
// crypto.js#assertEncryptionKeyConfigured. Must run after the dotenv block
// above (same reason crypto.js's own key resolution is lazy: ESM hoists
// static imports, so any module statically imported below that reads
// process.env.ENCRYPTION_KEY at its own top level would otherwise see it
// before dotenv has populated it).
assertEncryptionKeyConfigured()
import cors from 'cors'
import helmet from 'helmet'
import session from 'express-session'
import crypto from 'crypto'
import { getSessionSecret } from './auth/config.js'
import { SqliteSessionStore, invalidateAllCachedAccess } from './auth/sqliteSessionStore.js'
import { authRouter } from './auth/routes.js'
import { adminRouter } from './auth/adminRoutes.js'
import { dashboardViewsAdminRouter } from './auth/dashboardViewsAdminRoutes.js'
import { localAuthRouter } from './auth/localRoutes.js'
import { requireAuth, requirePage, requireWrite } from './auth/middleware.js'
import { filterConnectionsForAccess, canSeeMicrosoftDirectory, canAccessDetailProvider } from './auth/dashboardAccess.js'
import {
  scopeRecordsByVbu, scopeMicrosoftDirectory, scopeMicrosoftDataset, scopeApplicationsOverview,
  ownsMicrosoftUser, scopeApplicationDetailDevices, isAdminAccess, effectiveVbuFilterValue
} from './auth/vbuScope.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb } from './db/index.js'
import * as connectionsRepo from './repositories/connectionsRepo.js'
import * as recordsRepo from './repositories/recordsRepo.js'
import * as syncHistoryRepo from './repositories/syncHistoryRepo.js'
import * as pendingOAuth from './pendingOAuth.js'
import * as github from './connectors/github.js'
import * as kiro from './connectors/kiro.js'
import * as msRepo from './repositories/microsoftRepo.js'
import { syncMicrosoftConnection } from './services/microsoft/sync.js'
import { MICROSOFT_CAPABILITIES, CAPABILITY_ORDER } from './services/microsoft/capabilities.js'
import { aggregateDepartments, aggregateDomains } from './services/microsoft/departments.js'
import * as msDetail from './services/microsoft/detail.js'
import * as freshserviceRepo from './repositories/freshserviceRepo.js'
import { runFreshserviceSync, importFreshserviceCsv, upsertFreshserviceConnection } from './services/freshservice/sync.js'
import { findGroupsByDisplayName } from './services/freshservice/graphGroup.js'
import { normalizeKiroUsage, validateKiroCsv, selectLatestPerUser } from '../src/utils/kiroNormalizer.js'
import * as kiroRepo from './repositories/kiroRepo.js'
import { validateClaudeCsv, normalizeClaudeSnapshot } from '../src/utils/claudeNormalizer.js'
import { buildValidEmailSet } from '../src/utils/canonicalIdentity.js'
import * as claudeRepo from './repositories/claudeRepo.js'
import { runClaudeSync } from './services/claude/sync.js'
import { startClaudeScheduler } from './services/claude/scheduler.js'
import { startFxScheduler } from './services/fx/scheduler.js'
import * as fxService from './services/fx/fxService.js'
import * as rolesRepo from './repositories/rolesRepo.js'
import * as dashboardViewsService from './services/dashboardViews.js'
import * as costRuleRepo from './repositories/costRuleRepo.js'
import * as settingsRepo from './repositories/settingsRepo.js'
import * as exchangeRateRepo from './repositories/exchangeRateRepo.js'
import { enrichCopilotRecords, excludeUnlicensedCopilotUsage } from './services/microsoft/copilotEnrichment.js'
import { resolveCostForRecords, consolidateSharedSeats } from './services/costEngine.js'
import { buildMicrosoftDirectory } from '../src/utils/userModel.js'
import * as costAnalytics from './services/costAnalytics.js'
import * as microsoftLicenses from './services/microsoftLicenses.js'
import * as userDetailService from './services/userDetail.js'
import { getAllEnrichedRecords } from './services/recordsPipeline.js'
import { mergeSeatGroupRecords } from '../src/utils/productModel.js'
import { parseCsv } from './utils/csv.js'
import { assertSafeExternalUrl } from './utils/urlSafety.js'
import * as auditLogRepo from './repositories/auditLogRepo.js'
import { normalizeBySource } from './normalize.js'

await initDb()

// One-time (idempotent — safe on every startup): ensures the built-in
// Admin/Read_Only roles exist and points any role_group_mappings row
// created before the roles table existed at a real role (preserving its
// exact existing permissions) — see server/repositories/rolesRepo.js for
// the full migration logic.
rolesRepo.migrateLegacyRoleMappings()

// One-time (idempotent — safe on every startup): ensures the three initial
// Dashboard Views (SSP/SSP Worldwide/SSP UK & I) exist, each starting with
// the full current page list and no theme override — see
// server/services/dashboardViews.js#seedDefaultDashboardViews. No VBU is
// assigned to WORLDWIDE/UK_I automatically; every user's experience is
// unchanged until an administrator explicitly configures one.
dashboardViewsService.seedDefaultDashboardViews()

// One-time (idempotent — safe on every startup): merges any VBU that was
// only ever configured through the old, separate "VBU Assignments" admin
// screen into its dashboard view's own allowedVbuIds — the VBU-scoping bug
// investigation found these were two independent, easily-desynced
// mechanisms (an administrator could configure a view's "VBU Data" without
// this ever taking effect, or vice versa); resolveDashboardView below now
// resolves entirely from allowedVbuIds, so this merge is what preserves any
// pre-existing assignment before that admin screen was retired — see
// server/services/dashboardViews.js#migrateVbuAssignmentsIntoAllowedVbuIds.
dashboardViewsService.migrateVbuAssignmentsIntoAllowedVbuIds()

// One-time (idempotent — safe on every startup, and never overwrites an
// administrator's own later edit): applies the real, approved SSP UK &
// Ireland branding (logo/theme) and its VBU assignment — see
// server/services/dashboardViews.js#applyInitialUkIrelandConfig.
dashboardViewsService.applyInitialUkIrelandConfig()
dashboardViewsService.applyInitialWorldwideConfig()
// One-time, idempotent rename: "SSP" -> "SSP Central Services" (Dashboard
// View VBU Data Assignment spec) — the id stays 'SSP' everywhere, only the
// display name changes; never overwrites an admin's own later edit (see
// the function's own comment).
dashboardViewsService.applyInitialCentralServicesConfig()

// Audit-event retention (Part B of the audit-events spec): run once at
// startup too, not just on every write, so a long-idle server (no logins
// at all since the cutoff) doesn't just accumulate stale rows forever
// between the writes that would otherwise trigger it.
auditLogRepo.pruneOldEvents()

// Every already-signed-in session's resolved access (role/VBU/Dashboard
// View/theme) is cached for up to 15 minutes and, since sessions persist
// in SQLite, that cache survives this very restart — so without this, an
// admin config change above could still render stale for any session that
// happened to cache it shortly before this restart. Clears just the
// cache, not the session itself: nobody is signed out, and the next
// request for every session recomputes access from the current DB state
// via the same computeEffectiveAccess() call middleware.js always uses.
invalidateAllCachedAccess()

// One-time (idempotent — safe on every startup) backfill for Freshservice
// connections. Two situations handled, never touching any other provider's
// data:
//   1. A connection created before the two-method redesign has no
//      meta.sourceMethod at all — infer it from whichever config it
//      already has.
//   2. The SharePoint CSV method has been removed entirely (unreliable
//      SharePoint app-only permissions/authentication) — an existing
//      connection still configured for it is migrated IN PLACE to
//      manual_csv (same connection id, so it never appears as a new/
//      duplicate card) rather than left permanently showing a SharePoint
//      error it can no longer recover from. Its stale SharePoint fields
//      are cleared; the administrator uploads a CSV to populate it.
for (const conn of connectionsRepo.listConnections('freshservice')) {
  if (conn.meta.sourceMethod === 'sharepoint_csv') {
    connectionsRepo.updateConnection(conn.id, {
      status: 'pending', lastError: null,
      meta: { sourceMethod: 'manual_csv', sharingUrl: null, fileName: null, sharePointLocation: null }
    })
    continue
  }
  if (conn.meta.sourceMethod) continue
  if (conn.meta.securityGroupName) connectionsRepo.updateConnection(conn.id, { meta: { sourceMethod: 'ms_group' } })
  else if (conn.meta.sharingUrl) connectionsRepo.updateConnection(conn.id, { meta: { sourceMethod: 'manual_csv', sharingUrl: null } })
}

// ---------------------------------------------------------------------------
// Claude automatic OneDrive/SharePoint MTD source — the folder URL and
// expected file name are server-side configuration, deliberately NOT
// user-editable through the UI (Part 1 of the spec this implements).
// Exactly one such connection ever exists; it's auto-provisioned here
// (idempotent — safe on every startup, same pattern as the Freshservice
// backfill above) rather than created through an "Add Source" form like
// every other API source.
// ---------------------------------------------------------------------------
const CLAUDE_SHARE_URL = 'https://ssplimited-my.sharepoint.com/:f:/g/personal/kunal_tyagi_ssp-worldwide_com/IgCdgT9N9rI8SK5zvCZbIzYdAVM1k-MY7xSf1BnE7QZcq_8?e=sptlaK'
const CLAUDE_FILE_NAME = 'Claude_Spend_MTD.csv'

let claudeConn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
if (!claudeConn) {
  claudeConn = connectionsRepo.createConnection({
    source: 'Claude', kind: 'api', label: 'Claude (OneDrive/SharePoint MTD)', authType: 'share_link_password',
    credentials: {},
    meta: { scheduleMinutes: 1440, enabled: true }
  })
}
// Keep the code-owned config (folder/file/reporting type) in sync with the
// constants above on every boot, without touching the admin-controlled
// enabled/scheduleMinutes fields (updateConnection merges meta shallowly).
connectionsRepo.updateConnection(claudeConn.id, { meta: { shareUrl: CLAUDE_SHARE_URL, fileName: CLAUDE_FILE_NAME, reportingType: 'MTD' } })
// CLAUDE_ONEDRIVE_PASSWORD is only a BOOTSTRAP default for a brand-new
// deployment — the password entered through the Claude data source page's
// own form (POST /api/claude/password below) is the primary path and must
// never be silently clobbered by a stale .env value on a later restart, so
// this only fires once, before any real password has ever been stored.
// Either way it goes straight into the same encrypted credential store
// every other provider's secrets use (server/crypto.js) — never logged,
// never returned by any API response.
if (process.env.CLAUDE_ONEDRIVE_PASSWORD && !claudeConn.credentials?.password) {
  connectionsRepo.updateConnection(claudeConn.id, { credentials: { password: process.env.CLAUDE_ONEDRIVE_PASSWORD } })
}

const PORT = process.env.PORT || 4000
const SERVER_BASE_URL = (process.env.SERVER_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')
const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/$/, '')

const app = express()
// Production-readiness fix: security headers via Helmet. Content-Security-
// Policy and Cross-Origin-Embedder-Policy are deliberately disabled rather
// than left at Helmet's strict defaults: this frontend renders hundreds of
// inline `style={{...}}` React attributes app-wide and index.html ships an
// inline, unnonced diagnostic <script> (shows a readable error instead of a
// blank white screen on startup failure) — a default CSP would block both
// immediately, and COEP's default cross-origin-isolation requirement risks
// breaking Dashboard View branding assets and Microsoft/GitHub SSO without
// an exhaustive per-asset audit. Every other Helmet default header still
// applies (X-Content-Type-Options, X-Frame-Options, Strict-Transport-
// Security, Referrer-Policy, etc.) — real hardening with zero functional
// risk. A CSP can be revisited alongside a frontend pass to remove inline
// styles/scripts.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}))
// Production-readiness fix: Azure App Service (like any PaaS reverse
// proxy) terminates TLS at its own front end and forwards the request to
// this process over plain HTTP, setting X-Forwarded-Proto/X-Forwarded-For
// to describe the ORIGINAL request. Without telling Express to trust
// exactly that one hop, two things silently break in production: (1) the
// session cookie's `cookie.secure: true` below (only set when
// NODE_ENV=production) makes express-session refuse to set the cookie at
// all, because it reads req.secure — which without trust proxy reflects
// the internal plain-HTTP hop, never the real HTTPS request — breaking
// login entirely; (2) express-rate-limit (server/auth/localRoutes.js)
// validates that trust proxy is configured whenever X-Forwarded-For is
// present, specifically to stop a client from spoofing that header to
// bypass IP-based rate limiting — it throws at request time otherwise.
// `1` (not `true`) trusts exactly one hop, matching Azure App Service's
// actual single-reverse-proxy topology — never an unbounded chain, which
// would let a malicious client's OWN forged X-Forwarded-For be trusted.
app.set('trust proxy', 1)
// Production-readiness fix: this app is same-origin in both dev (Vite's own
// proxy in vite.config.js makes browser requests same-origin from :5173's
// point of view) and production (this same process serves the built
// frontend — see DIST_DIR/express.static below), so cors() exists only to
// answer genuinely cross-origin requests (a direct hit to SERVER_BASE_URL
// itself, or a tool making a request with an explicit Origin header) —
// unrestricted app.use(cors()) answered every one of those with
// Access-Control-Allow-Origin: * for every origin on the internet. Build an
// explicit allowlist from the same SERVER_BASE_URL/FRONTEND_BASE_URL
// configuration used everywhere else in this file, instead of hardcoding a
// company domain; the local Vite dev server default is added only outside
// production so `npm run dev` keeps working unchanged.
const corsAllowedOrigins = new Set([SERVER_BASE_URL, FRONTEND_BASE_URL])
if (process.env.NODE_ENV !== 'production') {
  corsAllowedOrigins.add('http://localhost:5173')
  corsAllowedOrigins.add('http://localhost:4000')
}
app.use(cors({
  origin(origin, callback) {
    // No Origin header at all means a same-origin browser request, a
    // server-to-server call, or a non-browser tool (curl, the Azure health
    // prober) — never a cross-site browser request CORS exists to police.
    // Deny by passing `false` (not an Error) — the `cors` package would
    // otherwise let the thrown error fall through to Express's default
    // error handler, turning a routine disallowed-origin request into an
    // unhandled 500 that leaks a full server file-path stack trace in the
    // response body. Passing false just omits the CORS headers instead;
    // the browser (not this server) is what actually blocks a disallowed
    // cross-origin caller from reading the response.
    callback(null, !origin || corsAllowedOrigins.has(origin))
  },
  credentials: true
}))
app.use(express.json({ limit: '25mb' })) // CSV/XLSX imports can carry several thousand normalized rows

// Human-user session (Part 14 of the auth spec: secure server-side session,
// never a token in localStorage). Cookie-based, httpOnly so client-side JS
// can never read it; SqliteSessionStore persists sessions in the same
// database every other repository already uses (server/db/index.js) rather
// than express-session's default in-memory store, so a server restart
// doesn't silently sign everyone out. `/api` and `/auth` are same-origin in
// both dev (Vite's own proxy, see vite.config.js) and production (this
// same process serves the built frontend) — no cross-site cookie handling
// is needed.
app.use(session({
  store: new SqliteSessionStore(),
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours, fixed — see SqliteSessionStore's no-op touch()
  }
}))

// Unauthenticated health check (Production-readiness audit) — deliberately
// OUTSIDE the /api prefix so it is never subject to the requireAuth gate
// below (Azure App Service's own health-check prober has no session
// cookie and must never need one). Kept intentionally trivial: it only
// proves the process is up and answering HTTP requests, matching what a
// PaaS health probe actually needs — it is not a database/dependency
// deep-check, so a transient upstream (Graph/GitHub/etc.) outage never
// causes App Service to mark otherwise-healthy instances unhealthy and
// restart them.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
})

// Auth routes are mounted BEFORE the blanket /api auth gate below so
// /auth/microsoft/login|callback (unauthenticated by definition — this IS
// the login flow), /api/auth/me (must answer "you're not signed in yet,"
// not 401, so the frontend can show a sign-in screen), and the local-admin
// setup/login routes (must work even with no session yet — the whole
// point of the emergency-recovery path) are always reachable. Admin
// access-management routes carry their own requireAdminAccess check
// per-route (server/auth/adminRoutes.js).
app.use(authRouter)
app.use(adminRouter)
app.use(dashboardViewsAdminRouter)
app.use(localAuthRouter)
// Default-deny (Part 17): every other /api/* route requires a real,
// authorized session. Individual routes below layer requirePage/
// requireWrite on top where a specific page or write access is required;
// this blanket gate is the floor everything else builds on.
app.use('/api', requireAuth)

// The OAuth callback runs inside a popup window. Rendering the full SPA there
// would leave a second copy of the dashboard open; instead send back a tiny
// page that closes itself so the opener's poll picks up the new connection.
function sendPopupResult(res, { ok, message }) {
  const safeMessage = String(message || '').replace(/</g, '&lt;')
  res.send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">
    <p>${ok ? 'Connected.' : 'Error: ' + safeMessage}</p>
    <script>setTimeout(function(){ window.close() }, ${ok ? 800 : 4000})</script>
  </body></html>`)
}

// ---------------------------------------------------------------------------
// GitHub Copilot — OAuth, multi-account (one connection per org/enterprise)
// ---------------------------------------------------------------------------

// requireWrite (not just requireAuth) — this starts a write path exactly
// like every other connector's setup flow (POST /api/kiro/oauth/start,
// POST /api/connections) and must be gated the same way. Previously this
// route had NO auth check at all: it's a plain top-level GET (opened in a
// popup — see DataSourcesGithub.jsx), so the browser's session cookie is
// sent automatically and requireWrite works exactly as it would for a
// fetch()-based route.
app.get('/auth/github', requireWrite, async (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return res.status(500).send('GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not configured on the server (.env)')
  }
  const { label, org, enterprise, reportUrl } = req.query
  // reportUrl is fetched server-side later (see runSync's github branch),
  // with a live bearer token attached — an unvalidated value here is a
  // straightforward SSRF primitive, so it's checked once, at acceptance
  // time, same as Kiro's connector endpoints below.
  if (reportUrl) {
    try {
      await assertSafeExternalUrl(reportUrl, 'reportUrl')
    } catch (e) {
      return res.status(400).send(e.message)
    }
  }
  const state = pendingOAuth.create({ source: 'github', label, org, enterprise, reportUrl })
  const redirectUri = SERVER_BASE_URL + '/auth/github/callback'
  const authUrl = github.buildAuthUrl({ clientId, redirectUri, state, scope: 'read:org' })
  res.redirect(authUrl)
})

app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state) return res.status(400).send('Missing code or state')
  const pending = pendingOAuth.consume(state)
  if (!pending) return res.status(400).send('Invalid or expired authorization request')

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  try {
    const token = await github.exchangeCode({ clientId, clientSecret, code })
    const user = await github.fetchAuthenticatedUser(token).catch(() => null)
    const conn = connectionsRepo.createConnection({
      source: 'github',
      kind: 'api',
      label: pending.label || pending.org || pending.enterprise || (user && user.login) || 'GitHub',
      authType: 'oauth',
      credentials: { token },
      meta: {
        org: pending.org || null,
        enterprise: pending.enterprise || null,
        reportUrl: pending.reportUrl || null,
        login: user && user.login
      }
    })
    connectionsRepo.updateConnection(conn.id, { status: 'connected' })
    return sendPopupResult(res, { ok: true })
  } catch (e) {
    return sendPopupResult(res, { ok: false, message: 'GitHub authorization failed: ' + e.message })
  }
})

// ---------------------------------------------------------------------------
// Kiro — OAuth2 (endpoints supplied per-connection) or a static API key
// ---------------------------------------------------------------------------

app.post('/api/kiro/oauth/start', requireWrite, async (req, res) => {
  const { label, clientId, clientSecret, authorizationUrl, tokenUrl, apiBaseUrl, scope } = req.body || {}
  if (!clientId || !clientSecret || !authorizationUrl || !tokenUrl || !apiBaseUrl) {
    return res.status(400).json({ error: 'clientId, clientSecret, authorizationUrl, tokenUrl and apiBaseUrl are required' })
  }
  // Each of these is fetched server-side (token exchange, then every data
  // sync) with the connection's own client secret/token attached — an
  // unvalidated admin-supplied endpoint is an SSRF primitive exactly like
  // GitHub's reportUrl above.
  try {
    await assertSafeExternalUrl(authorizationUrl, 'authorizationUrl')
    await assertSafeExternalUrl(tokenUrl, 'tokenUrl')
    await assertSafeExternalUrl(apiBaseUrl, 'apiBaseUrl')
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }
  const state = pendingOAuth.create({ source: 'kiro', label, clientId, clientSecret, authorizationUrl, tokenUrl, apiBaseUrl, scope })
  const redirectUri = SERVER_BASE_URL + '/auth/kiro/callback'
  const authUrl = kiro.buildAuthUrl({ authorizationUrl, clientId, redirectUri, state, scope })
  res.json({ authUrl })
})

app.get('/auth/kiro/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state) return res.status(400).send('Missing code or state')
  const pending = pendingOAuth.consume(state)
  if (!pending) return res.status(400).send('Invalid or expired authorization request')

  try {
    const redirectUri = SERVER_BASE_URL + '/auth/kiro/callback'
    const tokenResp = await kiro.exchangeCode({
      tokenUrl: pending.tokenUrl,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      code,
      redirectUri
    })
    const conn = connectionsRepo.createConnection({
      source: 'kiro',
      kind: 'api',
      label: pending.label || 'Kiro',
      authType: 'oauth',
      credentials: {
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        tokenUrl: pending.tokenUrl
      },
      meta: { apiBaseUrl: pending.apiBaseUrl }
    })
    connectionsRepo.updateConnection(conn.id, { status: 'connected' })
    return sendPopupResult(res, { ok: true })
  } catch (e) {
    return sendPopupResult(res, { ok: false, message: 'Kiro authorization failed: ' + e.message })
  }
})

// ---------------------------------------------------------------------------
// Dashboard bootstrap — the ONE call the frontend makes on load. Every
// browser/device hitting this server gets back the same centrally stored
// data; nothing here is per-browser.
// ---------------------------------------------------------------------------

// See server/auth/dashboardAccess.js for the filtering rules this route
// (and GET /api/users/:id/detail below) applies — the fix for "a user
// scoped to only e.g. 'kiro' could previously pull the full company-wide
// dashboard" (this route used to apply no filtering beyond the blanket
// requireAuth: any authenticated user with SOME access at all).
app.get('/api/dashboard', (req, res) => {
  const allConnections = connectionsRepo.listConnections().map(connectionsRepo.toSafeView)
  const connections = filterConnectionsForAccess(allConnections, req.access)
  const dataByConnection = {}
  for (const conn of connections) {
    let records = recordsRepo.getRecordsForConnection(conn.id)
    // Additive, read-time-only enrichment: attaches real SKU/service-plan/
    // account-status data (already synced separately via the Users &
    // Directory / Licenses capabilities) onto the Copilot usage records
    // this connection already produced. Never touches the Copilot usage
    // fetch itself, and never blocks it — if Users/Licenses aren't
    // enabled/synced yet, every added field is simply left null.
    if (conn.source === 'microsoft') {
      const users = msRepo.listUsers(conn.id)
      const licenses = msRepo.listLicenses(conn.id)
      const enriched = enrichCopilotRecords(records.filter((r) => r.product === 'Microsoft Copilot'), { users, licenses })
      let i = 0
      records = records.map((r) => (r.product === 'Microsoft Copilot' ? enriched[i++] : r))
      // Current-license population, not "appeared in the usage report" —
      // see excludeUnlicensedCopilotUsage's own comment.
      records = excludeUnlicensedCopilotUsage(records)
    }
    dataByConnection[conn.id] = records
  }
  // Centralized cost engine (server/services/costEngine.js) — one pass,
  // every connection, every provider. Stays current without a re-sync:
  // an admin editing a cost rule or exchange rate is reflected on the
  // very next dashboard load. Shared-seat consolidation (e.g. a person's
  // Claude Code + Claude Chat records are the same paid Anthropic seat)
  // must run across ALL connections together, not one at a time, in case
  // the two CSVs were ever imported as separate connections.
  const costOptions = { rules: costRuleRepo.listActiveRules(), exchangeRates: exchangeRateRepo.listRates(), appCurrency: settingsRepo.getCurrency() }
  const connIds = Object.keys(dataByConnection)
  const counts = connIds.map((id) => dataByConnection[id].length)
  const flatResolved = consolidateSharedSeats(resolveCostForRecords(connIds.flatMap((id) => dataByConnection[id]), costOptions))
  let offset = 0
  connIds.forEach((id, i) => {
    dataByConnection[id] = flatResolved.slice(offset, offset + counts[i])
    offset += counts[i]
  })
  const lastUpdated = connections.map((c) => c.lastSync).filter(Boolean).sort().slice(-1)[0] || null
  // Microsoft 365 is the sole authoritative source for canonical org/identity
  // fields (job_title/department/vbu/manager/company/office/domain/
  // account_status) — src/utils/userModel.js#buildCanonicalUsers consumes
  // this directory client-side and never falls back to any other source
  // for these eight fields. Built once here (unscoped) so real VBU scoping
  // below can resolve each record's owner; the RESPONSE's own copy is
  // scoped separately (see scopeMicrosoftDirectory below) — a non-admin
  // must never receive another VBU's directory entries either (name/
  // department/job title), not just their usage records.
  const fullMicrosoftDirectory = canSeeMicrosoftDirectory(req.access)
    ? buildMicrosoftDirectory(msRepo.listAllUsers())
    : new Map()
  // Real VBU data isolation (server/auth/vbuScope.js) — a record's own
  // `vbu` field is always null (every normalizer leaves it unset; VBU is
  // Microsoft-365-exclusive), so ownership is resolved per record through
  // the directory built above. Admins: unchanged, full company-wide data.
  for (const id of connIds) {
    dataByConnection[id] = scopeRecordsByVbu(dataByConnection[id], fullMicrosoftDirectory, req.access)
  }
  const microsoftDirectory = Object.fromEntries(scopeMicrosoftDirectory(fullMicrosoftDirectory, req.access))
  // Dashboard Cost Trend (Overview page) — reuses the SAME centralized
  // cost dataset/scoping every Cost Analytics route already builds
  // (costAnalytics.js#buildCostDataset already applies req.access's
  // effective VBU scope), so the trend can never disagree with or bypass
  // what the rest of the dashboard shows.
  const costDataset = costAnalytics.buildCostDataset(req.access)
  const costTrend = costAnalytics.costTrend(costAnalytics.flattenForCost(costDataset.canonicalUsers), req.access)
  res.json({ connections, dataByConnection, lastUpdated, currency: costOptions.appCurrency, microsoftDirectory, costTrend })
})

// ---------------------------------------------------------------------------
// Generic connection management (list / create / sync / disconnect)
// ---------------------------------------------------------------------------

app.get('/api/connections', requirePage('data-sources'), (req, res) => {
  const { source } = req.query
  const list = connectionsRepo.listConnections(source).map((c) => {
    const safe = connectionsRepo.toSafeView(c)
    if (c.source === 'microsoft') {
      safe.capabilities = c.meta.capabilities || ['copilot']
      safe.capabilityStatus = buildCapabilityStatus(c.id, safe.capabilities)
    }
    // VBU-scoping audit finding: `stats` (users/records) is a company-wide
    // aggregate computed at sync/import time, with no VBU dimension —
    // recomputing a genuinely per-VBU count here would need a per-source-
    // type-aware record fetch (each source stores records in a different
    // shape/table). Rather than build that just to expose a number, fail
    // closed for a scoped caller (never fail open) — an admin (unscoped)
    // sees exactly what they see today.
    if (!isAdminAccess(req.access)) delete safe.stats
    return safe
  })
  res.json({ connections: list })
})

// Static capability metadata (label/endpoints/permissions/implemented) for
// the "Configure" checkbox UI — the same registry sync.js runs against.
app.get('/api/microsoft/capabilities', (req, res) => {
  res.json({ capabilities: CAPABILITY_ORDER.map((key) => ({ key, ...MICROSOFT_CAPABILITIES[key] })) })
})

// ---------------------------------------------------------------------------
// Centralized Cost / Billing Management (the "Cost" page). Reads/writes
// cost_rules, application_settings (currency), and exchange_rates —
// server/services/costEngine.js is the only place these are actually
// applied to real records (in /api/dashboard above). Writes are admin
// actions like everything else in this app; this stays purely a cost-
// reporting/configuration surface, never license assignment.
// ---------------------------------------------------------------------------
app.get('/api/settings/currency', (req, res) => {
  res.json({ currency: settingsRepo.getCurrency() })
})

app.put('/api/settings/currency', requireWrite, (req, res) => {
  const { currency } = req.body || {}
  if (!currency || typeof currency !== 'string') return res.status(400).json({ error: 'currency is required' })
  settingsRepo.setCurrency(currency)
  res.json({ currency: settingsRepo.getCurrency() })
})

app.get('/api/exchange-rates', (req, res) => {
  res.json({ rates: exchangeRateRepo.listRates() })
})

app.put('/api/exchange-rates/:base/:target', requireWrite, (req, res) => {
  const { rate, rateDate, source } = req.body || {}
  if (rate === undefined || rate === null || Number.isNaN(Number(rate))) return res.status(400).json({ error: 'rate must be a number' })
  const row = exchangeRateRepo.setRate({ baseCurrency: req.params.base.toUpperCase(), targetCurrency: req.params.target.toUpperCase(), rate, rateDate, source })
  res.json({ rate: row })
})

app.delete('/api/exchange-rates/:base/:target', requireWrite, (req, res) => {
  exchangeRateRepo.deleteRate(req.params.base.toUpperCase(), req.params.target.toUpperCase())
  res.json({ ok: true })
})

// Automatic daily FX rates (server/services/fx/ — Part 3 of the currency-
// conversion spec this implements). The browser never calls the FX
// provider directly (Part 9) — it only ever reads this route's cached
// status, or triggers a refresh through it; the actual provider call and
// caching live entirely in fxService.js/the exchange_rates table
// costEngine.js's convert() already reads.
app.get('/api/fx/status', (req, res) => {
  res.json(fxService.getFxStatus())
})

app.get('/api/fx/currencies', (req, res) => {
  res.json({ currencies: fxService.SUPPORTED_CURRENCIES })
})

app.post('/api/fx/refresh', requireWrite, async (req, res) => {
  const result = await fxService.refreshRates({ force: true })
  res.status(result.ok || result.skipped ? 200 : 502).json(result)
})

app.get('/api/cost/rules', requirePage('cost'), (req, res) => {
  res.json({ rules: costRuleRepo.listAllRules() })
})

app.post('/api/cost/rules', requireWrite, (req, res) => {
  const { provider, product } = req.body || {}
  if (!provider || !product) return res.status(400).json({ error: 'provider and product are required' })
  res.status(201).json({ rule: costRuleRepo.createRule(req.body) })
})

app.put('/api/cost/rules/:id', requireWrite, (req, res) => {
  const rule = costRuleRepo.updateRule(req.params.id, req.body || {})
  if (!rule) return res.status(404).json({ error: 'Cost rule not found' })
  res.json({ rule })
})

app.delete('/api/cost/rules/:id', requireWrite, (req, res) => {
  costRuleRepo.deleteRule(req.params.id)
  res.json({ ok: true })
})

// Server-side aggregation (never ships every record to the browser just to
// sum it) — one pass over every connection's already cost-resolved records.
app.get('/api/cost/summary', requirePage('cost'), (req, res) => {
  const rules = costRuleRepo.listActiveRules()
  const exchangeRates = exchangeRateRepo.listRates()
  const appCurrency = settingsRepo.getCurrency()
  // mergeSeatGroupRecords (src/utils/productModel.js) collapses sibling
  // records that are really one seat (e.g. Claude Chat + Claude Code) into
  // one canonical product record — so this page's own license counts match
  // Users/Products (Part 17/30 of the spec: ONE Claude license, not two).
  // getAllEnrichedRecords (recordsPipeline.js) applies the same real
  // Microsoft license-assignment enrichment /api/dashboard does — without
  // it, a Copilot usage-report user who's since lost their license would
  // never be recognized as license_status inactive here.
  // This route doesn't go through costAnalytics.buildCostDataset (unlike
  // every route below), so VBU scoping is applied directly here — see
  // server/auth/vbuScope.js.
  let records = mergeSeatGroupRecords(consolidateSharedSeats(resolveCostForRecords(getAllEnrichedRecords(), { rules, exchangeRates, appCurrency })))
  records = scopeRecordsByVbu(records, buildMicrosoftDirectory(msRepo.listAllUsers()), req.access)

  // A 'shared_seat' record's cost genuinely IS known — it's just recorded
  // on the sibling record that carries the actual seat, so it counts as
  // "covered" here without contributing its own (null) amount to spend.
  // 'inactive_license' (costEngine.js) is likewise intentionally zero, not
  // missing — the license isn't currently assigned, so no seat cost
  // applies (License Status vs Usage Status — see src/utils/licenseStatus.js).
  const isCovered = (r) => (r.display_cost !== null && r.display_cost !== undefined) || r.cost_type === 'shared_seat' || r.cost_type === 'inactive_license'
  const withCost = records.filter(isCovered)
  const totalMonthlySpend = records.reduce((s, r) => s + (Number(r.display_cost) || 0), 0)
  const coverage = records.length ? Math.round((withCost.length / records.length) * 100) : null

  function groupBy(keyFn) {
    const groups = {}
    for (const r of records) {
      const key = keyFn(r) || 'Unknown'
      if (!groups[key]) groups[key] = { licenses: 0, withCost: 0, spend: 0 }
      groups[key].licenses += 1
      if (isCovered(r)) groups[key].withCost += 1
      groups[key].spend += Number(r.display_cost) || 0
    }
    return groups
  }

  res.json({
    currency: appCurrency,
    totalLicenses: records.length,
    licensesWithCost: withCost.length,
    licensesMissingCost: records.length - withCost.length,
    costCoveragePct: coverage,
    totalMonthlySpend: Math.round(totalMonthlySpend * 100) / 100,
    totalAnnualizedSpend: Math.round(totalMonthlySpend * 12 * 100) / 100,
    byProvider: groupBy((r) => r.provider),
    byProduct: groupBy((r) => r.product),
    byDepartment: groupBy((r) => r.department),
    byVbu: groupBy((r) => r.vbu)
  })
})

// Products/plans with no matching cost rule at all — drives the "Missing
// Pricing" section so nothing with an unknown cost is silently hidden.
app.get('/api/cost/missing', requirePage('cost'), (req, res) => {
  const rules = costRuleRepo.listActiveRules()
  const exchangeRates = exchangeRateRepo.listRates()
  const appCurrency = settingsRepo.getCurrency()
  let records = mergeSeatGroupRecords(consolidateSharedSeats(resolveCostForRecords(getAllEnrichedRecords(), { rules, exchangeRates, appCurrency })))
  records = scopeRecordsByVbu(records, buildMicrosoftDirectory(msRepo.listAllUsers()), req.access)
  // plan_conflict (src/utils/productModel.js) also has no resolved cost —
  // its capability sources disagree on plan, so it's surfaced here too
  // rather than only in the strictly-"never configured" unavailable case.
  const missing = records.filter((r) => r.cost_type === 'unavailable' || r.cost_type === 'plan_conflict')

  const byProductPlan = {}
  for (const r of missing) {
    const key = `${r.product}::${r.plan || ''}::${r.sku_part_number || r.sku || ''}`
    if (!byProductPlan[key]) byProductPlan[key] = { product: r.product, plan: r.plan || null, sku: r.sku_part_number || r.sku || null, users: new Set(), licenses: 0 }
    byProductPlan[key].users.add(r.email || r._id)
    byProductPlan[key].licenses += 1
  }
  res.json({
    totalMissing: missing.length,
    items: Object.values(byProductPlan).map((g) => ({ ...g, users: g.users.size }))
  })
})

// ---------------------------------------------------------------------------
// Cost Analytics — audit/management views (server/services/costAnalytics.js).
// Every route below builds the SAME cost-resolved, identity-merged dataset
// (buildCostDataset) and aggregates it in-process; at this app's real data
// scale (hundreds of users/products) that's a few milliseconds, so there is
// no separate cache/table to keep in sync — the same tradeoff /api/dashboard
// and /api/cost/summary already make. Read-only, no secrets.
// buildCostDataset(req.access) is also where real VBU data isolation is
// enforced for every one of these routes (server/auth/vbuScope.js) — a
// non-admin's canonicalUsers is already scoped to their own VBU before any
// aggregation below runs.
// ---------------------------------------------------------------------------

app.get('/api/cost/overview', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency, lastUpdated } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, lastUpdated, ...costAnalytics.costOverview(rows, req.access) })
})

app.get('/api/cost/products', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, items: costAnalytics.aggregateBy(rows, (r) => r.product, (first) => ({ provider: first.provider })) })
})

app.get('/api/cost/products/:name', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  const detail = costAnalytics.productDetail(rows, req.params.name)
  if (!detail) return res.status(404).json({ error: 'Product not found in current cost data' })
  res.json({ currency: appCurrency, ...detail })
})

app.get('/api/cost/departments', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, items: costAnalytics.aggregateBy(rows, (r) => r.department) })
})

app.get('/api/cost/departments/:name', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  const detail = costAnalytics.departmentDetail(rows, req.params.name)
  if (!detail) return res.status(404).json({ error: 'Department not found in current cost data' })
  res.json({ currency: appCurrency, ...detail })
})

app.get('/api/cost/vbus', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, items: costAnalytics.aggregateBy(rows, (r) => r.vbu) })
})

app.get('/api/cost/vbus/:name', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  const detail = costAnalytics.vbuDetail(rows, req.params.name)
  if (!detail) return res.status(404).json({ error: 'VBU not found in current cost data' })
  res.json({ currency: appCurrency, ...detail })
})

// Cost -> By VBU dashboard's data source — the combinable-filter version of
// /api/cost/vbus/:name above (single VBU only) — accepts any of the query
// params below together (e.g. ?vbu=X&department=Y), matching a real
// audit workflow. Server-side aggregation only — the browser never sums
// rows itself (Part 10 of the spec this implements).
app.get('/api/cost/by-vbu', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  const { vbu, department, provider, product, plan, domain, usageStatus, licenseStatus, user } = req.query
  const result = costAnalytics.vbuAnalytics(rows, { vbu, department, provider, product, plan, domain, usageStatus, licenseStatus, user })
  res.json({ currency: appCurrency, ...result })
})

app.get('/api/cost/domains', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, items: costAnalytics.aggregateBy(rows, (r) => r.domain) })
})

app.get('/api/cost/domains/:domain', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  const detail = costAnalytics.domainDetail(rows, req.params.domain.toLowerCase())
  if (!detail) return res.status(404).json({ error: 'Domain not found in current cost data' })
  res.json({ currency: appCurrency, ...detail })
})

app.get('/api/cost/plans', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  res.json({ currency: appCurrency, items: costAnalytics.planList(rows) })
})

app.get('/api/cost/users', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  res.json({ currency: appCurrency, items: costAnalytics.userList(canonicalUsers) })
})

app.get('/api/cost/users/:id', requirePage('cost'), (req, res) => {
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const user = costAnalytics.userDetail(canonicalUsers, req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found in current cost data' })
  res.json({ currency: appCurrency, user })
})

app.get('/api/cost/groups', requirePage('cost'), (req, res) => {
  res.json(costAnalytics.groupsAvailability())
})

// Provider-aware user detail (Part 12 of the canonical-identity/utilization
// spec this implements) — ONE endpoint reused by every provider's detail
// view, built on the SAME cost-resolved dataset costAnalytics already
// builds once per request (no separate pricing/identity logic, no N+1).
// See server/auth/dashboardAccess.js — same filtering rules as
// GET /api/dashboard above, applied per-provider here since this endpoint
// takes an arbitrary `provider` query param.
app.get('/api/users/:id/detail', (req, res) => {
  const provider = req.query.provider
  if (!provider) return res.status(400).json({ error: 'provider query parameter is required' })
  if (!canAccessDetailProvider(req.access, provider)) {
    auditLogRepo.record({ eventType: 'access_denied', actorUpn: req.user.upn, actorOid: req.user.oid, detail: { path: req.originalUrl, provider } })
    return res.status(403).json({ error: 'You do not have access to this page.' })
  }
  const { canonicalUsers, appCurrency } = costAnalytics.buildCostDataset(req.access)
  const user = costAnalytics.userDetail(canonicalUsers, req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found in current dashboard data' })
  const detail = userDetailService.buildProviderUserDetail(user, provider)
  if (!detail) return res.status(404).json({ error: `This user has no current ${provider} license/usage record.` })
  if (detail.error) return res.status(400).json(detail)
  res.json({ currency: appCurrency, ...detail })
})

// Aggregated Microsoft 365 data (users/devices/applications/licenses/
// departments/domains) across every connected Microsoft 365 connection —
// powers the Microsoft 365 dashboard page. Read-only, no secrets.
app.get('/api/microsoft/data', requirePage('microsoft-365'), (req, res) => {
  // Real VBU data isolation (server/auth/vbuScope.js) — scopes users first,
  // then every other dataset by whichever join key it has to a scoped
  // user. `groups` has no membership data synced at all (same gap
  // costAnalytics.js#groupsAvailability documents), so it can't be scoped
  // and is left as-is — admins and non-admins alike see the same group
  // catalog, which carries no per-user business data.
  const { users, devices, applications, deviceApplications, licenses, signIns } = scopeMicrosoftDataset({
    users: msRepo.listAllUsers(),
    devices: msRepo.listAllDevices(),
    applications: msRepo.listAllApplications(),
    deviceApplications: msRepo.listAllDeviceApplications(),
    licenses: msRepo.listAllLicenses(),
    signIns: msRepo.listAllSignIns()
  }, req.access)
  const groups = msRepo.listAllGroups()
  res.json({
    users,
    devices,
    applications,
    deviceApplications,
    licenses,
    groups,
    signIns,
    departments: aggregateDepartments(users),
    domains: aggregateDomains(users)
  })
})

// Lightweight application-inventory payload for the Application page —
// deliberately NOT the same as /api/microsoft/data below, which also
// returns the full Users & Directory/licenses/groups/sign-ins datasets
// Microsoft365.jsx needs but Applications.jsx never reads at all. Shipping
// that ~2,000+ full user-record dataset just to open the Application page
// was pure waste (Part 21 of the performance spec this fixes); this trims
// devices down to only the two fields (ms_id, user_principal_name) that
// page's unique-user-count aggregation actually uses.
app.get('/api/microsoft/applications-overview', requirePage('microsoft-365'), (req, res) => {
  const { applications, deviceApplications, deviceUserLinks } = scopeApplicationsOverview({
    users: msRepo.listAllUsers(),
    deviceUserLinks: msRepo.listAllDeviceUserLinks(),
    deviceApplications: msRepo.listAllDeviceApplications(),
    applications: msRepo.listAllApplications()
  }, req.access)
  res.json({ applications, deviceApplications, devices: deviceUserLinks })
})

// Full monthly Kiro usage history (every User+Month row) — used only by the
// dedicated Kiro page's own monthly table. The global Users/Products/Cost/
// Optimization/Reports pages never call this; they see Kiro through the
// generic canonical pipeline's one-current-record-per-user feed instead
// (see /api/kiro/import-csv above).
app.get('/api/kiro/data', requirePage('kiro'), (req, res) => {
  const directory = buildMicrosoftDirectory(msRepo.listAllUsers())
  res.json({ usage: scopeRecordsByVbu(kiroRepo.listAllUsage(), directory, req.access) })
})

// Freshservice manual CSV upload (Data Sources → Freshservice, manual_csv
// method) — the current Freshservice ingestion method alongside the
// Microsoft 365 security group (the automatic SharePoint CSV method this
// replaced was removed entirely; see server/services/freshservice/sync.js's
// own header comment). `rows` are already parsed client-side (same as every
// other CSV import in this app) — this route does not accept raw file
// content. Safe-import flow lives in services/freshservice/sync.js#
// importFreshserviceCsv (shared with nothing else, since this is
// Freshservice-specific validation/normalization).
//
// Deliberately a single self-provisioning request (no separate "create the
// connection first" step, and no :id in the URL) — Freshservice is a
// singleton-per-app connection (upsertFreshserviceConnection), so this
// route resolves the existing one automatically when `id` is omitted. This
// is also why NONE of the Microsoft 365 Security Group method's validation
// (securityGroupName etc. — see the 'ms_group' branch of POST
// /api/connections above) can ever run here: this route only ever touches
// manual_csv config, and only when first creating the connection or
// switching an existing one from ms_group to manual_csv (uploading a CSV
// is itself the administrator's explicit choice of this method). A
// same-method re-import skips upsert entirely and goes straight to
// importFreshserviceCsv, so a failed re-import never resets the previous
// successful import's stats/status (see importCsv.test.js).
app.post('/api/freshservice/import-csv', requireWrite, (req, res) => {
  const { id, msConnectionId, rows, fileName } = req.body || {}
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'The uploaded file contained no data rows.' })

  let conn = id ? connectionsRepo.getConnection(id) : (connectionsRepo.listConnections('freshservice')[0] || null)
  if (conn && conn.source !== 'freshservice') return res.status(400).json({ error: 'That connection id is not a Freshservice source.' })

  if (!conn || conn.meta.sourceMethod !== 'manual_csv') {
    const linkMsConnectionId = msConnectionId || conn?.meta.msConnectionId
    if (!linkMsConnectionId) return res.status(400).json({ error: 'Microsoft 365 connection is required for Freshservice.' })
    const msConn = connectionsRepo.getConnection(linkMsConnectionId)
    if (!msConn || msConn.source !== 'microsoft') return res.status(400).json({ error: 'Microsoft 365 connection is required for Freshservice.' })
    conn = upsertFreshserviceConnection({
      label: conn?.label || 'Freshservice', authType: 'delegated_graph',
      meta: { sourceMethod: 'manual_csv', msConnectionId: linkMsConnectionId, enabled: true }
    }).connection
  }

  const result = importFreshserviceCsv(conn, rows, fileName)
  if (!result.ok) return res.status(400).json(result)
  res.json({ connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), recordCount: result.recordCount, diagnostics: result.diagnostics })
})

// Manual Kiro usage CSV import: validate structurally -> normalize+aggregate+match -> ONLY THEN replace
// the stored dataset, so an invalid file never touches previously-imported
// Kiro data. Re-importing the SAME file is idempotent for free: normalization
// is a pure function of the CSV content, and replaceRecordsForConnection is
// a full delete+insert, so the same input always yields the same stored
// rows, never doubled.
app.post('/api/kiro/import-csv', requireWrite, (req, res) => {
  const { id, rows, fileName } = req.body || {}
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'The uploaded file contained no data rows.' })

  const structural = validateKiroCsv(rows)
  if (!structural.valid) {
    if (id) syncHistoryRepo.recordSyncAttempt({ connectionId: id, status: 'error', errorMessage: `Manual CSV rejected: ${structural.reason}` })
    return res.status(400).json({ error: 'Invalid Kiro CSV', reason: structural.reason })
  }

  // Kiro attaches to EXISTING canonical Microsoft users by email only — it
  // never creates its own population and never uses email domain as a
  // substitute (see kiroNormalizer.js header comment). listAllUsers() is
  // already gated to the SSP company population at sync time
  // (microsoftRepo.js#upsertUsers), so this set needs no re-filtering here.
  const validEmails = buildValidEmailSet(msRepo.listAllUsers())

  const { records, diagnostics } = normalizeKiroUsage(rows, { validEmails })

  let conn = id ? connectionsRepo.getConnection(id) : null
  if (conn && conn.source !== 'kiro') return res.status(400).json({ error: 'That connection id is not a Kiro source.' })
  if (!conn) {
    conn = connectionsRepo.createConnection({ source: 'kiro', kind: 'csv', label: 'Kiro (CSV)', authType: 'file', meta: { sourceType: 'csv' } })
  }

  // Full monthly history -> its own table, for the dedicated Kiro page's
  // monthly table. Only the LATEST month per user -> the generic canonical
  // pipeline, which holds one CURRENT record per person per product
  // everywhere else in this app (see kiroNormalizer.js#selectLatestPerUser).
  kiroRepo.replaceUsageForConnection(conn.id, records)
  const currentRecords = selectLatestPerUser(records)
  recordsRepo.replaceRecordsForConnection(conn.id, currentRecords)
  const now = new Date().toISOString()
  const lastManualImport = { fileName: fileName || 'upload.csv', importedAt: now, ...diagnostics }
  connectionsRepo.updateConnection(conn.id, {
    status: 'connected',
    lastError: null,
    lastSync: now,
    lastAttempt: now,
    stats: { users: diagnostics.matchedRecords, records: diagnostics.matchedRecords },
    meta: { sourceType: 'csv', lastImportSourceType: 'manual_csv', lastManualImport }
  })
  syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: records.length })
  res.json({ connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), diagnostics })
})

// ---------------------------------------------------------------------------
// Claude automatic OneDrive/SharePoint MTD source — see the bootstrap block
// near the top of this file for how the single connection is provisioned,
// and server/services/claude/sync.js for the full refresh pipeline. Every
// response below is built from connectionsRepo.toSafeView() (never includes
// credentials) plus plain operational numbers — no password, token, or
// stack trace ever reaches the frontend.
// ---------------------------------------------------------------------------
// recordCount/uniqueUserCount are derived from the SAME scoped record set
// GET /api/claude/data already returns (VBU-scoping audit finding) — this
// used to read conn.stats.records/.users directly, a company-wide aggregate
// computed at sync/import time with no VBU dimension at all, so a
// VBU-scoped Claude-page user saw everyone's totals regardless of their own
// access. `access` is required so an admin (unscoped, unchanged from
// before) and a scoped caller (now genuinely narrowed) both get a count
// that matches what GET /api/claude/data would actually show them.
function claudeStatusPayload(access) {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return { configured: false }
  const snapshot = claudeRepo.latestSnapshot(conn.id)
  const directory = buildMicrosoftDirectory(msRepo.listAllUsers())
  const scopedRecords = scopeRecordsByVbu(
    claudeRepo.currentRecords(conn.id).map((r) => ({ ...r, email: r.user_email })),
    directory,
    access
  )
  return {
    configured: true,
    connection: connectionsRepo.toSafeView(conn),
    schedule: 'Daily',
    reportingType: 'MTD Snapshot',
    lastChecked: conn.lastAttempt || null,
    lastSuccessfulSync: conn.lastSync || null,
    recordCount: scopedRecords.length,
    uniqueUserCount: new Set(scopedRecords.map((r) => r.email).filter(Boolean)).size,
    lastSnapshotStatus: snapshot?.status || 'never_synced',
    lastError: conn.lastError || null,
    // Whether a share-link password is currently stored — NEVER the value
    // itself, which is never read back off `conn.credentials` anywhere in
    // this function or sent to the browser in any other response.
    passwordConfigured: !!conn.credentials?.password
  }
}

app.get('/api/claude/source', requirePage('claude'), (req, res) => res.json(claudeStatusPayload(req.access)))
app.get('/api/claude/status', requirePage('claude'), (req, res) => res.json(claudeStatusPayload(req.access)))

// Share-link password setup (Part 3 of the spec this implements) — the
// ONLY thing this route ever returns is a plain success/failure; the
// submitted password is written straight into the existing encrypted
// credential store (server/crypto.js, same AES-256-GCM mechanism every
// other provider's secrets use) and never echoed back, logged, or included
// in any error message.
app.post('/api/claude/password', requireWrite, (req, res) => {
  const { password } = req.body || {}
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'A share-link password is required.' })
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.status(404).json({ error: 'Claude automatic source is not configured.' })
  connectionsRepo.updateConnection(conn.id, { credentials: { password } })
  res.json({ success: true })
})

app.get('/api/claude/snapshots', requirePage('claude'), (req, res) => {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.json({ snapshots: [] })
  // recordCount/uniqueUserCount are recomputed from each snapshot's own
  // records, scoped the same way claudeStatusPayload above is (VBU-scoping
  // audit finding) — s.record_count/s.unique_user_count are the company-wide
  // totals stored at import time, with no VBU dimension at all. Matches an
  // admin's view exactly (scopeRecordsByVbu is a no-op for isAdminAccess),
  // genuinely narrows for a VBU-scoped caller.
  const directory = buildMicrosoftDirectory(msRepo.listAllUsers())
  const snapshots = claudeRepo.listSnapshots(conn.id).map((s) => {
    const scoped = scopeRecordsByVbu(
      claudeRepo.recordsForSnapshot(s.id).map((r) => ({ ...r, email: r.user_email })),
      directory,
      req.access
    )
    return {
      id: s.id, snapshotImportedAt: s.snapshot_imported_at, reportingType: s.reporting_type,
      recordCount: scoped.length, uniqueUserCount: new Set(scoped.map((r) => r.email).filter(Boolean)).size, status: s.status,
      errorMessage: s.error_message, createdAt: s.created_at
    }
  })
  res.json({ snapshots })
})

app.get('/api/claude/data', requirePage('claude'), (req, res) => {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.json({ records: [] })
  const directory = buildMicrosoftDirectory(msRepo.listAllUsers())
  // claude_mtd_snapshot_records stores the identity column as user_email,
  // not email — scopeRecordsByVbu (server/auth/vbuScope.js) expects
  // `.email`, so alias it here rather than change the shared helper's
  // convention or this table's own column name.
  const records = claudeRepo.currentRecords(conn.id).map((r) => ({ ...r, email: r.user_email }))
  res.json({ records: scopeRecordsByVbu(records, directory, req.access) })
})

app.post('/api/claude/refresh', requireWrite, async (req, res) => {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.status(404).json({ error: 'Claude automatic source is not configured.' })
  const result = await runClaudeSync(conn, { respectSchedule: false })
  res.status(result.ok ? 200 : 502).json({ success: result.ok, ...result.body })
})

app.post('/api/claude/start', requireWrite, (req, res) => {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.status(404).json({ error: 'Claude automatic source is not configured.' })
  connectionsRepo.updateConnection(conn.id, { meta: { enabled: true } })
  res.json(claudeStatusPayload())
})

app.post('/api/claude/stop', requireWrite, (req, res) => {
  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.status(404).json({ error: 'Claude automatic source is not configured.' })
  // Disables future scheduled/refresh-all runs only — never touches
  // claude_mtd_snapshots or usage_records (Part 19: stopping must not
  // erase data).
  connectionsRepo.updateConnection(conn.id, { meta: { enabled: false } })
  res.json(claudeStatusPayload())
})

// Manual CSV upload fallback (Part 20) — same required-column validation,
// normalization, canonical-user matching and safe-commit pipeline as the
// automatic path (server/services/claude/sync.js), just triggered by an
// uploaded file instead of a SharePoint/OneDrive download. Rows are already
// parsed client-side (src/utils/csvParser.js), matching every other manual
// CSV import in this app.
app.post('/api/claude/import-csv', requireWrite, (req, res) => {
  const { rows, fileName } = req.body || {}
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'The uploaded file contained no data rows.' })

  const conn = connectionsRepo.listConnections('Claude').find((c) => c.kind === 'api')
  if (!conn) return res.status(404).json({ error: 'Claude automatic source is not configured.' })

  const structural = validateClaudeCsv(rows)
  if (!structural.valid) {
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'error', errorMessage: `Manual CSV rejected: ${structural.reason}` })
    return res.status(400).json({ error: 'Invalid Claude MTD CSV', reason: structural.reason })
  }

  const msUsers = msRepo.listAllUsers()
  const validEmails = buildValidEmailSet(msUsers)
  const { records, diagnostics } = normalizeClaudeSnapshot(rows, { validEmails })
  if (!records.length) {
    return res.status(400).json({ error: 'No rows matched a current Microsoft 365 user.', diagnostics })
  }

  const now = new Date().toISOString()
  const snapshotHash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  claudeRepo.recordSnapshot({
    connectionId: conn.id, snapshotHash, snapshotImportedAt: now,
    recordCount: records.length, uniqueUserCount: diagnostics.uniqueUserCount, status: 'success', records
  })
  recordsRepo.replaceRecordsForConnection(conn.id, records.map((r) => ({ ...r, _snapshot_imported_at: now, reporting_type: 'MTD', _source: 'Claude MTD snapshot (manual CSV)' })))
  connectionsRepo.updateConnection(conn.id, {
    status: 'connected', lastError: null, lastSync: now, lastAttempt: now,
    stats: { users: diagnostics.uniqueUserCount, records: records.length },
    meta: { lastImportSourceType: 'manual_csv', lastManualImport: { fileName: fileName || 'upload.csv', importedAt: now, recordCount: records.length } }
  })
  syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: records.length })
  res.json({ connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), diagnostics })
})

// License-centric Microsoft 365 -> Licenses page (server/services/
// microsoftLicenses.js): one row per distinct current license/SKU, reusing
// the same cost-resolved dataset costAnalytics.js already builds for
// Microsoft Copilot so this count can never disagree with Products/Cost.
// Real VBU data isolation: `vbu` is an admin-only free-choice narrowing
// filter (an admin may legitimately want to look at one specific VBU's
// licenses); a non-admin's own query-string `vbu` is ignored outright and
// replaced with their own effective allowed-VBU scope (server/auth/
// vbuScope.js#effectiveVbuFilterValue — a comma-joined list, or a value
// that matches nothing at all if their Dashboard View's configured scope
// excludes them) — never trusted from the client (VBU-aware-views spec,
// section 6: "either ignore the supplied VBU and enforce the authenticated
// user's scope"). Reuses microsoftLicenses.js's existing filters object
// unchanged (matchesAny already accepts a comma-separated list) — no
// changes needed inside that file at all.
app.get('/api/microsoft/licenses', requirePage('microsoft-365'), (req, res) => {
  const { department, license } = req.query
  const vbu = isAdminAccess(req.access) ? req.query.vbu : effectiveVbuFilterValue(req.access)
  res.json({ items: microsoftLicenses.licenseOverview({ department, vbu, license }) })
})

app.get('/api/microsoft/licenses/:licenseId', requirePage('microsoft-365'), (req, res) => {
  const { department } = req.query
  const vbu = isAdminAccess(req.access) ? req.query.vbu : effectiveVbuFilterValue(req.access)
  const detail = microsoftLicenses.licenseDetail(req.params.licenseId, { department, vbu })
  if (!detail) return res.status(404).json({ error: 'License not found in current data' })
  res.json(detail)
})

// Drill-down detail views — read-only, no credentials/tokens ever returned.
// These are the only Microsoft 365 endpoints that make an on-demand live
// Graph call outside of a sync (see services/microsoft/detail.js for why:
// the bulk-synced device<->application linkage table only covers a small
// fraction of the ~5,000 application/version rows, but a single user's
// devices or a single application's versions are cheap to fetch live).
// Real VBU data isolation: the owning user is resolved and checked BEFORE
// the (occasionally live-Graph) detail fetch runs, for a non-admin whose
// VBU doesn't match — 404, same "not found" contract this app already
// uses for an out-of-scope id elsewhere, never confirming the record
// exists at all (server/auth/vbuScope.js#ownsMicrosoftUser).
app.get('/api/microsoft/users/:msId', requirePage('microsoft-365'), async (req, res) => {
  if (!ownsMicrosoftUser(msRepo.getUserByMsId(req.params.msId), req.access)) {
    return res.status(404).json({ error: 'User not found' })
  }
  try {
    const detail = await msDetail.getUserDetail(req.params.msId)
    if (!detail) return res.status(404).json({ error: 'User not found' })
    res.json(detail)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/microsoft/devices/:msId', requirePage('microsoft-365'), async (req, res) => {
  const device = msRepo.getDeviceByMsId(req.params.msId)
  const owner = device?.user_ms_id ? msRepo.getUserByMsId(device.user_ms_id) : null
  if (!device || !ownsMicrosoftUser(owner, req.access)) {
    return res.status(404).json({ error: 'Device not found' })
  }
  try {
    const detail = await msDetail.getDeviceDetail(req.params.msId)
    if (!detail) return res.status(404).json({ error: 'Device not found' })
    res.json(detail)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// :name is the application's display_name (URL-encoded by the caller) —
// "an application" in the UI groups every microsoft_applications row that
// shares this name, since Intune's detectedApps API stores one row per
// (name, version) combination, not one row per app.
// An application itself isn't VBU-owned (a tenant-wide software catalog
// entry) — only its per-device installation list is narrowed to the
// caller's own VBU for non-admins (server/auth/vbuScope.js#
// scopeApplicationDetailDevices); summary/version/linkage-coverage stats
// stay tenant-wide, same as costAnalytics.js's own honest-gap precedent
// for group data with no per-VBU membership to join on.
app.get('/api/microsoft/applications/:name', requirePage('microsoft-365'), (req, res) => {
  try {
    const detail = msDetail.getApplicationSummary(req.params.name)
    if (!detail) return res.status(404).json({ error: 'Application not found' })
    res.json(scopeApplicationDetailDevices(detail, msRepo.listAllUsers(), req.access))
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// Second-phase, on-demand device-linkage fetch (live Graph calls, bounded —
// see services/microsoft/detail.js). Only called by the client after the
// fast summary above has already rendered, and only when it reported
// missing linkage — keeps the initial application-detail response instant
// regardless of how many un-linked versions an application has.
app.get('/api/microsoft/applications/:name/linkage', requirePage('microsoft-365'), async (req, res) => {
  try {
    const detail = await msDetail.fetchApplicationDeviceLinkage(req.params.name)
    if (!detail) return res.status(404).json({ error: 'Application not found' })
    res.json(scopeApplicationDetailDevices(detail, msRepo.listAllUsers(), req.access))
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// Merges the static capability registry with this connection's latest
// per-capability sync outcome into the states the UI shows: not_implemented,
// ready (enabled, never synced), synced, no_data (synced fine, 0 rows),
// permission_missing, throttled, error. "Synced" is only ever shown after a
// real successful Graph sync recorded a microsoft_sync_runs row — never
// assumed.
function buildCapabilityStatus(connectionId, enabledKeys) {
  const latest = msRepo.latestSyncStatus(connectionId)
  return CAPABILITY_ORDER.filter((key) => enabledKeys.includes(key)).map((key) => {
    const def = MICROSOFT_CAPABILITIES[key]
    const run = latest[key]
    let status = 'ready'
    if (!def.implemented) status = 'not_implemented'
    else if (run) {
      if (run.status === 'success') status = (run.record_count > 0 ? 'synced' : 'no_data')
      else status = run.status // 'permission_missing' | 'throttled' | 'error'
    }
    return {
      key,
      label: def.label,
      implemented: def.implemented,
      requiredPermissions: def.permissions,
      status,
      lastAttemptedAt: run ? run.attempted_at : null,
      recordCount: run ? run.record_count : null,
      error: run ? run.error_message : null
    }
  })
}

app.post('/api/connections', requireWrite, async (req, res) => {
  const { source, authType, label } = req.body || {}
  let conn
  try {
    if (source === 'kiro' && authType === 'apiKey') {
      const { apiBaseUrl, apiKey, headerName } = req.body
      if (!apiBaseUrl) return res.status(400).json({ error: 'apiBaseUrl is required' })
      try {
        await assertSafeExternalUrl(apiBaseUrl, 'apiBaseUrl')
      } catch (e) {
        return res.status(400).json({ error: e.message })
      }
      conn = connectionsRepo.createConnection({
        source, kind: 'api', label: label || 'Kiro', authType,
        credentials: { apiKey, headerName },
        meta: { apiBaseUrl, headerName }
      })
    } else if (source === 'microsoft' && authType === 'client_credentials') {
      const { tenantId, clientId, clientSecret, period, capabilities, signInsDays } = req.body
      if (!tenantId || !clientId || !clientSecret) {
        return res.status(400).json({ error: 'tenantId, clientId and clientSecret are required' })
      }
      const enabledCapabilities = Array.isArray(capabilities) && capabilities.length
        ? capabilities.filter((c) => MICROSOFT_CAPABILITIES[c])
        : ['copilot']
      conn = connectionsRepo.createConnection({
        source, kind: 'api', label: label || 'Microsoft 365', authType,
        credentials: { tenantId, clientId, clientSecret },
        meta: { tenantId, period: period || 'D7', capabilities: enabledCapabilities, signInsDays: signInsDays || 30 }
      })
    } else if (source === 'freshservice') {
      // Freshservice has no API/credentials of its own — both supported
      // ingestion methods reference an existing, connected Microsoft 365
      // source and borrow its credentials; which method is active is the
      // administrator's explicit choice (sourceMethod), never both at
      // once. (A third method, automatic SharePoint CSV, existed
      // previously and was removed entirely — unreliable SharePoint
      // app-only permissions/authentication. A different automated source
      // is planned for later; this dispatch is deliberately kept to
      // exactly these two branches so adding it later means adding one
      // more branch here, not restructuring this route.)
      const { sourceMethod, msConnectionId, securityGroupName, securityGroupId } = req.body
      if (!msConnectionId) return res.status(400).json({ error: 'Microsoft 365 connection is required for Freshservice.' })
      const msConn = connectionsRepo.getConnection(msConnectionId)
      if (!msConn || msConn.source !== 'microsoft') {
        return res.status(400).json({ error: 'Microsoft 365 connection is required for Freshservice.' })
      }

      if (sourceMethod === 'manual_csv') {
        // No method-specific config at all — just links to the Microsoft
        // 365 connection (for identity matching) and waits for the
        // administrator to upload a CSV via POST /api/freshservice/:id/
        // import-csv. upsertFreshserviceConnection (not createConnection)
        // — Freshservice is a singleton-per-app connection; reconfiguring
        // reuses the existing row instead of ever inserting a second one.
        conn = upsertFreshserviceConnection({
          label: label || 'Freshservice', authType: 'delegated_graph',
          meta: { sourceMethod: 'manual_csv', msConnectionId, enabled: true }
        }).connection
      } else if (sourceMethod === 'ms_group' || !sourceMethod) {
        // 'ms_group' (also the default when sourceMethod is omitted) — the
        // group is resolved to a real Graph group id HERE, before the
        // connection is ever created, so a not-found/ambiguous name never
        // leaves a broken connection behind.
        if (!securityGroupName) return res.status(400).json({ error: 'Security group name is required.' })

        let resolvedGroupId = securityGroupId || null
        let resolvedGroupName = securityGroupName
        if (!resolvedGroupId) {
          let matches
          try {
            matches = await findGroupsByDisplayName(msConn.credentials, securityGroupName)
          } catch (e) {
            return res.status(502).json({ error: e.message })
          }
          if (!matches.length) {
            return res.status(404).json({ error: 'Security group not found. Check the group name and try again.' })
          }
          if (matches.length > 1) {
            // Do NOT silently pick one — the client re-submits this same
            // request with the chosen group's id as securityGroupId once
            // the administrator selects it.
            return res.status(409).json({ error: 'Multiple security groups share this name. Select the correct group.', multipleGroups: matches })
          }
          resolvedGroupId = matches[0].id
          resolvedGroupName = matches[0].displayName
        }

        conn = upsertFreshserviceConnection({
          label: label || 'Freshservice', authType: 'delegated_graph',
          meta: { sourceMethod: 'ms_group', msConnectionId, securityGroupName: resolvedGroupName, securityGroupId: resolvedGroupId, enabled: true }
        }).connection
      } else {
        return res.status(400).json({ error: 'Unsupported Freshservice source method. Use "ms_group" or "manual_csv".' })
      }
    } else {
      return res.status(400).json({ error: 'Unsupported source/authType combination. GitHub uses /auth/github; Kiro OAuth uses /api/kiro/oauth/start.' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  // Immediately attempt a sync so the user gets instant pass/fail feedback.
  const result = await runSync(conn)
  res.status(result.ok ? 201 : 502).json(result.body)
})

// Manual CSV/XLSX imports: the browser parses + normalizes the file with the
// existing frontend normalization logic (unchanged), then POSTs the already-
// normalized rows here to become the source of truth for every client.
app.post('/api/connections/csv', requireWrite, (req, res) => {
  const { id, provider, sourceType, label, rows } = req.body || {}
  if (!provider || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'provider and rows[] are required' })
  }
  const now = new Date().toISOString()
  let conn = id ? connectionsRepo.getConnection(id) : null
  if (conn && conn.kind !== 'csv') {
    return res.status(400).json({ error: 'That connection id is not a CSV/XLSX source.' })
  }
  if (!conn) {
    conn = connectionsRepo.createConnection({
      source: provider, kind: 'csv', label: label || provider, authType: 'file',
      meta: { sourceType: sourceType || 'csv' }
    })
  }
  recordsRepo.replaceRecordsForConnection(conn.id, rows)
  connectionsRepo.updateConnection(conn.id, {
    label: label || conn.label,
    status: 'connected',
    lastError: null,
    lastSync: now,
    lastAttempt: now,
    stats: { users: rows.length, records: rows.length },
    meta: { sourceType: sourceType || conn.meta.sourceType || 'csv' }
  })
  syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: rows.length })
  res.status(201).json({ connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)) })
})

// Generic connection patch — used today by the Microsoft 365 "Configure"
// flow to change enabled capabilities/period/label without recreating the
// connection (and without ever touching credentials via this route).
app.patch('/api/connections/:id', requireWrite, (req, res) => {
  const conn = connectionsRepo.getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const { label, capabilities, period, signInsDays, msConnectionId, enabled } = req.body || {}
  const meta = {}
  if (Array.isArray(capabilities)) meta.capabilities = capabilities.filter((c) => MICROSOFT_CAPABILITIES[c])
  if (period) meta.period = period
  if (signInsDays) meta.signInsDays = signInsDays
  if (msConnectionId !== undefined) meta.msConnectionId = msConnectionId
  if (enabled !== undefined) meta.enabled = enabled
  connectionsRepo.updateConnection(conn.id, { label, meta })
  res.json({ connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)) })
})

app.delete('/api/connections/:id', requireWrite, (req, res) => {
  const conn = connectionsRepo.getConnection(req.params.id)
  if (conn && conn.source === 'microsoft') msRepo.deleteAllForConnection(conn.id)
  if (conn && conn.source === 'kiro') kiroRepo.deleteAllForConnection(conn.id)
  if (conn && conn.source === 'Claude') claudeRepo.deleteAllForConnection(conn.id)
  const ok = connectionsRepo.deleteConnection(req.params.id)
  res.json({ ok })
})

app.post('/api/connections/:id/sync', requireWrite, async (req, res) => {
  const conn = connectionsRepo.getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const result = await runSync(conn)
  res.status(result.ok ? 200 : 502).json(result.body)
})

// Backend-owned "Refresh All" — loops every connected API source (CSV/XLSX
// sources are intentionally skipped: they have no live endpoint to refresh,
// per the product's own "manual import required" behavior). One failure
// never blocks the others.
// ?scheduled=true is set only by the frontend's automatic background timer
// (never by the "Refresh All" button click) — it tells sources with their
// own configurable refresh schedule (currently only Claude) to skip
// themselves if they're not due yet, instead of refreshing unconditionally.
// Freshservice has no schedule of its own anymore (Part 17 of the
// re-architecture spec: keep it simple) — it just refreshes every time,
// same as GitHub/Kiro.
app.post('/api/sources/refresh-all', requireWrite, async (req, res) => {
  const respectSchedule = req.query.scheduled === 'true'
  const apiConnections = connectionsRepo.listConnections().filter((c) => c.kind === 'api')
  const settled = await Promise.allSettled(apiConnections.map((c) => runSync(c, { respectSchedule })))
  const results = settled.map((r, i) => {
    const conn = apiConnections[i]
    if (r.status === 'fulfilled') {
      return { id: conn.id, label: conn.label, ok: r.value.ok, error: r.value.body.error, skipped: r.value.body.skipped, capabilityResults: r.value.body.capabilityResults }
    }
    return { id: conn.id, label: conn.label, ok: false, error: r.reason?.message || 'Failed' }
  })
  res.json({ results })
})

async function runSync(conn, opts = {}) {
  if (conn.source === 'microsoft') return runMicrosoftSync(conn)
  if (conn.source === 'freshservice') return runFreshserviceSync(conn)
  if (conn.source === 'Claude') return runClaudeSync(conn, opts)
  try {
    let rawRecords = []
    if (conn.source === 'github') {
      if (conn.meta.reportUrl) {
        const r = await fetch(conn.meta.reportUrl, { headers: { Authorization: `Bearer ${conn.credentials.token}` } })
        if (!r.ok) throw new Error('Failed to download report: ' + r.status)
        rawRecords = parseCsv(await r.text())
      } else if (conn.meta.org || conn.meta.enterprise) {
        rawRecords = await github.fetchCopilotSeats(conn.credentials.token, { org: conn.meta.org, enterprise: conn.meta.enterprise })
      } else {
        throw new Error('No organization, enterprise, or report URL configured for this account')
      }
    } else if (conn.source === 'kiro') {
      if (conn.authType === 'oauth') {
        rawRecords = await kiro.fetchData({ apiBaseUrl: conn.meta.apiBaseUrl, token: conn.credentials.accessToken })
      } else {
        rawRecords = await kiro.fetchData({ apiBaseUrl: conn.meta.apiBaseUrl, apiKey: conn.credentials.apiKey, headerName: conn.meta.headerName })
      }
    } else {
      throw new Error('Unknown source')
    }

    // GitHub is gated to the current Microsoft 365 (SSP) directory here —
    // same reusable rule every provider follows (src/utils/
    // canonicalIdentity.js); other sources' normalizers ignore the extra
    // option they don't use.
    const records = normalizeBySource(conn.source, rawRecords, { validEmails: buildValidEmailSet(msRepo.listAllUsers()) })
    recordsRepo.replaceRecordsForConnection(conn.id, records)

    const now = new Date().toISOString()
    connectionsRepo.updateConnection(conn.id, {
      status: 'connected',
      lastError: null,
      lastSync: now,
      lastAttempt: now,
      stats: { users: records.length, records: records.length }
    })
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: records.length })
    return { ok: true, body: { connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), records } }
  } catch (e) {
    connectionsRepo.updateConnection(conn.id, { status: 'error', lastError: e.message, lastAttempt: new Date().toISOString() })
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'error', errorMessage: e.message })
    return { ok: false, body: { connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), error: e.message } }
  }
}

// Microsoft 365 connections can have several independently-enabled
// capabilities (Copilot, Users, Devices, ...) — unlike every other source,
// one sync attempt fans out into several independent results, so this
// deliberately does NOT share runSync's single-record-set assumptions.
// A connection is considered "ok" if at least one enabled capability
// succeeded; one capability failing (e.g. missing permission) never marks
// capabilities that DID succeed as failed.
async function runMicrosoftSync(conn) {
  const capabilityResults = await syncMicrosoftConnection(conn)
  const entries = Object.entries(capabilityResults)
  const attempted = entries.filter(([, r]) => !r.skipped)
  // Purely derived capabilities (e.g. "departments" — computed from
  // already-synced users, no Graph call of its own) trivially "succeed"
  // even when their dependency failed; they must not single-handedly make
  // the connection look healthy while every real Graph-backed capability is
  // failing. "licenses" also depends on users for full value but still
  // makes its own real Graph call (/subscribedSkus), so it stays meaningful.
  const meaningfulAttempts = attempted.filter(([key]) => (MICROSOFT_CAPABILITIES[key]?.endpoints?.length || 0) > 0)
  const anySucceeded = meaningfulAttempts.some(([, r]) => r.ok)
  const overallOk = meaningfulAttempts.length === 0 || anySucceeded
  const errorSummary = attempted.filter(([, r]) => !r.ok)
    .map(([key, r]) => {
      const label = MICROSOFT_CAPABILITIES[key]?.label || key
      // Permission-type errors already name the capability (graphClient's
      // graphErrorMessage), so don't prefix it again.
      return r.error && r.error.startsWith(label) ? r.error : `${label}: ${r.error}`
    })
    .join(' | ') || null

  const copilotResult = capabilityResults.copilot
  const totalRecordCount = entries.reduce((sum, [, r]) => sum + (r.count || 0), 0)
  const now = new Date().toISOString()

  connectionsRepo.updateConnection(conn.id, {
    status: overallOk ? 'connected' : 'error',
    lastError: errorSummary,
    lastSync: anySucceeded ? now : conn.lastSync,
    lastAttempt: now,
    stats: { users: copilotResult?.count || 0, records: totalRecordCount }
  })
  syncHistoryRepo.recordSyncAttempt({
    connectionId: conn.id,
    status: overallOk ? 'success' : 'error',
    recordCount: totalRecordCount,
    errorMessage: errorSummary
  })

  return {
    ok: overallOk,
    body: {
      connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)),
      records: copilotResult?.ok ? recordsRepo.getRecordsForConnection(conn.id) : undefined,
      capabilityResults,
      error: overallOk ? undefined : errorSummary
    }
  }
}

// Production entrypoint: `npm run build` produces dist/, then `npm start`
// runs this same server serving BOTH the API above and the built frontend
// below - one process, one port. In dev, this is inert: Vite's own dev
// server (npm run web / npm run dev) serves the frontend on 5173 instead,
// and dist/ typically doesn't exist yet, so nothing here ever matches.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // Client-side routed pages (App.jsx's history.pushState routing) all
  // need to resolve to the same index.html - but only for real page
  // navigations, never for an unmatched /api or /auth call, which should
  // stay a normal 404 rather than silently returning HTML.
  app.get(/^(?!\/(api|auth)\/).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

const httpServer = app.listen(PORT, () => {
  console.log('Server listening on', PORT, fs.existsSync(DIST_DIR) ? '(serving built frontend from dist/)' : '(API only - run `npm run build` to also serve the frontend from this process)')
})

// Started unconditionally, independent of any browser tab (Part 3/18 of the
// Claude MTD spec this implements) — see server/services/claude/scheduler.js
// for why this is the one genuinely server-side scheduler in this app.
startClaudeScheduler()
// Automatic daily FX rate refresh — see server/services/fx/scheduler.js.
startFxScheduler()

// Graceful shutdown (Production-readiness audit) — Azure App Service sends
// SIGTERM on every restart, redeploy, and scale/slot event, then SIGKILLs
// the process if it hasn't exited after a short grace period. Without this,
// in-flight requests are cut off mid-response instead of finishing normally.
// server/db/index.js's own writes are already synchronous (each repository
// call persists the whole file before returning), so there is no async
// write queue to flush here — this only needs to stop accepting new
// connections and let already-accepted requests complete.
function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, closing server...`)
  httpServer.close(() => {
    console.log('[shutdown] server closed, exiting')
    process.exit(0)
  })
  // Belt-and-suspenders: if some connection never closes (e.g. a stuck
  // long-poll), don't hang forever past Azure's own SIGKILL grace period.
  setTimeout(() => process.exit(0), 10000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
