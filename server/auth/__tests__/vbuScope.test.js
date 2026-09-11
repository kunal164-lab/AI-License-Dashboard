// Real backend-enforced VBU data isolation (server/auth/vbuScope.js) —
// pure function tests, no I/O. Admin bypass, generic (never hardcoded to
// one specific VBU string) filtering, unknown-record exclusion, case/
// whitespace-insensitive matching, and the never-fail-open guarantee.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAdminAccess, belongsToVbu, belongsToAnyVbu, scopeCanonicalUsersByVbu, scopeRecordsByVbu, scopeMicrosoftUsers,
  scopeMicrosoftDirectory, scopeMicrosoftDataset, scopeApplicationsOverview, ownsMicrosoftUser,
  scopeApplicationDetailDevices, effectiveVbuFilterValue
} from '../vbuScope.js'

const admin = { canWrite: true, vbu: null }
const ukiUser = { canWrite: false, vbu: 'VBU - SSP UK & Ireland' }
const worldwideUser = { canWrite: false, vbu: 'VBU - SSP Worldwide' }
const noVbuUser = { canWrite: false, vbu: null }

test('isAdminAccess is true only for canWrite, regardless of vbu', () => {
  assert.equal(isAdminAccess(admin), true)
  assert.equal(isAdminAccess(ukiUser), false)
  assert.equal(isAdminAccess(null), false)
  assert.equal(isAdminAccess(undefined), false)
})

// ---- Local-admin Dashboard View preview (isPreviewingVbu) ----
// server/services/dashboardViews.js#applyLocalAdminPreview is the only
// thing that ever sets isPreviewingVbu — it can never be set for (or
// reached by) a real Microsoft-authenticated session.
//
// isPreviewingVbu is deliberately IGNORED by isAdminAccess (reversed from
// an earlier design — see isAdminAccess's own comment in vbuScope.js for
// the concrete production bug this caused: a previewing admin randomly
// losing access to real users' detail pages, live-confirmed as 153/296
// and 163/296 real canonical users becoming inaccessible depending on
// which Dashboard View happened to be selected). An admin's own
// authorization is never narrowed by which view they are previewing.

test('isAdminAccess: canWrite alone always bypasses scoping, regardless of isPreviewingVbu — Dashboard View selection can never narrow an admin\'s own authorization', () => {
  assert.equal(isAdminAccess({ canWrite: true }), true)
  assert.equal(isAdminAccess({ canWrite: true, isPreviewingVbu: false }), true)
  assert.equal(isAdminAccess({ canWrite: true, isPreviewingVbu: true, vbu: 'VBU - SSP Worldwide' }), true)
  assert.equal(isAdminAccess({ canWrite: true, isPreviewingVbu: true, allowedVbus: ['VBU - SSP Worldwide'] }), true)
})

test('scopeCanonicalUsersByVbu: an admin previewing a single-VBU Dashboard View (e.g. SSP Worldwide) still sees EVERY VBU\'s users — preview only ever affects branding, never business-data access', () => {
  const previewingWorldwide = { canWrite: true, isPreviewingVbu: true, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP Worldwide'] }
  const users = [
    { _id: '1', vbu: 'VBU - SSP UK & Ireland' },
    { _id: '2', vbu: 'VBU - SSP Worldwide' },
    { _id: '3', vbu: 'VBU - SSP Consolidated' }
  ]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, previewingWorldwide), users, 'the admin must see every real user regardless of the previewed view\'s own configured VBU scope')
})

test('belongsToVbu matches trimmed and case-insensitively, never for a blank caller vbu', () => {
  assert.equal(belongsToVbu('VBU - SSP UK & Ireland', 'vbu - ssp uk & ireland'), true)
  assert.equal(belongsToVbu('  VBU - SSP UK & Ireland  ', 'VBU - SSP UK & Ireland'), true)
  assert.equal(belongsToVbu('VBU - SSP Worldwide', 'VBU - SSP UK & Ireland'), false)
  assert.equal(belongsToVbu('VBU - SSP UK & Ireland', null), false)
  assert.equal(belongsToVbu(null, 'VBU - SSP UK & Ireland'), false)
})

test('scopeCanonicalUsersByVbu: admin sees everyone; a non-admin sees only their own VBU, generically (not hardcoded to one VBU string)', () => {
  const users = [
    { _id: '1', vbu: 'VBU - SSP UK & Ireland' },
    { _id: '2', vbu: 'VBU - SSP Worldwide' },
    { _id: '3', vbu: 'VBU - SSP Consolidated' }
  ]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, admin), users)
  assert.deepEqual(scopeCanonicalUsersByVbu(users, ukiUser).map((u) => u._id), ['1'])
  assert.deepEqual(scopeCanonicalUsersByVbu(users, worldwideUser).map((u) => u._id), ['2'])
})

test('scopeCanonicalUsersByVbu: a non-admin with no resolvable VBU sees nothing (fail closed)', () => {
  const users = [{ _id: '1', vbu: 'VBU - SSP UK & Ireland' }]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, noVbuUser), [])
  assert.deepEqual(scopeCanonicalUsersByVbu(users, undefined), [], 'omitting access entirely must also fail closed, never fail open')
})

test('scopeRecordsByVbu resolves each record\'s owner through the directory Map by email, excludes an unmatched record for non-admins', () => {
  const directory = new Map([
    ['uki@ssp.com', { vbu: 'VBU - SSP UK & Ireland' }],
    ['worldwide@ssp.com', { vbu: 'VBU - SSP Worldwide' }]
  ])
  const records = [
    { email: 'uki@ssp.com', product: 'Kiro' },
    { email: 'worldwide@ssp.com', product: 'Kiro' },
    { email: 'unknown@ssp.com', product: 'Kiro' }
  ]
  const scoped = scopeRecordsByVbu(records, directory, ukiUser)
  assert.deepEqual(scoped.map((r) => r.email), ['uki@ssp.com'])
  // Admin sees everything, including the unmatched record.
  assert.equal(scopeRecordsByVbu(records, directory, admin).length, 3)
})

test('scopeMicrosoftUsers filters raw microsoft_users-shaped rows by their own .vbu field directly', () => {
  const users = [{ ms_id: 'a', vbu: 'VBU - SSP UK & Ireland' }, { ms_id: 'b', vbu: 'VBU - SSP Worldwide' }]
  assert.deepEqual(scopeMicrosoftUsers(users, ukiUser).map((u) => u.ms_id), ['a'])
  assert.deepEqual(scopeMicrosoftUsers(users, admin), users)
})

test('scopeMicrosoftDirectory scopes the Map<email,info> shape sent as /api/dashboard\'s microsoftDirectory field', () => {
  const directory = new Map([
    ['a@ssp.com', { vbu: 'VBU - SSP UK & Ireland' }],
    ['b@ssp.com', { vbu: 'VBU - SSP Worldwide' }]
  ])
  const scoped = scopeMicrosoftDirectory(directory, ukiUser)
  assert.equal(scoped.size, 1)
  assert.ok(scoped.has('a@ssp.com'))
  assert.equal(scopeMicrosoftDirectory(directory, admin).size, 2)
  assert.equal(scopeMicrosoftDirectory(directory, noVbuUser).size, 0)
})

test('scopeMicrosoftDataset joins devices/licenses/signIns/deviceApplications/applications down to only the scoped users, leaves groups untouched (no membership data to join on)', () => {
  const dataset = {
    users: [
      { ms_id: 'u1', upn: 'uki@ssp.com', mail: 'uki@ssp.com', vbu: 'VBU - SSP UK & Ireland' },
      { ms_id: 'u2', upn: 'ww@ssp.com', mail: 'ww@ssp.com', vbu: 'VBU - SSP Worldwide' }
    ],
    devices: [
      { ms_id: 'd1', user_ms_id: 'u1', user_principal_name: 'uki@ssp.com' },
      { ms_id: 'd2', user_ms_id: 'u2', user_principal_name: 'ww@ssp.com' }
    ],
    applications: [{ ms_id: 'app1' }, { ms_id: 'app2' }],
    deviceApplications: [{ device_ms_id: 'd1', application_ms_id: 'app1' }, { device_ms_id: 'd2', application_ms_id: 'app2' }],
    licenses: [{ user_ms_id: 'u1' }, { user_ms_id: 'u2' }],
    signIns: [{ user_principal_name: 'uki@ssp.com' }, { user_principal_name: 'ww@ssp.com' }]
  }
  const scoped = scopeMicrosoftDataset(dataset, ukiUser)
  assert.deepEqual(scoped.users.map((u) => u.ms_id), ['u1'])
  assert.deepEqual(scoped.devices.map((d) => d.ms_id), ['d1'])
  assert.deepEqual(scoped.applications.map((a) => a.ms_id), ['app1'])
  assert.deepEqual(scoped.deviceApplications.map((da) => da.device_ms_id), ['d1'])
  assert.deepEqual(scoped.licenses.map((l) => l.user_ms_id), ['u1'])
  assert.deepEqual(scoped.signIns.map((s) => s.user_principal_name), ['uki@ssp.com'])

  const adminScoped = scopeMicrosoftDataset(dataset, admin)
  assert.equal(adminScoped.users.length, 2)
  assert.equal(adminScoped.devices.length, 2)
})

test('scopeApplicationsOverview scopes the lightweight device-user-link shape by upn, cascading to deviceApplications/applications', () => {
  const dataset = {
    users: [{ ms_id: 'u1', upn: 'uki@ssp.com', mail: 'uki@ssp.com', vbu: 'VBU - SSP UK & Ireland' }],
    deviceUserLinks: [{ ms_id: 'd1', user_principal_name: 'uki@ssp.com' }, { ms_id: 'd2', user_principal_name: 'other@ssp.com' }],
    deviceApplications: [{ device_ms_id: 'd1', application_ms_id: 'app1' }, { device_ms_id: 'd2', application_ms_id: 'app2' }],
    applications: [{ ms_id: 'app1' }, { ms_id: 'app2' }]
  }
  const scoped = scopeApplicationsOverview(dataset, ukiUser)
  assert.deepEqual(scoped.deviceUserLinks.map((d) => d.ms_id), ['d1'])
  assert.deepEqual(scoped.applications.map((a) => a.ms_id), ['app1'])
})

test('ownsMicrosoftUser: true for an admin regardless of the owner, true for a non-admin only when the owner\'s vbu matches, false for a null owner (unassigned device/user)', () => {
  const owner = { vbu: 'VBU - SSP UK & Ireland' }
  assert.equal(ownsMicrosoftUser(owner, admin), true)
  assert.equal(ownsMicrosoftUser(owner, ukiUser), true)
  assert.equal(ownsMicrosoftUser(owner, worldwideUser), false)
  assert.equal(ownsMicrosoftUser(null, ukiUser), false)
  assert.equal(ownsMicrosoftUser(null, admin), true, 'an admin can view an unassigned device/user too')
})

test('scopeApplicationDetailDevices narrows only the devices list, leaves summary/versions/linkageCoverage untouched (an application is not VBU-owned, only its installations are)', () => {
  const detail = {
    summary: { displayName: 'Some App', totalDeviceCount: 2 },
    versions: [{ ms_id: 'v1' }],
    linkageCoverage: { linkedVersions: 1 },
    devices: [
      { device_ms_id: 'd1', user_principal_name: 'uki@ssp.com' },
      { device_ms_id: 'd2', user_principal_name: 'ww@ssp.com' }
    ]
  }
  const users = [
    { ms_id: 'u1', upn: 'uki@ssp.com', mail: 'uki@ssp.com', vbu: 'VBU - SSP UK & Ireland' },
    { ms_id: 'u2', upn: 'ww@ssp.com', mail: 'ww@ssp.com', vbu: 'VBU - SSP Worldwide' }
  ]
  const scoped = scopeApplicationDetailDevices(detail, users, ukiUser)
  assert.deepEqual(scoped.devices.map((d) => d.device_ms_id), ['d1'])
  assert.deepEqual(scoped.summary, detail.summary, 'tenant-wide catalog stats are never narrowed')
  assert.deepEqual(scoped.versions, detail.versions)

  const adminScoped = scopeApplicationDetailDevices(detail, users, admin)
  assert.equal(adminScoped.devices.length, 2)
})

// ---- Dashboard View VBU Data Assignment spec — multi-VBU allowedVbus ----
// access.allowedVbus (server/auth/authorize.js#withDashboardView /
// applyLocalAdminPreview) is now the real scoping input; access.vbu alone
// (used throughout the tests above, with no allowedVbus at all) must keep
// working identically via the legacy-shape fallback — these tests instead
// exercise the richer, multi-VBU shape directly.

test('scopeCanonicalUsersByVbu: a local admin previewing SSP Central Services (configured with multiple VBUs) sees EVERY user, not just the union of the configured VBUs — canWrite:true always bypasses, isPreviewingVbu no longer matters', () => {
  const centralServicesPreview = { canWrite: true, isPreviewingVbu: true, allowedVbus: ['VBU - SSP Operations', 'VBU - SSP Consolidated'] }
  const users = [
    { _id: '1', vbu: 'VBU - SSP Operations' },
    { _id: '2', vbu: 'VBU - SSP Consolidated' },
    { _id: '3', vbu: 'VBU - SSP Worldwide' }
  ]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, centralServicesPreview), users)
})

test('scopeCanonicalUsersByVbu: the underlying multi-VBU union mechanism (belongsToAnyVbu) is still correct in isolation for a hypothetical non-admin multi-VBU caller — real admin sessions never reach this path any more (always bypassed above), but the mechanism itself remains available/correct for any future non-admin use', () => {
  const hypotheticalMultiVbuNonAdmin = { canWrite: false, allowedVbus: ['VBU - SSP Operations', 'VBU - SSP Consolidated'] }
  const users = [
    { _id: '1', vbu: 'VBU - SSP Operations' },
    { _id: '2', vbu: 'VBU - SSP Consolidated' },
    { _id: '3', vbu: 'VBU - SSP Worldwide' }
  ]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, hypotheticalMultiVbuNonAdmin).map((u) => u._id).sort(), ['1', '2'])
})

test('scopeCanonicalUsersByVbu: a real non-admin user\'s allowedVbus is never wider than their own single vbu, even if the Dashboard View itself was configured with several — Dashboard View config can only narrow, never widen, real user authorization', () => {
  // This is exactly what computeAllowedVbusForUser (server/services/
  // dashboardViews.js) always produces for a real user: at most their own
  // single vbu, regardless of how many VBUs the resolved view allows.
  const ukiUserUnderMultiVbuView = { canWrite: false, allowedVbus: ['VBU - SSP UK & Ireland'] }
  const users = [
    { _id: '1', vbu: 'VBU - SSP UK & Ireland' },
    { _id: '2', vbu: 'VBU - SSP Worldwide' }
  ]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, ukiUserUnderMultiVbuView).map((u) => u._id), ['1'], 'must never see VBU - SSP Worldwide just because the view they are viewing was also configured to allow it')
})

test('an explicit empty allowedVbus array means "no accessible VBU" — never falls back to the legacy access.vbu field', () => {
  const noAccess = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', allowedVbus: [] }
  const users = [{ _id: '1', vbu: 'VBU - SSP UK & Ireland' }]
  assert.deepEqual(scopeCanonicalUsersByVbu(users, noAccess), [], 'an explicit empty allowedVbus is a real "excluded by the Dashboard View" result, not "not yet computed"')
})

test('belongsToAnyVbu matches a row against ANY of several allowed VBUs, generically', () => {
  assert.equal(belongsToAnyVbu('VBU - SSP Worldwide', ['VBU - SSP UK & Ireland', 'vbu - ssp worldwide']), true)
  assert.equal(belongsToAnyVbu('VBU - SSP Consolidated', ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide']), false)
  assert.equal(belongsToAnyVbu('VBU - SSP Worldwide', []), false)
  assert.equal(belongsToAnyVbu('VBU - SSP Worldwide', null), false)
})

test('effectiveVbuFilterValue: undefined for an admin (no filter), a comma-joined list for a multi-VBU caller, and a value that matches nothing for a caller with no accessible VBU', () => {
  assert.equal(effectiveVbuFilterValue(admin), undefined)
  assert.equal(effectiveVbuFilterValue({ canWrite: false, allowedVbus: ['VBU - A', 'VBU - B'] }), 'VBU - A,VBU - B')
  const sentinel = effectiveVbuFilterValue({ canWrite: false, allowedVbus: [] })
  assert.notEqual(sentinel, undefined)
  assert.equal(['VBU - A', 'VBU - B', ''].includes(sentinel), false, 'the sentinel must never coincide with a real VBU value')
})

test('a canonical user with no tracked product relationship never enters this scoping layer in the first place — scoping operates on an already-canonical population, it never re-derives or widens it', () => {
  // Guards the "apply population rule, THEN VBU scope" ordering (Part H of
  // the VBU Data Assignment spec) at the boundary this module actually
  // owns: scopeCanonicalUsersByVbu only ever filters the list it is GIVEN.
  // It has no access to the raw Microsoft directory and cannot invent a
  // user that was not already in `canonicalUsers` — the population rule
  // itself lives entirely upstream in src/utils/userModel.js#
  // buildCanonicalUsers (see server/utils/__tests__/
  // dashboardUserPopulation.test.js), unchanged by this feature.
  const admin2 = { canWrite: true }
  const onlyTrackedUser = [{ _id: '1', vbu: 'VBU - SSP Worldwide' }]
  assert.deepEqual(scopeCanonicalUsersByVbu(onlyTrackedUser, admin2), onlyTrackedUser)
})
