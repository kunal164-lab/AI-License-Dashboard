// Local administrator authentication HTTP surface (Part 2/3/4 of the
// local-admin auth spec) — the initial-setup and emergency-recovery
// sign-in path. Deliberately public (no session required), the same as the
// Microsoft login/callback routes, since its whole purpose is to work when
// nothing else does: every write is scoped by localAuth.js's own rules (at
// most one admin account is ever created; login requires the right
// password against a bcrypt hash; a rate limiter below bounds brute force).
import express from 'express'
import rateLimit from 'express-rate-limit'
import * as localAuth from './localAuth.js'
import { computeEffectiveAccess } from './authorize.js'
import * as dashboardViewsRepo from '../repositories/dashboardViewsRepo.js'
import * as auditLogRepo from '../repositories/auditLogRepo.js'

export const localAuthRouter = express.Router()

// The frontend's first call on boot (alongside /api/auth/me) to decide
// whether to render "Initial Administrator Setup" at all (Part 2: "on
// fresh install with no local admin"). Public and deliberately minimal —
// existence + enabled state only; never a username, hash, or anything else
// that could be considered credential/config information.
localAuthRouter.get('/api/auth/local/status', (req, res) => {
  res.json(localAuth.getPublicStatus())
})

localAuthRouter.post('/api/auth/local/setup', async (req, res) => {
  const { username, password, confirmPassword } = req.body || {}
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' })
  }
  const result = await localAuth.createInitialLocalAdmin({ username, password })
  if (!result.ok) return res.status(result.status).json({ error: result.error })

  auditLogRepo.record({ eventType: 'local_admin_created', actorUpn: result.admin.username })

  // First-run must never dead-end at a second sign-in step (Part 2/13) —
  // the person completing setup is signed in immediately.
  req.session.regenerate(async (err) => {
    if (err) return res.status(500).json({ error: 'Administrator account created, but failed to start a session. Please sign in.' })
    req.session.user = { username: result.admin.username, name: result.admin.username, authenticationProvider: 'local' }
    const access = await computeEffectiveAccess(req.session.user)
    access.computedAt = Date.now()
    req.session.access = access
    req.session.save(() => res.status(201).json({ ok: true }))
  })
})

// Brute-force protection (Part 4) — bounds sign-in attempts well above
// normal mistyping and well below anything useful for password guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }
})

localAuthRouter.post('/api/auth/local/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {}
  const admin = await localAuth.verifyLocalLogin({ username, password })
  if (!admin) {
    auditLogRepo.record({ eventType: 'local_login_failure', actorUpn: username ? String(username) : null })
    return res.status(401).json({ error: 'Invalid username or password.' })
  }
  // Session regeneration on successful login (Part 4) — a session id
  // issued before authentication must never become a valid authenticated
  // session id, same defense the Microsoft login flow already applies.
  req.session.regenerate(async (err) => {
    if (err) return res.status(500).json({ error: 'Failed to establish a session after sign-in.' })
    req.session.user = { username: admin.username, name: admin.username, authenticationProvider: 'local' }
    // A fresh session (via regenerate() above) never carries a prior
    // selectedDashboardViewId forward — every local-admin login starts
    // back at "no view chosen yet," so App.jsx's Choose Dashboard View
    // gate is shown again on every login, matching the spec's flow.
    const access = await computeEffectiveAccess(req.session.user)
    access.computedAt = Date.now()
    req.session.access = access
    auditLogRepo.record({ eventType: 'local_login_success', actorUpn: admin.username })
    req.session.save(() => res.json({ ok: true }))
  })
})

// Local-administrator-only Dashboard View selection/preview (VBU-aware-
// views spec, "Local Administrator" section) — lets the local admin pick
// any configured, active Dashboard View after logging in and see its
// business data as if their own vbu were that view's assigned VBU, purely
// for testing/validation. Checked on session identity, never on a role
// flag alone, so a Microsoft-authenticated session has no path to this at
// all, by construction — not just "it wouldn't do anything useful."
function requireLocalAdminSession(req, res, next) {
  if (!req.session?.user || req.session.user.authenticationProvider !== 'local') {
    return res.status(403).json({ error: 'Dashboard View selection is only available to the local Administrator.' })
  }
  next()
}

localAuthRouter.post('/api/auth/local/dashboard-view', requireLocalAdminSession, async (req, res) => {
  const { dashboardViewId } = req.body || {}
  const view = dashboardViewId ? dashboardViewsRepo.getView(dashboardViewId) : null
  if (!view || !view.isActive) return res.status(400).json({ error: 'That dashboard view does not exist or is not active.' })
  req.session.selectedDashboardViewId = dashboardViewId
  const access = await computeEffectiveAccess(req.session.user, { selectedDashboardViewId: dashboardViewId })
  access.computedAt = Date.now()
  req.session.access = access
  auditLogRepo.record({ eventType: 'local_admin_dashboard_view_selected', actorUpn: req.session.user.username, detail: { dashboardViewId } })
  req.session.save(() => res.json({ ok: true }))
})

// "Switch Dashboard View" (section 16 of the spec) — clears the session
// selection so App.jsx's gate re-appears; the admin never needs to log
// out to pick a different view to test.
localAuthRouter.post('/api/auth/local/dashboard-view/clear', requireLocalAdminSession, async (req, res) => {
  delete req.session.selectedDashboardViewId
  const access = await computeEffectiveAccess(req.session.user)
  access.computedAt = Date.now()
  req.session.access = access
  req.session.save(() => res.json({ ok: true }))
})
