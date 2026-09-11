// Source-level guard tests proving every business-data route identified in
// the VBU-scope investigation actually calls into the real enforcement
// functions (server/auth/vbuScope.js) rather than a client-supplied value.
// This codebase has no HTTP-request test harness (confirmed convention,
// see server/auth/__tests__/dashboardViewsAdminRoutes.test.js) — these
// mirror that same source-reading style.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../')
const indexSrc = fs.readFileSync(path.join(repoRoot, 'server/index.js'), 'utf8')

function routeBlock(routePattern) {
  const start = indexSrc.indexOf(routePattern)
  assert.ok(start >= 0, `expected to find route: ${routePattern}`)
  const end = indexSrc.indexOf("\n})", start)
  return indexSrc.slice(start, end)
}

test('every GET /api/cost/* analytics route (and GET /api/users/:id/detail) passes req.access into buildCostDataset — never an unscoped call', () => {
  const routes = [
    "app.get('/api/cost/overview'", "app.get('/api/cost/products'", "app.get('/api/cost/products/:name'",
    "app.get('/api/cost/departments'", "app.get('/api/cost/departments/:name'", "app.get('/api/cost/vbus'",
    "app.get('/api/cost/vbus/:name'", "app.get('/api/cost/by-vbu'", "app.get('/api/cost/domains'",
    "app.get('/api/cost/domains/:domain'", "app.get('/api/cost/plans'", "app.get('/api/cost/users'",
    "app.get('/api/cost/users/:id'", "app.get('/api/users/:id/detail'"
  ]
  for (const route of routes) {
    const block = routeBlock(route)
    assert.match(block, /costAnalytics\.buildCostDataset\(req\.access\)/, `${route} must call buildCostDataset(req.access), not an unscoped call`)
  }
})

test('GET /api/cost/summary and /api/cost/missing (which do not use buildCostDataset) call scopeRecordsByVbu directly', () => {
  for (const route of ["app.get('/api/cost/summary'", "app.get('/api/cost/missing'"]) {
    const block = routeBlock(route)
    assert.match(block, /scopeRecordsByVbu\(/, `${route} must scope its own records by VBU`)
  }
})

test('GET /api/dashboard scopes both dataByConnection and the microsoftDirectory response field', () => {
  const start = indexSrc.indexOf("app.get('/api/dashboard'")
  const end = indexSrc.indexOf("\n})", start)
  const block = indexSrc.slice(start, end)
  assert.match(block, /scopeRecordsByVbu\(/, 'dataByConnection records must be VBU-scoped')
  assert.match(block, /scopeMicrosoftDirectory\(/, 'the microsoftDirectory field must be VBU-scoped too — it is not just usage data, it is organizational identity data about other people')
})

test('GET /api/microsoft/licenses(/:licenseId) force the caller\'s own effective VBU scope for non-admins — the query param can only ever narrow an admin\'s own view', () => {
  for (const route of ["app.get('/api/microsoft/licenses'", "app.get('/api/microsoft/licenses/:licenseId'"]) {
    const block = routeBlock(route)
    assert.match(block, /isAdminAccess\(req\.access\)\s*\?\s*req\.query\.vbu\s*:\s*effectiveVbuFilterValue\(req\.access\)/, `${route} must ignore a non-admin's own ?vbu= query param and enforce their own effective allowed-VBU scope instead`)
  }
})

test('GET /api/microsoft/data and /applications-overview call the joined VBU-scope helpers', () => {
  assert.match(routeBlock("app.get('/api/microsoft/data'"), /scopeMicrosoftDataset\(/)
  assert.match(routeBlock("app.get('/api/microsoft/applications-overview'"), /scopeApplicationsOverview\(/)
})

test('GET /api/microsoft/users/:msId and /devices/:msId check ownership before fetching detail', () => {
  assert.match(routeBlock("app.get('/api/microsoft/users/:msId'"), /ownsMicrosoftUser\(/)
  assert.match(routeBlock("app.get('/api/microsoft/devices/:msId'"), /ownsMicrosoftUser\(/)
})

test('GET /api/microsoft/applications/:name and /linkage narrow the returned device list', () => {
  assert.match(routeBlock("app.get('/api/microsoft/applications/:name'"), /scopeApplicationDetailDevices\(/)
  assert.match(routeBlock("app.get('/api/microsoft/applications/:name/linkage'"), /scopeApplicationDetailDevices\(/)
})

test('GET /api/kiro/data and /api/claude/data scope their returned records by VBU', () => {
  assert.match(routeBlock("app.get('/api/kiro/data'"), /scopeRecordsByVbu\(/)
  assert.match(routeBlock("app.get('/api/claude/data'"), /scopeRecordsByVbu\(/)
})

test('withAuth (server/auth/middleware.js) denies a non-admin with no resolvable VBU using the SAME existing error message as every other access denial — no second authorization system', () => {
  const middlewareSrc = fs.readFileSync(path.join(repoRoot, 'server/auth/middleware.js'), 'utf8')
  assert.match(middlewareSrc, /!access\.canWrite && !access\.vbu/, 'expected the non-admin/no-vbu condition to be part of the existing default-deny check')
  const occurrences = middlewareSrc.match(/You are not authorized to use this application\. Contact your administrator\./g) || []
  assert.equal(occurrences.length, 1, 'must reuse the exact existing error message, not introduce a second one')
})
