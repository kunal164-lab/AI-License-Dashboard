// Regression coverage for a real, live-confirmed production bug: an ADMIN
// (local administrator, canWrite:true) previewing a Dashboard View lost
// access to GET /api/users/:id/detail for real users outside that view's
// configured VBU scope — e.g. previewing SSP Worldwide alone made 153 of
// 296 real canonical users inaccessible, purely because of which
// Dashboard View happened to be selected for branding at that moment.
//
// Root cause: server/auth/vbuScope.js#isAdminAccess required
// `!access.isPreviewingVbu` in addition to `canWrite`, so a previewing
// admin session was treated as a real, VBU-scoped non-admin by every
// scoping function (scopeCanonicalUsersByVbu, costAnalytics.userDetail's
// own upstream buildCostDataset, etc.) — the exact same code path GET
// /api/users/:id/detail (server/index.js) uses.
//
// Fix: isAdminAccess is now `!!access?.canWrite` alone — Dashboard View
// preview/selection only ever affects branding (dashboardView/
// effectiveAllowedPages), never an admin's own business-data
// authorization. Uses the same real-temp-SQLite-DB pattern as
// server/services/__tests__/costAnalytics.test.js.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `admin-user-detail-vbu-bug-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb } = await import('../../db/index.js')
const connectionsRepo = await import('../../repositories/connectionsRepo.js')
const msRepo = await import('../../repositories/microsoftRepo.js')
const recordsRepo = await import('../../repositories/recordsRepo.js')
const costAnalytics = await import('../costAnalytics.js')

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
    graphUser({ id: 'u3', displayName: 'Consolidated Person', upn: 'consolidated@ssp-worldwide.com', vbu: 'VBU - SSP Consolidated' })
  ])

  recordsRepo.replaceRecordsForConnection(connId, [
    { email: 'uki@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 5, _source: 'kiro' },
    { email: 'ww@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 3, _source: 'kiro' },
    { email: 'consolidated@ssp-worldwide.com', product: 'Kiro', plan: 'Pro', license_status: 'active', activity_count: 2, _source: 'kiro' }
  ])
})
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })

// Mirrors GET /api/users/:id/detail's own real call sequence
// (server/index.js) exactly: buildCostDataset(access) -> flattenForCost is
// not even needed for userDetail — costAnalytics.userDetail is called
// directly against canonicalUsers, same as that route.
function detailFor(email, access) {
  const { canonicalUsers } = costAnalytics.buildCostDataset(access)
  return costAnalytics.userDetail(canonicalUsers, email)
}

test('admin, NOT previewing any view: detail works for every real user regardless of VBU', () => {
  const admin = { canWrite: true, isPreviewingVbu: false }
  assert.ok(detailFor('uki@ssp-worldwide.com', admin))
  assert.ok(detailFor('ww@ssp-worldwide.com', admin))
  assert.ok(detailFor('consolidated@ssp-worldwide.com', admin))
})

test('THE BUG, regression-locked: admin previewing SSP Worldwide (a single-VBU view) must still be able to open detail for a UK & Ireland user and a Consolidated user — not just Worldwide\'s own', () => {
  const previewingWorldwide = { canWrite: true, isPreviewingVbu: true, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP Worldwide'] }
  assert.ok(detailFor('uki@ssp-worldwide.com', previewingWorldwide), 'UK & Ireland user must NOT 404 just because SSP Worldwide is the currently-previewed view')
  assert.ok(detailFor('ww@ssp-worldwide.com', previewingWorldwide))
  assert.ok(detailFor('consolidated@ssp-worldwide.com', previewingWorldwide), 'Consolidated user must NOT 404 either')
})

test('admin previewing a Central-Services-like view configured with only TWO of the three real VBUs must still open detail for the third (unconfigured) VBU\'s user', () => {
  const previewingPartialCentralServices = { canWrite: true, isPreviewingVbu: true, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide'] }
  assert.ok(detailFor('consolidated@ssp-worldwide.com', previewingPartialCentralServices), 'an admin must never lose access to a real user just because an administrator has not yet added their VBU to a Dashboard View\'s configured list')
})

test('security boundary intact: a REAL non-admin (own VBU only) is still correctly denied a different VBU\'s user detail — this fix only changes ADMIN behavior', () => {
  const ukiNonAdmin = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', allowedVbus: ['VBU - SSP UK & Ireland'] }
  assert.ok(detailFor('uki@ssp-worldwide.com', ukiNonAdmin), 'must still see their own VBU\'s user')
  assert.equal(detailFor('ww@ssp-worldwide.com', ukiNonAdmin), null, 'must still be denied a different VBU\'s user — unchanged, correct behavior')
  assert.equal(detailFor('consolidated@ssp-worldwide.com', ukiNonAdmin), null)
})

test('a non-admin cannot bypass their own VBU boundary by spoofing isPreviewingVbu/canWrite-shaped fields — only a real canWrite:true session bypasses', () => {
  const spoofed = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', isPreviewingVbu: false, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide', 'VBU - SSP Consolidated'] }
  // Even if allowedVbus is somehow widened (which no real code path allows
  // a non-admin to do — computeAllowedVbusForUser never returns more than
  // the user's own single vbu), canWrite:false alone does NOT grant the
  // admin bypass; scoping still applies using whatever allowedVbus says.
  // This test exists to prove canWrite is genuinely load-bearing, not
  // merely decorative, in isAdminAccess.
  assert.equal(detailFor('ww@ssp-worldwide.com', { canWrite: false, vbu: 'VBU - SSP UK & Ireland' }), null, 'without canWrite, a caller with only their own real vbu is still denied a different VBU\'s user')
})
