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
  assert.ok(routeLines.length >= 5, 'expected the full Dashboard Views CRUD surface (list, vbus, create, update, delete)')
  for (const line of routeLines) {
    assert.match(line, /requireAdminAccess/, `route missing requireAdminAccess: ${line.trim()}`)
  }
})

// A view's allowedVbuIds is the ONE place both branding resolution
// (resolveDashboardView) and business-data scope read from (VBU-scoping
// bug fix — the old, separate "VBU Assignments" admin screen was retired
// because it let these two drift out of sync). There must be no surviving
// route surface for it, and create/update must reject a VBU already
// claimed by another view rather than silently letting resolution become
// ambiguous.
test('the separate VBU-assignments admin route surface has been fully retired — allowedVbuIds is the only VBU-to-view mechanism', () => {
  assert.doesNotMatch(adminRoutesSrc, /vbu-assignments/, 'no route should reference the retired vbu-assignments admin surface')
  assert.doesNotMatch(adminRoutesSrc, /vbuViewAssignmentsRepo/, 'the admin routes file must not depend on the retired assignments repo at all')
})

test('create and update both reject a VBU already claimed by another view (409), rather than allowing two views to claim the same VBU', () => {
  assert.match(adminRoutesSrc, /function findVbuConflicts/, 'expected a conflict-detection helper')
  const postStart = adminRoutesSrc.indexOf("dashboardViewsAdminRouter.post('/api/admin/dashboard-views',")
  const postEnd = adminRoutesSrc.indexOf('\n})', postStart)
  const postSrc = adminRoutesSrc.slice(postStart, postEnd)
  assert.match(postSrc, /findVbuConflicts\(/, 'POST must check for VBU conflicts before creating')
  assert.match(postSrc, /409/, 'a VBU conflict must be rejected with 409')

  const putStart = adminRoutesSrc.indexOf("dashboardViewsAdminRouter.put('/api/admin/dashboard-views/:id',")
  const putEnd = adminRoutesSrc.indexOf('\n})', putStart)
  const putSrc = adminRoutesSrc.slice(putStart, putEnd)
  assert.match(putSrc, /findVbuConflicts\(/, 'PUT must check for VBU conflicts before updating')
  assert.match(putSrc, /409/, 'a VBU conflict must be rejected with 409')
})

// Discovered live against the real production database: the DEFAULT view
// (SSP Central Services) already has its own allowedVbuIds configured with
// several VBUs — including ones also claimed by SSP UK & Ireland/Worldwide
// — purely for a broader business-data aggregate, not a branding claim.
// The conflict check must exempt the default view on both sides, exactly
// mirroring resolveDashboardView's own exclusion (see its comment in
// server/services/dashboardViews.js), or a real admin's existing Central
// Services configuration would start throwing 409s the next time they save
// it, and/or the default view would wrongly compete for other views' VBUs.
test('the VBU-conflict check exempts the DEFAULT view (SSP Central Services) — it can freely overlap with any other view\'s allowedVbuIds and is never itself conflict-checked', () => {
  assert.match(adminRoutesSrc, /import \{ DEFAULT_VIEW_ID \} from/, 'expected the conflict-check logic to know about the default view id')
  const helperStart = adminRoutesSrc.indexOf('function vbusClaimedByOtherViews')
  const helperEnd = adminRoutesSrc.indexOf('\n}', helperStart)
  assert.match(adminRoutesSrc.slice(helperStart, helperEnd), /DEFAULT_VIEW_ID/, 'the claimed-VBU map must exclude the default view\'s own allowedVbuIds')

  const findStart = adminRoutesSrc.indexOf('function findVbuConflicts')
  const findEnd = adminRoutesSrc.indexOf('\n}', findStart)
  assert.match(adminRoutesSrc.slice(findStart, findEnd), /excludeViewId === DEFAULT_VIEW_ID/, 'saving the default view itself must skip the conflict check entirely')
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
  const postStart = adminRoutesSrc.indexOf("dashboardViewsAdminRouter.post('/api/admin/dashboard-views',")
  const postEnd = adminRoutesSrc.indexOf('\n})', postStart)
  assert.match(adminRoutesSrc.slice(postStart, postEnd), /validAllowedVbuIds\(allowedVbuIds\)/, 'POST must validate allowedVbuIds')

  const putStart = adminRoutesSrc.indexOf("dashboardViewsAdminRouter.put('/api/admin/dashboard-views/:id',")
  const putEnd = adminRoutesSrc.indexOf('\n})', putStart)
  const putSrc = adminRoutesSrc.slice(putStart, putEnd)
  assert.match(putSrc, /if \(allowedVbuIds !== undefined\)/, 'PUT must only touch allowedVbuIds when the request actually provided it — same "only patch what is provided" rule as every other field')
  assert.match(putSrc, /validAllowedVbuIds\(allowedVbuIds\)/, 'PUT must validate allowedVbuIds when provided')
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
