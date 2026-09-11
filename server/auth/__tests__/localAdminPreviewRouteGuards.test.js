// Source-level guard tests for the local-admin Dashboard View selection
// routes — proving a normal (Microsoft-authenticated) user has no path to
// this mechanism at all, not just "it wouldn't do anything useful."
// Mirrors the established style (see vbuScopeRouteGuards.test.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../')
const localRoutesSrc = fs.readFileSync(path.join(repoRoot, 'server/auth/localRoutes.js'), 'utf8')
const authRoutesSrc = fs.readFileSync(path.join(repoRoot, 'server/auth/routes.js'), 'utf8')

test('POST /api/auth/local/dashboard-view and /clear both require an authenticated LOCAL-admin session, checked on session identity (not just a role flag)', () => {
  for (const route of ["localAuthRouter.post('/api/auth/local/dashboard-view'", "localAuthRouter.post('/api/auth/local/dashboard-view/clear'"]) {
    assert.match(localRoutesSrc, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*requireLocalAdminSession'), `${route} must be gated by requireLocalAdminSession`)
  }
  assert.match(localRoutesSrc, /authenticationProvider !== 'local'/, 'the guard must check session identity, not a permission flag')
})

test('the Microsoft Entra login/callback handler never threads a selectedDashboardViewId into computeEffectiveAccess — a Microsoft-authenticated user has no path to the preview mechanism at all', () => {
  const start = authRoutesSrc.indexOf("authRouter.get('/auth/microsoft/callback'")
  const end = authRoutesSrc.indexOf("\n})", start)
  const block = authRoutesSrc.slice(start, end)
  assert.doesNotMatch(block, /selectedDashboardViewId/, 'the Microsoft login callback must call computeEffectiveAccess(user) with no second argument')
  assert.match(block, /computeEffectiveAccess\(user\)/, 'expected the exact single-argument call')
})

test('GET /api/auth/me computes dashboardViewChosen from server-only state (session identity + access.selectedDashboardViewId) — no query/body input', () => {
  const start = authRoutesSrc.indexOf("authRouter.get('/api/auth/me'")
  const end = authRoutesSrc.indexOf('\n})', start)
  const block = authRoutesSrc.slice(start, end)
  assert.match(block, /dashboardViewChosen/)
  assert.match(block, /access\.selectedDashboardViewId/)
  assert.doesNotMatch(block, /req\.query/)
  assert.doesNotMatch(block, /req\.body/)
})
