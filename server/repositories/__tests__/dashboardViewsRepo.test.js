// Dashboard View definitions (VBU-aware branding/theme/sidebar spec) — CRUD,
// JSON round-trip for theme/pages, stable-id generation, built-in
// protection. Runs against an isolated temp SQLite file (never the real
// app.sqlite), matching server/repositories/__tests__/rolesRepo.test.js's
// own pattern.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `dashboard-views-repo-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const dashboardViewsRepo = await import('../dashboardViewsRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => { run('DELETE FROM dashboard_views') })

test('createViewWithId creates a view with the exact stable id given (used by the startup seed)', () => {
  const view = dashboardViewsRepo.createViewWithId({
    id: 'SSP_UK_I', displayName: 'SSP UK & I', description: 'desc', logoKey: 'ssp_uk_i',
    theme: { accent: '#123456' }, pages: ['dashboard', 'users'], isBuiltin: true
  })
  assert.equal(view.id, 'SSP_UK_I')
  assert.equal(view.isBuiltin, true)
  assert.deepEqual(view.theme, { accent: '#123456' })
  assert.deepEqual(view.pages, ['dashboard', 'users'])
})

test('createView derives a stable, uppercase slug id from the display name and de-duplicates a collision', () => {
  const first = dashboardViewsRepo.createView({ displayName: 'SSP Test', pages: ['dashboard'] })
  assert.equal(first.ok, true)
  assert.equal(first.view.id, 'SSP_TEST')
  assert.equal(first.view.isBuiltin, false)

  const second = dashboardViewsRepo.createView({ displayName: 'SSP Test', pages: ['users'] })
  assert.equal(second.ok, true)
  assert.notEqual(second.view.id, first.view.id, 'a name collision must never silently overwrite the existing view')
})

test('createView rejects a blank display name', () => {
  const result = dashboardViewsRepo.createView({ displayName: '   ' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
})

test('updateView changes description/logo/theme/pages/active without changing the stable id', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'Temp View', logoKey: 'ssp', pages: ['dashboard'] })
  const updated = dashboardViewsRepo.updateView(view.id, {
    description: 'Updated', logoKey: 'ssp_worldwide', theme: { accent: '#ff0000' }, pages: ['dashboard', 'cost'], isActive: false
  })
  assert.equal(updated.id, view.id)
  assert.equal(updated.description, 'Updated')
  assert.equal(updated.logoKey, 'ssp_worldwide')
  assert.deepEqual(updated.theme, { accent: '#ff0000' })
  assert.deepEqual(updated.pages.sort(), ['cost', 'dashboard'])
  assert.equal(updated.isActive, false)
})

test('theme/pages/dashboard JSON round-trip exactly through get/list', () => {
  dashboardViewsRepo.createViewWithId({
    id: 'ROUNDTRIP', displayName: 'Roundtrip', theme: { accent: '#abcdef', sidebarActive: '#111111' }, pages: ['users', 'cost', 'optimization']
  })
  const fetched = dashboardViewsRepo.getView('ROUNDTRIP')
  assert.deepEqual(fetched.theme, { accent: '#abcdef', sidebarActive: '#111111' })
  assert.deepEqual(fetched.pages.sort(), ['cost', 'optimization', 'users'])
  const listed = dashboardViewsRepo.listViews().find((v) => v.id === 'ROUNDTRIP')
  assert.deepEqual(listed.theme, fetched.theme)
})

test('listActiveViews excludes a deactivated view', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'Will Deactivate' })
  dashboardViewsRepo.updateView(view.id, { isActive: false })
  assert.equal(dashboardViewsRepo.listActiveViews().some((v) => v.id === view.id), false)
  assert.equal(dashboardViewsRepo.getView(view.id).isActive, false, 'deactivating never deletes the row')
})

test('deleteView removes a custom view', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'Deletable' })
  const existed = dashboardViewsRepo.deleteView(view.id)
  assert.equal(existed, true)
  assert.equal(dashboardViewsRepo.getView(view.id), null)
})

// ---- Dashboard View VBU Data Assignment spec ----

test('a new view with no allowedVbuIds defaults to an empty array, never null/undefined', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'No VBUs Yet' })
  assert.deepEqual(view.allowedVbuIds, [])
})

test('createView stores multiple VBU ids for one view', () => {
  const { view } = dashboardViewsRepo.createView({
    displayName: 'Central Services', allowedVbuIds: ['VBU - SSP Operations', 'VBU - SSP Consolidated']
  })
  assert.deepEqual(view.allowedVbuIds.sort(), ['VBU - SSP Consolidated', 'VBU - SSP Operations'])
})

test('updateView changes allowedVbuIds independently of theme/pages/logo', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'Reassignable', allowedVbuIds: ['VBU - A'] })
  const updated = dashboardViewsRepo.updateView(view.id, { allowedVbuIds: ['VBU - A', 'VBU - B', 'VBU - C'] })
  assert.deepEqual(updated.allowedVbuIds.sort(), ['VBU - A', 'VBU - B', 'VBU - C'])
  assert.deepEqual(updated.theme, view.theme, 'an allowedVbuIds-only update must not touch theme')
  assert.deepEqual(updated.pages, view.pages, 'an allowedVbuIds-only update must not touch pages')
})

test('updateView omitting allowedVbuIds entirely leaves the existing value untouched (same "only patch what is provided" rule as every other field)', () => {
  const { view } = dashboardViewsRepo.createView({ displayName: 'Untouched VBUs', allowedVbuIds: ['VBU - Keep Me'] })
  const updated = dashboardViewsRepo.updateView(view.id, { description: 'just a description change' })
  assert.deepEqual(updated.allowedVbuIds, ['VBU - Keep Me'])
})

test('allowedVbuIds JSON round-trips exactly through get/list, same convention as theme/pages', () => {
  dashboardViewsRepo.createViewWithId({
    id: 'ROUNDTRIP_VBU', displayName: 'Roundtrip VBU', allowedVbuIds: ['VBU - SSP Worldwide']
  })
  const fetched = dashboardViewsRepo.getView('ROUNDTRIP_VBU')
  assert.deepEqual(fetched.allowedVbuIds, ['VBU - SSP Worldwide'])
  const listed = dashboardViewsRepo.listViews().find((v) => v.id === 'ROUNDTRIP_VBU')
  assert.deepEqual(listed.allowedVbuIds, fetched.allowedVbuIds)
})

test('allowedVbuIds survives an application restart (re-reading the same underlying SQLite file)', async () => {
  dashboardViewsRepo.createViewWithId({ id: 'SURVIVES_RESTART', displayName: 'Survives Restart', allowedVbuIds: ['VBU - Persisted'] })
  // Simulate a restart: force the db module to reload from the file on disk
  // rather than trusting the in-memory instance this same process already
  // has open (persist() already wrote it to tmpDbPath above).
  const dbModule = await import('../../db/index.js')
  const fresh = dbModule.all('SELECT allowed_vbus_json FROM dashboard_views WHERE id = ?', ['SURVIVES_RESTART'])[0]
  assert.deepEqual(JSON.parse(fresh.allowed_vbus_json), ['VBU - Persisted'])
})
