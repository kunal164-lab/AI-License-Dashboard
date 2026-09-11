// Real VBU data isolation for Cost Analytics (server/services/
// costAnalytics.js#buildCostDataset) — the single highest-leverage fix in
// the VBU-scope spec: ~16 routes (every /api/cost/* analytics route plus
// GET /api/users/:id/detail) all build canonicalUsers through this one
// function, so scoping it once fixes all of them. Uses a real temp SQLite
// DB (same pattern as server/services/__tests__/microsoftLicenses.test.js)
// since it reads from the real repos.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `cost-analytics-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const connectionsRepo = await import('../../repositories/connectionsRepo.js')
const msRepo = await import('../../repositories/microsoftRepo.js')
const recordsRepo = await import('../../repositories/recordsRepo.js')
const costAnalytics = await import('../costAnalytics.js')

const admin = { canWrite: true, vbu: null }
const ukiUser = { canWrite: false, vbu: 'VBU - SSP UK & Ireland' }
const worldwideUser = { canWrite: false, vbu: 'VBU - SSP Worldwide' }
const noVbuUser = { canWrite: false, vbu: null }

function graphUser({ id, displayName, upn, vbu }) {
  return { id, displayName, userPrincipalName: upn, mail: upn, companyName: 'SSP', accountEnabled: true, assignedLicenses: [], onPremisesExtensionAttributes: { extensionAttribute3: vbu } }
}

before(async () => {
  await initDb()
  const connId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Test Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  const msConnId = connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS', authType: 'client_credentials', credentials: {}, meta: {} }).id

  msRepo.upsertUsers(msConnId, [
    graphUser({ id: 'u1', displayName: 'UKI Person', upn: 'uki@ssp-worldwide.com', vbu: 'VBU - SSP UK & Ireland' }),
    graphUser({ id: 'u2', displayName: 'Worldwide Person', upn: 'ww@ssp-worldwide.com', vbu: 'VBU - SSP Worldwide' }),
    graphUser({ id: 'u3', displayName: 'No VBU Person', upn: 'novbu@ssp-worldwide.com', vbu: null })
  ])

  recordsRepo.replaceRecordsForConnection(connId, [
    { email: 'uki@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 5, _source: 'kiro' },
    { email: 'ww@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 3, _source: 'kiro' },
    { email: 'novbu@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 1, _source: 'kiro' }
  ])
})
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })

test('buildCostDataset(access): an admin sees every VBU\'s canonical users', () => {
  const { canonicalUsers } = costAnalytics.buildCostDataset(admin)
  assert.equal(canonicalUsers.length, 3)
})

test('buildCostDataset(access): a non-admin sees ONLY their own VBU\'s canonical users — generic, not hardcoded to one VBU', () => {
  const uki = costAnalytics.buildCostDataset(ukiUser)
  assert.deepEqual(uki.canonicalUsers.map((u) => u.name), ['UKI Person'])

  const worldwide = costAnalytics.buildCostDataset(worldwideUser)
  assert.deepEqual(worldwide.canonicalUsers.map((u) => u.name), ['Worldwide Person'])
})

test('buildCostDataset(access): a non-admin with no resolvable VBU sees nothing, and omitting access entirely fails closed too', () => {
  assert.equal(costAnalytics.buildCostDataset(noVbuUser).canonicalUsers.length, 0)
  assert.equal(costAnalytics.buildCostDataset().canonicalUsers.length, 0, 'a call site that forgets to pass access must never leak the full dataset')
})

test('Products/departments/domains/plans built from a scoped dataset never leak another VBU\'s rows', () => {
  const { canonicalUsers } = costAnalytics.buildCostDataset(ukiUser)
  const rows = costAnalytics.flattenForCost(canonicalUsers)
  assert.ok(rows.every((r) => r.user_name === 'UKI Person'))
  const byProduct = costAnalytics.aggregateBy(rows, (r) => r.product)
  assert.equal(byProduct.find((p) => p.name === 'Kiro')?.users, 1, 'only the caller\'s own VBU\'s Kiro user is counted')
})

// A local admin's business-data access is ALWAYS global (server/auth/
// vbuScope.js#isAdminAccess: canWrite alone, isPreviewingVbu is no longer
// consulted) — reversed from an earlier design that DID scope a
// previewing admin's data, which caused a real, live-confirmed bug: an
// admin previewing e.g. SSP Worldwide alone lost access to 153 of 296
// real canonical users, purely because of which Dashboard View happened
// to be selected for branding. These three tests now all assert the SAME
// thing (every real user, regardless of which view is previewed) —
// intentionally kept as three separate cases (no selection, single-VBU
// preview, multi-VBU preview) since they were exactly the three
// previously-differing scenarios.

test('a local admin PREVIEWING SSP Worldwide still sees every VBU\'s canonical users — Dashboard View selection is branding only, never a business-data restriction for an admin', () => {
  const previewingWorldwide = { canWrite: true, isPreviewingVbu: true, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP Worldwide'] }
  const { canonicalUsers } = costAnalytics.buildCostDataset(previewingWorldwide)
  assert.deepEqual(canonicalUsers.map((u) => u.name).sort(), ['No VBU Person', 'UKI Person', 'Worldwide Person'])
})

test('a local admin previewing a Central-Services-like view configured with SEVERAL VBUs still sees every real canonical user, not just the union of the configured VBUs', () => {
  const previewingCentralServices = { canWrite: true, isPreviewingVbu: true, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide'] }
  const { canonicalUsers } = costAnalytics.buildCostDataset(previewingCentralServices)
  assert.deepEqual(canonicalUsers.map((u) => u.name).sort(), ['No VBU Person', 'UKI Person', 'Worldwide Person'])
})

test('a local admin previewing SSP (no VBU assignment) sees everyone — the same as every other preview selection now', () => {
  const previewingSsp = { canWrite: true, isPreviewingVbu: false, vbu: null }
  const { canonicalUsers } = costAnalytics.buildCostDataset(previewingSsp)
  assert.equal(canonicalUsers.length, 3)
})

test('GET /api/users/:id/detail\'s underlying lookup (costAnalytics.userDetail) returns null for an out-of-VBU id — the existing 404 path, no separate ownership check needed', () => {
  const { canonicalUsers } = costAnalytics.buildCostDataset(ukiUser)
  const worldwidePersonEmail = 'ww@ssp-worldwide.com'
  assert.equal(costAnalytics.userDetail(canonicalUsers, worldwidePersonEmail), null, 'a UK & Ireland caller cannot fetch a Worldwide person\'s detail by guessing their email/id')

  const adminDataset = costAnalytics.buildCostDataset(admin)
  assert.ok(costAnalytics.userDetail(adminDataset.canonicalUsers, worldwidePersonEmail), 'an admin CAN still fetch it')
})
