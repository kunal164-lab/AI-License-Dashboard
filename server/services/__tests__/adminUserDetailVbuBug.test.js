// History of this file (both directions are load-bearing, read both):
//
// 1. An earlier design required `!access.isPreviewingVbu` in addition to
//    `canWrite` in server/auth/vbuScope.js#isAdminAccess, on the theory
//    that a previewing admin's business DATA should look scoped to the
//    previewed VBU. In practice, at the time, ANY Dashboard View selection
//    (even one picked only to look at branding) silently restricted a real
//    admin's ability to look up unrelated users — live-confirmed:
//    previewing SSP Worldwide alone made 153 of 296 real canonical users
//    inaccessible from GET /api/users/:id/detail.
// 2. The fix at the time was `isAdminAccess = !!access?.canWrite` alone —
//    Dashboard View preview stopped affecting business-data access at all.
// 3. The Dashboard View + VBU Data Assignment spec (Bug 2 of that
//    investigation) explicitly requires the OPPOSITE for an EXPLICIT local-
//    admin preview: "when an Admin explicitly previews/selects a Dashboard
//    View, the preview context should still use that Dashboard View's
//    configured VBU scope for BUSINESS DATA... Do NOT interpret isAdmin ==
//    true as ignore selected Dashboard View data scope." isAdminAccess is
//    now `!!access?.canWrite && !access?.isPreviewingVbu` again.
//
// The two "bugs" are not actually in tension once the real distinction is
// drawn precisely: isPreviewingVbu is ONLY ever set by
// server/services/dashboardViews.js#applyLocalAdminPreview, and ONLY when
// the selected view has a REAL, non-empty configured VBU scope — i.e. only
// on a genuine, explicit "preview this view's data scope" action, never as
// a side effect of merely being logged in as local admin or previewing an
// unconfigured view. RBAC (canWrite/allowedPages) and the ability to
// manage/preview Dashboard Views themselves are untouched either way —
// requireWrite/requireAdminAccess (server/auth/middleware.js) read
// access.canWrite directly, never isAdminAccess.
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

test('BUG 2 fix: admin previewing SSP Worldwide (a single-VBU view) can open detail ONLY for the Worldwide user — a UK & Ireland/Consolidated user correctly 404s while this preview is active', () => {
  const previewingWorldwide = { canWrite: true, isPreviewingVbu: true, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP Worldwide'] }
  assert.equal(detailFor('uki@ssp-worldwide.com', previewingWorldwide), null, 'UK & Ireland user must 404 while SSP Worldwide is the explicitly previewed, VBU-scoped view — this is the whole point of the preview')
  assert.ok(detailFor('ww@ssp-worldwide.com', previewingWorldwide), 'the previewed view\'s OWN VBU must still resolve')
  assert.equal(detailFor('consolidated@ssp-worldwide.com', previewingWorldwide), null)
})

test('admin previewing a Central-Services-like view configured with only TWO of the three real VBUs cannot open detail for the third (unconfigured) VBU\'s user — matches "no accidental ALL_VBUS leakage unless explicitly configured"', () => {
  const previewingPartialCentralServices = { canWrite: true, isPreviewingVbu: true, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide'] }
  assert.ok(detailFor('uki@ssp-worldwide.com', previewingPartialCentralServices))
  assert.ok(detailFor('ww@ssp-worldwide.com', previewingPartialCentralServices))
  assert.equal(detailFor('consolidated@ssp-worldwide.com', previewingPartialCentralServices), null, 'a VBU not in the preview\'s configured scope must not be reachable, even for an admin, while the preview is active')
})

test('the preview restriction is reversible: clearing the preview (isPreviewingVbu: false again) immediately restores full admin access to every user — matches "Switch Dashboard View" never being a permanent narrowing', () => {
  const noLongerPreviewing = { canWrite: true, isPreviewingVbu: false, vbu: null, allowedVbus: null }
  assert.ok(detailFor('uki@ssp-worldwide.com', noLongerPreviewing))
  assert.ok(detailFor('ww@ssp-worldwide.com', noLongerPreviewing))
  assert.ok(detailFor('consolidated@ssp-worldwide.com', noLongerPreviewing))
})

test('security boundary intact: a REAL non-admin (own VBU only) is still correctly denied a different VBU\'s user detail — unaffected by any of the admin-preview behavior above', () => {
  const ukiNonAdmin = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', allowedVbus: ['VBU - SSP UK & Ireland'] }
  assert.ok(detailFor('uki@ssp-worldwide.com', ukiNonAdmin), 'must still see their own VBU\'s user')
  assert.equal(detailFor('ww@ssp-worldwide.com', ukiNonAdmin), null, 'must still be denied a different VBU\'s user — unchanged, correct behavior')
  assert.equal(detailFor('consolidated@ssp-worldwide.com', ukiNonAdmin), null)
})

test('a non-admin cannot bypass their own VBU boundary by spoofing isPreviewingVbu/canWrite-shaped fields — only a real canWrite:true session bypasses anything', () => {
  const spoofed = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', isPreviewingVbu: false, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide', 'VBU - SSP Consolidated'] }
  // Even if allowedVbus is somehow widened (which no real code path allows
  // a non-admin to do — computeAllowedVbusForUser never returns more than
  // the user's own single vbu), canWrite:false alone does NOT grant the
  // admin bypass; scoping still applies using whatever allowedVbus says.
  assert.ok(detailFor('uki@ssp-worldwide.com', spoofed))
  assert.ok(detailFor('ww@ssp-worldwide.com', spoofed), 'a widened allowedVbus (never producible by real code) would still be honored — this test documents that canWrite, not allowedVbus width, is the real admin bypass gate')
  assert.equal(detailFor('ww@ssp-worldwide.com', { canWrite: false, vbu: 'VBU - SSP UK & Ireland' }), null, 'without canWrite, and without a widened allowedVbus, a caller with only their own real vbu is still denied a different VBU\'s user')
})
