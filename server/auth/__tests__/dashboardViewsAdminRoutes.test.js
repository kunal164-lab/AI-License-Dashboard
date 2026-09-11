// Source-level guard tests for the Dashboard Views admin surface — this
// codebase has no HTTP-request test harness (confirmed: no other
// server/auth/*Routes.js file has its own request-level test), so these
// mirror the existing dashboardUserPopulation.test.js convention of
// reading the real source and asserting the security-relevant shape
// directly, rather than rendering/requesting anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../')
const adminRoutesSrc = fs.readFileSync(path.join(repoRoot, 'server/auth/dashboardViewsAdminRoutes.js'), 'utf8')
const authRoutesSrc = fs.readFileSync(path.join(repoRoot, 'server/auth/routes.js'), 'utf8')
const previewComponentSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/AdminDashboardViews.jsx'), 'utf8')

test('every route in dashboardViewsAdminRoutes.js is gated by requireAdminAccess', () => {
  const routeLines = adminRoutesSrc.split('\n').filter((l) => /dashboardViewsAdminRouter\.(get|post|put|delete)\(/.test(l))
  assert.ok(routeLines.length >= 8, 'expected the full Dashboard Views + VBU assignment CRUD surface')
  for (const line of routeLines) {
    assert.match(line, /requireAdminAccess/, `route missing requireAdminAccess: ${line.trim()}`)
  }
})

test('GET /api/auth/me never reads req.query or req.body — vbu/dashboardView/role/allowedPages come only from the session', () => {
  const start = authRoutesSrc.indexOf("authRouter.get('/api/auth/me'")
  assert.ok(start >= 0, 'expected to find the /api/auth/me handler')
  const end = authRoutesSrc.indexOf('\n})', start)
  const handlerSrc = authRoutesSrc.slice(start, end)
  assert.doesNotMatch(handlerSrc, /req\.query/, 'a query param must never influence the authenticated identity/VBU/view response')
  assert.doesNotMatch(handlerSrc, /req\.body/, '/api/auth/me is a GET with no body input by design')
})

// ---- Dashboard View VBU Data Assignment spec ----

test('the VBU list endpoint is backed by the real Microsoft directory, never a hardcoded array', () => {
  assert.match(adminRoutesSrc, /dashboardViewsAdminRouter\.get\('\/api\/admin\/dashboard-views\/vbus'/, 'expected a dedicated VBU-list route')
  assert.match(adminRoutesSrc, /microsoftRepo\.listDistinctVbus\(\)/, 'the admin UI\'s multi-select must be populated from real synced data, not a fixed list')
})

test('create/update both validate allowedVbuIds through validAllowedVbuIds before persisting — never trusts the raw request body as-is', () => {
  assert.match(adminRoutesSrc, /allowedVbuIds:\s*validAllowedVbuIds\(allowedVbuIds\)/, 'POST must validate allowedVbuIds')
  assert.match(adminRoutesSrc, /allowedVbuIds:\s*allowedVbuIds !== undefined \? validAllowedVbuIds\(allowedVbuIds\) : undefined/, 'PUT must validate allowedVbuIds when provided, and leave it untouched (undefined) when omitted — same "only patch what is provided" rule as every other field')
})

test('validAllowedVbuIds only ever accepts VBU values that actually exist in the real directory (microsoftRepo.listDistinctVbus), never an arbitrary/fabricated string', () => {
  const start = adminRoutesSrc.indexOf('function validAllowedVbuIds(')
  assert.ok(start >= 0, 'expected to find validAllowedVbuIds')
  const end = adminRoutesSrc.indexOf('\n}', start)
  const fnSrc = adminRoutesSrc.slice(start, end)
  assert.match(fnSrc, /microsoftRepo\.listDistinctVbus\(\)/)
  assert.match(fnSrc, /known\.has\(/, 'every submitted id must be checked against the real known set before being persisted')
})

test('the Dashboard View Preview component performs no data fetch — it only renders the already-loaded view config object', () => {
  const start = previewComponentSrc.indexOf('function ViewPreview(')
  assert.ok(start >= 0, 'expected to find the ViewPreview component')
  const end = previewComponentSrc.indexOf('\nfunction ', start + 1) === -1
    ? previewComponentSrc.indexOf('\nexport default', start)
    : previewComponentSrc.indexOf('\nfunction ', start + 1)
  const componentSrc = previewComponentSrc.slice(start, end)
  assert.doesNotMatch(componentSrc, /fetch\(/, 'Preview must never call an API — Part 12 of the spec: it must not grant additional data access')
})
