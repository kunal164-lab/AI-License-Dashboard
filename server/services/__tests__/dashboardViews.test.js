// VBU-aware Dashboard View resolution — the spec's own test list (Part 22):
// VBU resolves correctly, VBU -> correct view for each of the three
// initial views, logo/theme/pages resolve from view config, effective
// pages = RBAC intersected with the view (never widened), unknown/missing
// VBU or view falls back safely, seeding is idempotent. Uses a real temp
// SQLite DB (same pattern as server/services/__tests__/microsoftLicenses.
// test.js) since resolveVbuForUpn reads from the real microsoftRepo.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `dashboard-views-service-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const connectionsRepo = await import('../../repositories/connectionsRepo.js')
const msRepo = await import('../../repositories/microsoftRepo.js')
const dashboardViewsRepo = await import('../../repositories/dashboardViewsRepo.js')
const vbuViewAssignmentsRepo = await import('../../repositories/vbuViewAssignmentsRepo.js')
const dashboardViews = await import('../dashboardViews.js')

// resolveDashboardView now resolves entirely from a view's own
// allowedVbuIds (VBU-scoping bug fix — see resolveDashboardView's own
// comment for why the old, separate vbu_view_assignments table was retired
// as a resolution mechanism). This helper lets the tests below express "map
// this VBU to this view" the same way an administrator does through the
// admin UI's "VBU Data" checkboxes, without reaching into the retired repo.
function assignVbuToView(vbu, viewId) {
  const view = dashboardViewsRepo.getView(viewId)
  dashboardViewsRepo.updateView(viewId, { allowedVbuIds: [...(view.allowedVbuIds || []), vbu] })
}

function graphUser({ id, displayName, upn, vbu }) {
  return {
    id, displayName, userPrincipalName: upn, mail: upn, companyName: 'SSP', accountEnabled: true,
    assignedLicenses: [], onPremisesExtensionAttributes: vbu ? { extensionAttribute3: vbu } : {}
  }
}

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run("DELETE FROM connections WHERE source = 'microsoft'")
  run('DELETE FROM microsoft_users')
  run('DELETE FROM dashboard_views')
  run('DELETE FROM vbu_view_assignments')
})

function seedUser({ upn, vbu }) {
  const connId = connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS', authType: 'client_credentials', credentials: {}, meta: {} }).id
  msRepo.upsertUsers(connId, [graphUser({ id: 'u1', displayName: 'Test User', upn, vbu })])
}

test('resolveVbuForUpn resolves the real VBU stored on the Microsoft directory record', () => {
  seedUser({ upn: 'alice@ssp-worldwide.com', vbu: 'SSP Worldwide' })
  assert.equal(dashboardViews.resolveVbuForUpn('alice@ssp-worldwide.com'), 'SSP Worldwide')
})

test('resolveVbuForUpn returns null for an unknown upn and for no upn at all (local admin)', () => {
  assert.equal(dashboardViews.resolveVbuForUpn('nobody@ssp-worldwide.com'), null)
  assert.equal(dashboardViews.resolveVbuForUpn(null), null)
  assert.equal(dashboardViews.resolveVbuForUpn(undefined), null)
})

test('seedDefaultDashboardViews creates exactly the three initial views, each with the full page list and no theme override', async () => {
  const { PAGE_KEYS } = await import('../../auth/pages.js')
  dashboardViews.seedDefaultDashboardViews()
  const ssp = dashboardViewsRepo.getView('SSP')
  const worldwide = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  const uki = dashboardViewsRepo.getView('SSP_UK_I')
  assert.ok(ssp && worldwide && uki)
  for (const v of [ssp, worldwide, uki]) {
    assert.deepEqual(v.theme, {}, 'no theme override until an admin configures one')
    assert.deepEqual(v.pages.sort(), [...PAGE_KEYS].sort())
    assert.equal(v.isBuiltin, true)
    assert.equal(v.isActive, true)
  }
})

test('seedDefaultDashboardViews is idempotent — running it again never duplicates or resets an admin edit', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP_WORLDWIDE', { theme: { accent: '#123456' } })
  dashboardViews.seedDefaultDashboardViews()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_WORLDWIDE').theme, { accent: '#123456' }, 're-running the seed must never overwrite an existing view')
  assert.equal(dashboardViewsRepo.listViews().filter((v) => v.id === 'SSP_WORLDWIDE').length, 1)
})

test('applyInitialUkIrelandConfig sets the real SSP UK & Ireland branding (incl. the larger logo, header/sidebar decoration, and light active-nav pill) and creates its real VBU assignment', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialUkIrelandConfig()
  const view = dashboardViewsRepo.getView('SSP_UK_I')
  assert.equal(view.displayName, 'SSP UK & Ireland')
  assert.equal(view.logoKey, 'ssp_uk_i')
  assert.equal(view.theme.sidebarLogoWidth, '160px')
  assert.equal(view.theme.headerDecorationKey, 'blush-curves')
  assert.equal(view.theme.sidebarDecorationKey, 'blush-flow')
  assert.equal(view.theme._configVersion, dashboardViews.UK_IRELAND_CONFIG_VERSION)
  assert.ok(view.theme.sidebarDecorationColor, 'the decorative artwork must use its own softer color, not just the sharp accent')
  assert.ok(view.theme.headerDecorationColor)
  assert.ok(view.theme.sidebarActiveBg && view.theme.sidebarActiveText, 'a light active pill must always pair with a dark active text color')
  const resolved = dashboardViews.resolveDashboardView('VBU - SSP UK & Ireland')
  assert.equal(resolved.id, 'SSP_UK_I', 'the real live Microsoft VBU string must resolve to this view')
})

test('applyInitialUkIrelandConfig is idempotent once the correction marker (sidebarDecorationKey) is present — never overwrites a later admin edit', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialUkIrelandConfig()
  const corrected = dashboardViewsRepo.getView('SSP_UK_I')
  // Admin edits the accent afterward but keeps the correction's own marker
  // field intact — this is the realistic "already-corrected, then
  // customized" state a second run must respect.
  dashboardViewsRepo.updateView('SSP_UK_I', { theme: { ...corrected.theme, accent: '#123456' } })
  dashboardViews.applyInitialUkIrelandConfig()
  assert.equal(dashboardViewsRepo.getView('SSP_UK_I').theme.accent, '#123456', 're-running must never overwrite an admin\'s customization once the correction marker is present')
})

test('applyInitialUkIrelandConfig re-applies if the marker field is missing (e.g. the view was only ever set up by an earlier version of this function, before this correction existed) — a documented, intentional one-time-migration trade-off', () => {
  dashboardViews.seedDefaultDashboardViews()
  // Simulates the PRE-correction seeded state (theme set, but with none of
  // this correction's own fields).
  dashboardViewsRepo.updateView('SSP_UK_I', { theme: { accent: '#123456' } })
  dashboardViews.applyInitialUkIrelandConfig()
  const view = dashboardViewsRepo.getView('SSP_UK_I')
  assert.equal(view.theme.sidebarDecorationKey, 'blush-flow')
  assert.equal(view.theme.sidebarLogoWidth, '160px')
})

// Direct regression test for the actual bug found while diagnosing why the
// deployed UK & Ireland view still showed a 128px logo after this exact
// correction shipped: an OLDER _configVersion (with its own marker fields
// already present, e.g. sidebarDecorationKey from a prior revision) must
// still be treated as needing THIS revision's updated values — field
// PRESENCE alone is never sufficient once a value inside an already-shipped
// revision changes.
test('applyInitialUkIrelandConfig re-applies when an OLDER _configVersion is stored, even though its own marker fields already exist — this is the exact bug the version guard fixes', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP_UK_I', {
    theme: {
      _configVersion: dashboardViews.UK_IRELAND_CONFIG_VERSION - 1,
      sidebarDecorationKey: 'blush-flow', // present, but from an "older revision"
      sidebarLogoWidth: '128px' // the stale value this exact bug left behind
    }
  })
  dashboardViews.applyInitialUkIrelandConfig()
  const view = dashboardViewsRepo.getView('SSP_UK_I')
  assert.equal(view.theme.sidebarLogoWidth, '160px', 'the current revision\'s value must win over a stale one from an older _configVersion')
  assert.equal(view.theme._configVersion, dashboardViews.UK_IRELAND_CONFIG_VERSION)
})

test('SSP Worldwide and SSP UK & Ireland use the IDENTICAL sidebar logo width — one shared approved value, never a separate per-view sizing rule', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialUkIrelandConfig()
  dashboardViews.applyInitialWorldwideConfig()
  const uki = dashboardViewsRepo.getView('SSP_UK_I')
  const worldwide = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  assert.equal(worldwide.theme.sidebarLogoWidth, uki.theme.sidebarLogoWidth)
})

test('applyInitialWorldwideConfig sets the real SSP Worldwide branding (incl. real header/sidebar artwork + sidebar tagline) and creates its real VBU assignment', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialWorldwideConfig()
  const view = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  assert.equal(view.displayName, 'SSP Worldwide')
  assert.equal(view.logoKey, 'ssp_worldwide')
  assert.equal(view.theme.headerDecorationKey, 'globe-header', 'real provided artwork, not the earlier SVG-recreated header graphic')
  assert.equal(view.theme.sidebarDecorationKey, 'globe-sidebar', 'real provided artwork, not a CSS/SVG recreation')
  assert.ok(view.theme.sidebarTagline)
  assert.equal(view.theme.sidebarLogoWidth, '160px', 'Worldwide must use the exact same approved logo width as UK & Ireland — no separate sizing rule')
  const resolved = dashboardViews.resolveDashboardView('VBU - SSP Worldwide')
  assert.equal(resolved.id, 'SSP_WORLDWIDE', 'the real live Microsoft VBU string must resolve to this view')
})

test('applyInitialWorldwideConfig is idempotent once the correction\'s _configVersion is present — never overwrites a later admin edit', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialWorldwideConfig()
  const corrected = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  // Admin edits the accent afterward but keeps the correction's own
  // _configVersion marker intact (exactly what a real save through
  // Administration -> Dashboard Views does — see dashboardViewsAdminRoutes.js
  // #validTheme, which always round-trips _configVersion unchanged).
  dashboardViewsRepo.updateView('SSP_WORLDWIDE', { theme: { ...corrected.theme, accent: '#654321' } })
  dashboardViews.applyInitialWorldwideConfig()
  assert.equal(dashboardViewsRepo.getView('SSP_WORLDWIDE').theme.accent, '#654321', 're-running must never overwrite an admin\'s customization once _configVersion is present')
})

test('applyInitialWorldwideConfig re-applies if _configVersion is missing (e.g. the view was only ever set up by an earlier version of this function) — a documented, intentional one-time-migration trade-off', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP_WORLDWIDE', { theme: { accent: '#654321' } })
  dashboardViews.applyInitialWorldwideConfig()
  const view = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  assert.equal(view.theme.headerDecorationKey, 'globe-header')
  assert.equal(view.theme._configVersion, dashboardViews.WORLDWIDE_CONFIG_VERSION)
})

// ---- Dashboard View VBU Data Assignment spec ----

test('applyInitialUkIrelandConfig/applyInitialWorldwideConfig each seed allowedVbuIds with their OWN real VBU — the intended default assignment', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialUkIrelandConfig()
  dashboardViews.applyInitialWorldwideConfig()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_UK_I').allowedVbuIds, ['VBU - SSP UK & Ireland'])
  assert.deepEqual(dashboardViewsRepo.getView('SSP_WORLDWIDE').allowedVbuIds, ['VBU - SSP Worldwide'])
})

test('applyInitialCentralServicesConfig renames the built-in SSP view to "SSP Central Services" — id stays SSP', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  assert.equal(view.id, 'SSP', 'the stable id must never change, only the display name')
  assert.equal(view.displayName, 'SSP Central Services')
  assert.equal(view.theme._configVersion, dashboardViews.CENTRAL_SERVICES_CONFIG_VERSION)
})

test('applyInitialCentralServicesConfig is idempotent and never overwrites an administrator\'s own later rename/edit', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialCentralServicesConfig()
  const corrected = dashboardViewsRepo.getView('SSP')
  dashboardViewsRepo.updateView('SSP', { displayName: 'Renamed By Admin', theme: { ...corrected.theme, accent: '#111111' } })
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  assert.equal(view.displayName, 'Renamed By Admin', 're-running must never clobber an admin\'s own later rename')
  assert.equal(view.theme.accent, '#111111')
})

test('applyInitialCentralServicesConfig preserves an administrator\'s already-configured allowedVbuIds/pages/logo — the rename only ever touches displayName/description/_configVersion', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP', { allowedVbuIds: ['VBU - SSP Operations'], logoKey: 'ssp_worldwide', pages: ['dashboard'] })
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  assert.equal(view.displayName, 'SSP Central Services')
  assert.deepEqual(view.allowedVbuIds, ['VBU - SSP Operations'], 'existing SSP configuration must not break')
  assert.equal(view.logoKey, 'ssp_worldwide')
  assert.deepEqual(view.pages, ['dashboard'])
})

// ---- SSP Central Services visual-refinement spec ("Option 3" warm cream) ----

test('applyInitialCentralServicesConfig sets a barely-there warm palette (very close to white/neutral, not visibly cream) and restrained header graphic, without touching accent/sidebar-active (keeps the existing blue/navy) or adding sidebar artwork', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  assert.equal(view.theme.contentBackground, '#fdfcf8')
  assert.equal(view.theme.contentBorderColor, '#e8e4db')
  assert.equal(view.theme.headerBackground, '#fdfcf9')
  assert.equal(view.theme.headerGraphicKey, 'globe-network', 'reuses the existing restrained SVG header graphic, never a new/duplicate one')
  assert.equal(view.theme.sidebarDecorationKey, undefined, 'no sidebar decorative artwork')
  assert.equal(view.theme.accent, undefined, 'accent/active-nav are left unset — keeps the existing blue/navy treatment')
  assert.equal(view.theme.sidebarActive, undefined)
  assert.equal(view.theme.sidebarGradientStart, undefined, 'sidebar top stays the exact same cool navy — only the bottom gets a subtle warm touch')
  assert.equal(view.theme.headerMinHeight, undefined, 'header height is untouched — stays compact/content-driven')
  assert.equal(view.theme._configVersion, dashboardViews.CENTRAL_SERVICES_CONFIG_VERSION)
})

test('the content-area colors are genuinely close to white/neutral, not a strong cream — every channel of contentBackground/headerBackground stays within a few points of 255', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  for (const hex of [view.theme.contentBackground, view.theme.headerBackground]) {
    const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16))
    assert.ok(r >= 250 && g >= 248 && b >= 240, `${hex} must read as barely-there white-with-warmth, not a visibly cream color`)
    assert.ok(r - b <= 12, `${hex}'s warmth (red-vs-blue channel gap) must be subtle, not a strong yellow/cream cast`)
  }
})

test('the subtle sidebar warm touch only ever affects the gradient END (bottom) — stays very dark/near-black, never a lightened or yellow tone', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialCentralServicesConfig()
  const view = dashboardViewsRepo.getView('SSP')
  const hex = view.theme.sidebarGradientEnd
  assert.ok(hex, 'expected a subtle sidebar tonal touch')
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16))
  assert.ok(Math.max(r, g, b) < 40, 'must stay very dark (near-black), never a lightened/yellow sidebar')
})

test('applying the Central Services visual refinement does not touch SSP UK & Ireland or SSP Worldwide\'s own configuration at all', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialUkIrelandConfig()
  dashboardViews.applyInitialWorldwideConfig()
  const ukiBefore = dashboardViewsRepo.getView('SSP_UK_I')
  const worldwideBefore = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  dashboardViews.applyInitialCentralServicesConfig()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_UK_I').theme, ukiBefore.theme)
  assert.deepEqual(dashboardViewsRepo.getView('SSP_WORLDWIDE').theme, worldwideBefore.theme)
})

test('computeAllowedVbusForUser: no resolvable vbu at all -> empty scope regardless of the view', () => {
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser(null, { allowedVbuIds: ['VBU - A'] }), [])
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser(null, { allowedVbuIds: [] }), [])
})

test('computeAllowedVbusForUser: a view with NO configured allowedVbuIds defers entirely to the user\'s own vbu (today\'s exact pre-existing behavior)', () => {
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser('VBU - SSP Worldwide', { allowedVbuIds: [] }), ['VBU - SSP Worldwide'])
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser('VBU - SSP Worldwide', null), ['VBU - SSP Worldwide'])
})

test('computeAllowedVbusForUser: a view configured to include the user\'s own vbu resolves to exactly that one vbu', () => {
  const view = { allowedVbuIds: ['VBU - SSP Worldwide', 'VBU - SSP Operations'] }
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser('VBU - SSP Worldwide', view), ['VBU - SSP Worldwide'])
})

test('computeAllowedVbusForUser: a view configured WITHOUT the user\'s own vbu yields an empty scope — a view can never WIDEN what a real user is allowed to see (fail closed)', () => {
  const view = { allowedVbuIds: ['VBU - SSP Operations', 'VBU - SSP Consolidated'] }
  assert.deepEqual(dashboardViews.computeAllowedVbusForUser('VBU - SSP UK & Ireland', view), [])
})

// ---- Local-admin Dashboard View preview (applyLocalAdminPreview) ----

test('applyLocalAdminPreview: a view WITH a VBU assignment sets previewVbu/isPreviewingVbu generically — works identically for Worldwide or UK & Ireland, not hardcoded to one', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViews.applyInitialWorldwideConfig()
  dashboardViews.applyInitialUkIrelandConfig()
  const baseAccess = { role: 'admin', allowedPages: ['dashboard', 'cost'], canWrite: true, isBootstrapAdmin: false }

  const worldwidePreview = dashboardViews.applyLocalAdminPreview('SSP_WORLDWIDE', baseAccess)
  assert.equal(worldwidePreview.vbu, 'VBU - SSP Worldwide')
  assert.equal(worldwidePreview.isPreviewingVbu, true)
  assert.equal(worldwidePreview.dashboardView.id, 'SSP_WORLDWIDE')
  assert.equal(worldwidePreview.canWrite, true, 'RBAC (canWrite) is never touched by a preview')
  assert.deepEqual(worldwidePreview.allowedPages, baseAccess.allowedPages, 'RBAC allowedPages is never touched by a preview')

  const ukiPreview = dashboardViews.applyLocalAdminPreview('SSP_UK_I', baseAccess)
  assert.equal(ukiPreview.vbu, 'VBU - SSP UK & Ireland')
  assert.equal(ukiPreview.isPreviewingVbu, true)
})

test('applyLocalAdminPreview: a view with NO VBU assignment (SSP, the fallback default) yields the full global/unscoped preview', () => {
  dashboardViews.seedDefaultDashboardViews()
  const baseAccess = { role: 'admin', allowedPages: ['dashboard'], canWrite: true, isBootstrapAdmin: false }
  const sspPreview = dashboardViews.applyLocalAdminPreview('SSP', baseAccess)
  assert.equal(sspPreview.vbu, null)
  assert.equal(sspPreview.isPreviewingVbu, false)
  assert.equal(sspPreview.dashboardView.id, 'SSP')
})

test('applyLocalAdminPreview: a view configured with SEVERAL VBUs (e.g. SSP Central Services) previews all of them at once — allowedVbus has every one, vbu is null (no single unambiguous value to show)', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP', { allowedVbuIds: ['VBU - SSP Operations', 'VBU - SSP Consolidated'] })
  const baseAccess = { role: 'admin', allowedPages: ['dashboard'], canWrite: true, isBootstrapAdmin: false }
  const preview = dashboardViews.applyLocalAdminPreview('SSP', baseAccess)
  assert.equal(preview.vbu, null)
  assert.deepEqual(preview.allowedVbus.sort(), ['VBU - SSP Consolidated', 'VBU - SSP Operations'])
  assert.equal(preview.isPreviewingVbu, true)
  assert.equal(preview.canWrite, true, 'RBAC is never touched by a multi-VBU preview either')
})

test('applyLocalAdminPreview: an unknown or inactive view id returns null (caller falls back to normal resolution)', () => {
  dashboardViews.seedDefaultDashboardViews()
  const baseAccess = { role: 'admin', allowedPages: ['dashboard'], canWrite: true, isBootstrapAdmin: false }
  assert.equal(dashboardViews.applyLocalAdminPreview('NOT_A_REAL_VIEW', baseAccess), null)
  dashboardViewsRepo.updateView('SSP_WORLDWIDE', { isActive: false })
  assert.equal(dashboardViews.applyLocalAdminPreview('SSP_WORLDWIDE', baseAccess), null)
})

test('VBU resolves to the correct view for each of the three initial views, purely from allowedVbuIds', () => {
  dashboardViews.seedDefaultDashboardViews()
  assignVbuToView('SSP Worldwide', 'SSP_WORLDWIDE')
  assignVbuToView('SSP UK & I', 'SSP_UK_I')

  assert.equal(dashboardViews.resolveDashboardView('SSP Worldwide').id, 'SSP_WORLDWIDE')
  assert.equal(dashboardViews.resolveDashboardView('SSP UK & I').id, 'SSP_UK_I')
  // A VBU claimed by no view's allowedVbuIds falls back to the built-in SSP
  // view — the "Current SSP Dashboard" experience the spec establishes as
  // the default.
  assert.equal(dashboardViews.resolveDashboardView('Some Other VBU').id, 'SSP')
  assert.equal(dashboardViews.resolveDashboardView(null).id, 'SSP')
})

test('an unknown/unmapped VBU has a safe fallback — never throws, never returns no view', () => {
  dashboardViews.seedDefaultDashboardViews()
  const view = dashboardViews.resolveDashboardView('Totally Unknown VBU')
  assert.equal(view.id, 'SSP')
})

test('a deactivated view is never resolved, even if its allowedVbuIds still claims the VBU — falls back to the default SSP view', () => {
  dashboardViews.seedDefaultDashboardViews()
  const { view: custom } = dashboardViewsRepo.createView({ displayName: 'Custom View', pages: ['dashboard'], allowedVbuIds: ['Deactivated VBU'] })
  dashboardViewsRepo.updateView(custom.id, { isActive: false })
  assert.equal(dashboardViews.resolveDashboardView('Deactivated VBU').id, 'SSP')
})

test('missing configuration entirely (no seeded views at all) falls back to the hardcoded in-code default, never throws, never grants nothing', () => {
  // dashboard_views is empty here (beforeEach clears it, and this test
  // never calls seedDefaultDashboardViews) — simulates a corrupt/fresh DB.
  const view = dashboardViews.resolveDashboardView('Anything')
  assert.equal(view.id, 'SSP')
  assert.ok(Array.isArray(view.pages) && view.pages.length > 0, 'the hardcoded fallback must still grant a real, non-empty page list')
})

test('logo and theme resolve from the resolved view\'s own configuration', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP_UK_I', { logoKey: 'ssp_uk_i', theme: { accent: '#ff0000' } })
  assignVbuToView('SSP UK & I', 'SSP_UK_I')
  const publicConfig = dashboardViews.toPublicViewConfig(dashboardViews.resolveDashboardView('SSP UK & I'))
  assert.equal(publicConfig.logoKey, 'ssp_uk_i')
  assert.deepEqual(publicConfig.theme, { accent: '#ff0000' })
})

// ---- Bug 1 regression: the old two-mechanism split (a separate
// vbu_view_assignments table for branding vs. allowedVbuIds for data scope)
// ----

test('BUG 1 regression: configuring a view\'s allowedVbuIds (the ONLY thing the admin UI exposes now) is sufficient on its own for that VBU\'s users to resolve to it — no separate "assignment" step exists or is needed', () => {
  dashboardViews.seedDefaultDashboardViews()
  // This is deliberately the ONLY configuration step — exactly what an
  // administrator does through the "VBU Data" checkboxes in AdminDashboardViews.jsx.
  dashboardViewsRepo.updateView('SSP_UK_I', { allowedVbuIds: ['VBU - SSP Consolidated'] })
  const resolved = dashboardViews.resolveDashboardView('VBU - SSP Consolidated')
  assert.equal(resolved.id, 'SSP_UK_I', 'configuring allowedVbuIds alone must be enough for branding resolution to pick up the new VBU — this is the exact bug: previously a separate vbu_view_assignments row was ALSO required')
})

test('migrateVbuAssignmentsIntoAllowedVbuIds merges a pre-existing legacy assignment into its view\'s allowedVbuIds, additively and idempotently', () => {
  dashboardViews.seedDefaultDashboardViews()
  vbuViewAssignmentsRepo.createAssignment({ vbu: 'VBU - Legacy Assigned', dashboardViewId: 'SSP_UK_I' })
  assert.equal(dashboardViewsRepo.getView('SSP_UK_I').allowedVbuIds.length, 0, 'sanity check: the legacy assignment alone does not yet touch allowedVbuIds')

  dashboardViews.migrateVbuAssignmentsIntoAllowedVbuIds()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_UK_I').allowedVbuIds, ['VBU - Legacy Assigned'])
  assert.equal(dashboardViews.resolveDashboardView('VBU - Legacy Assigned').id, 'SSP_UK_I')

  // Idempotent: running it again must not duplicate the entry.
  dashboardViews.migrateVbuAssignmentsIntoAllowedVbuIds()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_UK_I').allowedVbuIds, ['VBU - Legacy Assigned'])
})

test('migrateVbuAssignmentsIntoAllowedVbuIds never removes a VBU an administrator already configured directly on a different view', () => {
  dashboardViews.seedDefaultDashboardViews()
  dashboardViewsRepo.updateView('SSP_WORLDWIDE', { allowedVbuIds: ['VBU - Already Configured'] })
  dashboardViews.migrateVbuAssignmentsIntoAllowedVbuIds()
  assert.deepEqual(dashboardViewsRepo.getView('SSP_WORLDWIDE').allowedVbuIds, ['VBU - Already Configured'])
})

// Discovered live against the real production database while building this
// fix: SSP Central Services (the default/fallback view) already has its
// OWN allowedVbuIds configured with several VBUs — including ones ALSO
// claimed by SSP UK & Ireland/Worldwide — purely to give the admin
// catch-all view a broader business-data aggregate. If resolveDashboardView
// searched every active view (default included) it would pick whichever
// view sorts first (built-ins alphabetically: "SSP Central Services" sorts
// before "SSP UK & Ireland"/"SSP Worldwide"), silently rerouting real UK &
// Ireland/Worldwide users' BRANDING to Central Services the moment an
// administrator broadened its data-scope checkboxes — a real regression
// this exact live-data shape would have caused.
test('the DEFAULT view (SSP Central Services) never wins a branding claim over a more specific view, even when its OWN allowedVbuIds also includes that VBU (configured for a broader data-scope aggregate, not a branding claim)', () => {
  dashboardViews.seedDefaultDashboardViews()
  assignVbuToView('VBU - SSP UK & Ireland', 'SSP_UK_I')
  assignVbuToView('VBU - SSP Worldwide', 'SSP_WORLDWIDE')
  // The admin catch-all view is ALSO configured with these same two VBUs,
  // for its own broader aggregate — exactly the real, live database shape.
  dashboardViewsRepo.updateView('SSP', { allowedVbuIds: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide', 'VBU - Some Other VBU'] })

  assert.equal(dashboardViews.resolveDashboardView('VBU - SSP UK & Ireland').id, 'SSP_UK_I', 'a real UK & Ireland user must still see UK & Ireland branding, not Central Services')
  assert.equal(dashboardViews.resolveDashboardView('VBU - SSP Worldwide').id, 'SSP_WORLDWIDE', 'a real Worldwide user must still see Worldwide branding, not Central Services')
  // A VBU claimed ONLY by the default view (never by a more specific one)
  // still correctly resolves to it.
  assert.equal(dashboardViews.resolveDashboardView('VBU - Some Other VBU').id, 'SSP')
})

test('toPublicViewConfig never exposes dashboard_json (not yet consumed client-side)', () => {
  dashboardViews.seedDefaultDashboardViews()
  const publicConfig = dashboardViews.toPublicViewConfig(dashboardViewsRepo.getView('SSP'))
  assert.equal(publicConfig.dashboard, undefined)
})

test('effectivePages is the intersection of RBAC allowedPages and the view\'s pages — a view can only narrow, never widen, RBAC', () => {
  const view = { pages: ['dashboard', 'users'] }
  // RBAC broader than the view -> narrowed down to the view's own list.
  assert.deepEqual(dashboardViews.effectivePages(['dashboard', 'users', 'cost'], view).sort(), ['dashboard', 'users'])
  // View broader than RBAC -> RBAC still wins; the view never grants 'cost'.
  const broadView = { pages: ['dashboard', 'users', 'cost'] }
  assert.deepEqual(dashboardViews.effectivePages(['dashboard'], broadView), ['dashboard'])
})

test('RBAC with zero allowed pages stays empty regardless of how broad the view is', () => {
  const view = { pages: ['dashboard', 'users', 'cost', 'optimization'] }
  assert.deepEqual(dashboardViews.effectivePages([], view), [])
})

test('an adminOnly page key present in RBAC allowedPages always survives, even if the resolved view\'s page list omits it — an admin can never be locked out of Administration by a Dashboard View edit', () => {
  // A view whose page list was edited to exclude Administration entirely.
  const strippedView = { pages: ['dashboard', 'users'] }
  const result = dashboardViews.effectivePages(['dashboard', 'admin-access', 'admin-dashboard-views'], strippedView)
  assert.ok(result.includes('admin-access'), 'admin-access must survive regardless of the view')
  assert.ok(result.includes('admin-dashboard-views'), 'admin-dashboard-views must survive regardless of the view')
  assert.ok(result.includes('dashboard'), 'ordinary pages the view DOES allow still come through too')
})

test('an adminOnly key never appears unless RBAC itself already granted it — this cannot be used to grant admin access', () => {
  // RBAC never granted 'admin-access' here — a broad view listing it must
  // not manufacture access RBAC didn't decide.
  const broadView = { pages: ['dashboard', 'admin-access'] }
  const result = dashboardViews.effectivePages(['dashboard'], broadView)
  assert.ok(!result.includes('admin-access'), 'a view can never grant an adminOnly page RBAC did not already allow')
})
