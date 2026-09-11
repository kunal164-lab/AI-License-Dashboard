// Local-administrator Dashboard View preview, end to end through
// computeEffectiveAccess (VBU-aware-views spec, "Local Administrator"
// section). Uses a real temp SQLite DB (dashboard views/assignments need
// real repo reads) — never the actual app.sqlite.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `local-admin-preview-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const dashboardViewsRepo = await import('../../repositories/dashboardViewsRepo.js')
const vbuViewAssignmentsRepo = await import('../../repositories/vbuViewAssignmentsRepo.js')
const dashboardViewsService = await import('../../services/dashboardViews.js')
const { computeEffectiveAccess } = await import('../authorize.js')
const { PAGE_KEYS } = await import('../pages.js')

const localUser = { username: 'admin', name: 'admin', authenticationProvider: 'local' }

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run('DELETE FROM dashboard_views')
  run('DELETE FROM vbu_view_assignments')
  dashboardViewsService.seedDefaultDashboardViews()
  dashboardViewsService.applyInitialWorldwideConfig()
  dashboardViewsService.applyInitialUkIrelandConfig()
})

test('computeEffectiveAccess(localUser): with no selection, behaves exactly as before this feature — full RBAC, SSP fallback view, never previewing', async () => {
  const access = await computeEffectiveAccess(localUser)
  assert.equal(access.canWrite, true)
  assert.deepEqual(access.allowedPages.sort(), [...PAGE_KEYS].sort())
  assert.equal(access.role, 'admin')
  assert.equal(access.vbu, null)
  assert.equal(access.dashboardView.id, 'SSP')
  assert.equal(access.isPreviewingVbu, false)
})

test('computeEffectiveAccess(localUser, { selectedDashboardViewId }): selecting SSP Worldwide previews its real VBU\'s data while RBAC stays identical', async () => {
  const withoutSelection = await computeEffectiveAccess(localUser)
  const withSelection = await computeEffectiveAccess(localUser, { selectedDashboardViewId: 'SSP_WORLDWIDE' })

  assert.equal(withSelection.canWrite, true)
  assert.deepEqual(withSelection.allowedPages.sort(), withoutSelection.allowedPages.sort(), 'RBAC allowedPages must be identical regardless of preview selection')
  assert.equal(withSelection.role, withoutSelection.role)

  assert.equal(withSelection.vbu, 'VBU - SSP Worldwide')
  assert.equal(withSelection.dashboardView.id, 'SSP_WORLDWIDE')
  assert.equal(withSelection.isPreviewingVbu, true)
})

test('computeEffectiveAccess(localUser, { selectedDashboardViewId }): the mechanism is generic — selecting SSP UK & Ireland previews THAT VBU instead, no code path hardcoded to Worldwide', async () => {
  const access = await computeEffectiveAccess(localUser, { selectedDashboardViewId: 'SSP_UK_I' })
  assert.equal(access.vbu, 'VBU - SSP UK & Ireland')
  assert.equal(access.isPreviewingVbu, true)
})

test('computeEffectiveAccess(localUser, { selectedDashboardViewId: "SSP" }): selecting the fallback default is NOT a preview — full global view, matching what a local admin already sees today', async () => {
  const access = await computeEffectiveAccess(localUser, { selectedDashboardViewId: 'SSP' })
  assert.equal(access.vbu, null)
  assert.equal(access.isPreviewingVbu, false)
})

test('selectedDashboardViewId is a no-op for a Microsoft-authenticated user — the parameter only ever affects a local-admin identity', async () => {
  // combineEffectiveAccess/computeEffectiveAccess's Microsoft branch needs
  // a real connection+mapping to produce non-empty access, which is out of
  // scope for this focused test — what matters here is structural: a
  // Microsoft user has no `authenticationProvider === 'local'` branch to
  // even reach, so passing a selection can only ever be inert for them.
  const msUser = { oid: 'abc', upn: 'someone@ssp.com', authenticationProvider: 'microsoft' }
  const access = await computeEffectiveAccess(msUser, { selectedDashboardViewId: 'SSP_WORLDWIDE' })
  assert.equal(access.isPreviewingVbu, false, 'a Microsoft user is never "previewing" — the concept does not apply to them')
})
