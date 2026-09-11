// Regression coverage for "Overview shows 342 Total Users, Users page shows
// 372 — these numbers must not be different, and dashboard users must not
// include Microsoft/Azure directory users with no tracked license/product
// relationship." Root cause: src/App.jsx built its shared `canonicalUsers`
// with { includeUnassignedMicrosoftUsers: true } (seeding all 372 Microsoft
// directory users regardless of product/license), while Overview.jsx and
// Header.jsx independently read summary.totalUsers — a completely separate,
// un-seeded, non-canonicalizing count from src/utils/calculations.js. Users
// page (fed by the seeded canonicalUsers) and Overview (fed by
// calculateSummary) could never agree, and neither reflected the intended
// business rule.
//
// THE BUSINESS RULE this locks in: a "Total User" = a canonical Microsoft
// user with at least one tracked product/license relationship in the
// dashboard (Microsoft Copilot, Microsoft licenses, GitHub Copilot, Kiro,
// Claude, Freshservice). Microsoft 365 remains the authoritative *directory*
// (companyName = SSP) — see server/repositories/microsoftRepo.js#isSspCompany,
// untouched by this fix — but the directory population and the dashboard
// population are two different concepts: a directory user with zero tracked
// relationships is not part of the dashboard population.
//
// THE ARCHITECTURE RULE this locks in: there must be exactly ONE shared
// population — src/App.jsx's `canonicalUsers` (built via
// buildCanonicalUsers(allRecords, microsoftDirectoryMap), no seeding option)
// — consumed identically by Users.jsx, Overview.jsx and Header.jsx. Neither
// Overview nor Header may compute their own independent user count
// (summary.totalUsers or otherwise). The source-level guard tests below
// exist because this codebase has no component-render test harness, so this
// is the enforceable equivalent of "assert these files derive their user
// count from the same value."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildCanonicalUsers, buildMicrosoftDirectory } from '../../../src/utils/userModel.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../')
const appJsx = fs.readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8')
const overviewJsx = fs.readFileSync(path.join(repoRoot, 'src/pages/Overview.jsx'), 'utf8')
const headerJsx = fs.readFileSync(path.join(repoRoot, 'src/components/Header.jsx'), 'utf8')

function msUser({ upn, mail, name }) {
  return { upn, mail, display_name: name, account_enabled: true }
}

// ---- Business rule: population contract over buildCanonicalUsers ----

test('a Microsoft directory user with no tracked product/license relationship is excluded from the Dashboard User Population', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'tracked@ssp-worldwide.com', mail: 'tracked@ssp-worldwide.com', name: 'Tracked Person' }),
    msUser({ upn: 'untracked@ssp-worldwide.com', mail: 'untracked@ssp-worldwide.com', name: 'Untracked Person' })
  ])
  const records = [{ email: 'tracked@ssp-worldwide.com', product: 'Kiro', _source: 'kiro' }]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1, 'the directory-only user with zero tracked relationships must not appear')
  assert.equal(users[0].name, 'Tracked Person')
})

test('a user with at least one tracked relationship from ANY supported provider qualifies for the Dashboard User Population', () => {
  const providers = ['Microsoft Copilot', 'Freshservice', 'GitHub Copilot', 'Kiro', 'Claude']
  for (const product of providers) {
    const directory = buildMicrosoftDirectory([msUser({ upn: 'p@ssp-worldwide.com', mail: 'p@ssp-worldwide.com', name: 'Person' })])
    const users = buildCanonicalUsers([{ email: 'p@ssp-worldwide.com', product, _source: product.toLowerCase() }], directory)
    assert.equal(users.length, 1, `${product} relationship must qualify the user`)
  }
})

test('a user is NOT counted merely for existing in Microsoft Graph, having a directory record, a VBU, or a name/email — only a real product/license relationship qualifies them', () => {
  const directory = buildMicrosoftDirectory([
    { upn: 'noproduct@ssp-worldwide.com', mail: 'noproduct@ssp-worldwide.com', display_name: 'No Product Person', account_enabled: true, vbu: 'UKI' }
  ])
  const users = buildCanonicalUsers([], directory)
  assert.equal(users.length, 0, 'zero product records means zero dashboard users, regardless of directory/VBU presence')
})

test('the default (no options) call — what App.jsx must use — never seeds unassigned Microsoft users; the opt-in flag is a separate, deliberately unused capability at this call site', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'has@ssp-worldwide.com', mail: 'has@ssp-worldwide.com', name: 'Has Product' }),
    msUser({ upn: 'has-not@ssp-worldwide.com', mail: 'has-not@ssp-worldwide.com', name: 'Has Not' })
  ])
  const records = [{ email: 'has@ssp-worldwide.com', product: 'Claude', _source: 'claude' }]
  assert.equal(buildCanonicalUsers(records, directory).length, 1, 'default/no-options call is record-driven — this is the Dashboard User Population')
  assert.equal(
    buildCanonicalUsers(records, directory, { includeUnassignedMicrosoftUsers: true }).length, 2,
    'the opt-in flag still exists and still works in isolation — it is simply not invoked by App.jsx anymore'
  )
})

test('a license-less Microsoft user is never accidentally treated as licensed: zero products means zero licenses, zero spend, and a non-fabricated usage_status', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'x@ssp-worldwide.com', mail: 'x@ssp-worldwide.com', name: 'X' })])
  const seeded = buildCanonicalUsers([], directory, { includeUnassignedMicrosoftUsers: true })
  assert.equal(seeded.length, 1)
  assert.deepEqual(seeded[0].products, [])
  assert.equal(seeded[0].totalLicenses, 0)
  assert.equal(seeded[0].totalSpend, null)
  assert.notEqual(seeded[0].usage_status, 'No Usage', 'never fabricate a measured-zero claim for someone who was never measured')
})

// ---- Architecture guard: Overview/Header must consume the SAME shared
// population as Users.jsx, never their own independent count. These read
// the actual source files rather than rendering components (no component
// test harness exists in this codebase) — this is the enforceable
// equivalent of "Overview and Users must match by construction, not by
// coincidence."

test('App.jsx builds canonicalUsers WITHOUT includeUnassignedMicrosoftUsers — the shared Dashboard User Population is record-driven', () => {
  const match = appJsx.match(/const canonicalUsers = useMemo\(\(\) => buildCanonicalUsers\(([^)]*)\)/)
  assert.ok(match, 'expected to find the canonicalUsers useMemo call in src/App.jsx')
  assert.doesNotMatch(match[1], /includeUnassignedMicrosoftUsers\s*:\s*true/,
    'App.jsx must not seed zero-product Microsoft users into the shared population — that reintroduces the 372-vs-342 regression')
})

test('App.jsx passes the SAME filteredCanonicalUsers population to both Overview and Header (and Users, via its data prop)', () => {
  assert.match(appJsx, /<Overview[^>]*\bcanonicalUsers=\{filteredCanonicalUsers\}/s, 'Overview must receive the shared filtered canonical population')
  assert.match(appJsx, /<Users[^>]*\bdata=\{filteredCanonicalUsers\}/s, 'Users page must receive the shared filtered canonical population')
  assert.match(appJsx, /<Header[^>]*\buserCount=\{filteredCanonicalUsers\.length\}/s, 'Header must display the shared canonical population count, not summary.totalUsers')
})

test('Overview.jsx Total Users KPI reads the canonicalUsers prop, never summary.totalUsers', () => {
  const kpiLine = overviewJsx.split('\n').find((l) => l.includes('title="Total Users"'))
  assert.ok(kpiLine, 'expected to find the Total Users KpiCard in Overview.jsx')
  assert.doesNotMatch(kpiLine, /summary\.totalUsers/, 'Overview must not calculate its own independent user count from calculateSummary')
  assert.match(kpiLine, /canonicalUsers/, 'Overview Total Users must come from the shared canonicalUsers population')
})

test('Header.jsx user count reads the userCount prop, never summary.totalUsers', () => {
  const usersLine = headerJsx.split('\n').find((l) => l.includes('Users:'))
  assert.ok(usersLine, 'expected to find the header "Users:" line in Header.jsx')
  assert.doesNotMatch(usersLine, /summary\.totalUsers/, 'Header must not fall back to the independent calculateSummary count')
  assert.match(usersLine, /userCount/, 'Header user count must come from the shared canonical population, passed in as userCount')
})

test('no hardcoded user count (372, 342, or any other literal) was introduced in place of a real calculation', () => {
  for (const [label, src] of [['Overview.jsx', overviewJsx], ['Header.jsx', headerJsx]]) {
    assert.doesNotMatch(src, /\b(342|372)\b/, `${label} must not hardcode a specific user count`)
  }
})
