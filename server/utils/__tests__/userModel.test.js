// Regression coverage for the fix to "the canonical Users population is
// inflated past the real Microsoft 365 headcount" — root cause traced to
// buildCanonicalUsers grouping by each record's own raw email string, so
// the SAME real person (upn X, mail Y — a common, real SSP pattern) became
// TWO canonical users whenever two providers happened to report a
// different address form for them. Also covers the related "a provider
// must never silently increase the canonical user population" defense-in-
// depth gate (Part 1 of the fix this implements).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCanonicalUsers, buildMicrosoftDirectory } from '../../../src/utils/userModel.js'

function msUser({ upn, mail, name }) {
  return { upn, mail, display_name: name, account_enabled: true }
}

test('two records for the same real person using different address forms (upn vs mail) merge into ONE canonical user', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'rituj.shah@ssp-worldwide.com', mail: 'rituj.shah@ssp-uki.com', name: 'Rituj Shah' })
  ])
  const records = [
    { email: 'rituj.shah@ssp-worldwide.com', product: 'Microsoft Copilot', _source: 'microsoft' },
    { email: 'rituj.shah@ssp-uki.com', product: 'Freshservice', _source: 'freshservice' }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1, 'must be exactly one person, not two')
  assert.equal(users[0].name, 'Rituj Shah')
  assert.equal(users[0].products.length, 2, 'both product records must still be attached to the one person')
})

test('a record whose email matches no known Microsoft user is excluded from the canonical population (not silently promoted to a new person)', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'known@ssp-worldwide.com', mail: 'known@ssp-worldwide.com', name: 'Known Person' })
  ])
  const records = [
    { email: 'known@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' },
    { email: 'not-a-real-employee@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1, 'the unmatched record must not become its own canonical user')
  assert.equal(users[0].email, 'known@ssp-worldwide.com')
})

test('when the Microsoft directory is empty (not yet synced), grouping falls back to raw email — the app does not show zero users', () => {
  const records = [
    { email: 'someone@ssp-worldwide.com', product: 'Kiro', _source: 'kiro' },
    { email: 'someone-else@ssp-worldwide.com', product: 'Kiro', _source: 'kiro' }
  ]
  const users = buildCanonicalUsers(records, new Map())
  assert.equal(users.length, 2, 'ungated fallback must still group by raw email, not silently drop everyone')
})

test('duplicate records for the exact same raw email (no mail/upn split) still merge correctly — no regression to the common case', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'a@ssp-worldwide.com', mail: 'a@ssp-worldwide.com', name: 'A Person' })])
  const records = [
    { email: 'a@ssp-worldwide.com', product: 'Kiro', _source: 'kiro' },
    { email: 'A@SSP-WORLDWIDE.COM', product: 'Claude', _source: 'claude' }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1)
  assert.equal(users[0].products.length, 2)
})

test('the canonical email displayed for a merged person is the stable mail-preferred form, not whichever record happened to be seen first', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'x.y@ssp-worldwide.com', mail: 'x.y@ssp-uki.com', name: 'X Y' })
  ])
  // Freshservice record (using the upn form) is seen FIRST here.
  const records = [
    { email: 'x.y@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' },
    { email: 'x.y@ssp-uki.com', product: 'Microsoft Copilot', _source: 'microsoft' }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1)
  assert.equal(users[0].email, 'x.y@ssp-uki.com', 'must resolve to the mail-preferred canonical address, not the first-seen raw email')
})

// Regression coverage for a second, real bug found via live investigation
// against the actual running dashboard (not just source review): a person
// whose ONLY product is Freshservice (usageTrackingSupported: false —
// 'Not Tracked', never ranked in STATUS_RANK) was showing up as 'No Usage'
// on the dashboard's "Low / No Usage Users" widget. Root cause: the old
// `products.reduce((best,p) => STATUS_RANK[s] > STATUS_RANK[best] ? s :
// best, null)` never actually adopted 'Not Tracked' as `best` — comparing
// two unranked values (`STATUS_RANK['Not Tracked'] ?? -1` vs
// `STATUS_RANK[null] ?? -1`, both -1) is never `>`, so `best` silently
// stayed `null` through the whole reduce, and `bestStatus || 'No Usage'`
// then reported a false "measured, zero activity" claim for someone who
// was never usage-tracked at all.
test('a person whose ONLY product is Freshservice (not usage-tracked) shows usage_status "Not Tracked", never "No Usage"', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'fs.only@ssp-worldwide.com', mail: 'fs.only@ssp-worldwide.com', name: 'FS Only' })])
  const records = [{ email: 'fs.only@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' }]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1)
  assert.equal(users[0].usage_status, 'Not Tracked')
})

test('a person with Freshservice AND a real usage-tracked product with genuinely zero activity still shows the REAL "No Usage" status', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'both@ssp-worldwide.com', mail: 'both@ssp-worldwide.com', name: 'Both Products' })])
  const records = [
    { email: 'both@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' },
    { email: 'both@ssp-worldwide.com', product: 'Kiro', _source: 'kiro', activity_count: 0 }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1)
  assert.equal(users[0].usage_status, 'No Usage', 'Kiro genuinely has zero activity — that is a real, measured claim, unlike Freshservice')
})

test('a person with Freshservice AND a real usage-tracked product with real activity shows the real activity status, not dragged down by Freshservice', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'active@ssp-worldwide.com', mail: 'active@ssp-worldwide.com', name: 'Active Person' })])
  const records = [
    { email: 'active@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' },
    { email: 'active@ssp-worldwide.com', product: 'Kiro', _source: 'kiro', activity_count: 500 }
  ]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1)
  assert.equal(users[0].usage_status, 'Heavily Active')
})

// Regression coverage for "Total Users must represent the authoritative
// Microsoft 365 SSP population, not the union of product/license
// assignments" — a real SSP employee with zero connected products/
// licenses does not stop existing. This is OPT-IN
// (includeUnassignedMicrosoftUsers) rather than the default, because
// buildCanonicalUsers is also used to answer a narrower question at
// several other call sites ("of the records I handed you, who are the
// real people" — a single provider's own user count, a dedicated
// product page's lookup map) where seeding every Microsoft user would
// silently turn e.g. "how many people use Freshservice" into "the whole
// company," a different, wrong answer.
test('a Microsoft user with ZERO product records is absent by default (existing per-provider/per-page behavior unchanged)', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'has-product@ssp-worldwide.com', mail: 'has-product@ssp-worldwide.com', name: 'Has Product' }),
    msUser({ upn: 'no-product@ssp-worldwide.com', mail: 'no-product@ssp-worldwide.com', name: 'No Product' })
  ])
  const records = [{ email: 'has-product@ssp-worldwide.com', product: 'Kiro', _source: 'kiro' }]
  const users = buildCanonicalUsers(records, directory)
  assert.equal(users.length, 1, 'default behavior must stay record-driven — this is what per-provider counts rely on')
  assert.equal(users[0].name, 'Has Product')
})

test('with includeUnassignedMicrosoftUsers: true, EVERY Microsoft user is a canonical user, even with zero products', () => {
  const directory = buildMicrosoftDirectory([
    msUser({ upn: 'has-product@ssp-worldwide.com', mail: 'has-product@ssp-worldwide.com', name: 'Has Product' }),
    msUser({ upn: 'no-product@ssp-worldwide.com', mail: 'no-product@ssp-worldwide.com', name: 'No Product' })
  ])
  const records = [{ email: 'has-product@ssp-worldwide.com', product: 'Kiro', _source: 'kiro', activity_count: 10 }]
  const users = buildCanonicalUsers(records, directory, { includeUnassignedMicrosoftUsers: true })
  assert.equal(users.length, 2, '372 Microsoft SSP users must mean 372 canonical users, regardless of product assignment')

  const noProduct = users.find((u) => u.name === 'No Product')
  assert.ok(noProduct, 'the zero-product Microsoft user must still be present')
  assert.deepEqual(noProduct.products, [])
  assert.equal(noProduct.totalLicenses, 0)
  assert.equal(noProduct.totalSpend, null)
  // Never fabricated as 'No Usage' (a real "we measured, it was zero"
  // claim) — this person was never measured at all, same principle as a
  // capability-less product's own 'Not Tracked' status.
  assert.equal(noProduct.usage_status, 'Not Tracked')

  const hasProduct = users.find((u) => u.name === 'Has Product')
  assert.equal(hasProduct.products.length, 1)
})

test('with includeUnassignedMicrosoftUsers: true, a Freshservice-matched record still attaches to its seeded Microsoft person exactly once (no duplicate)', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'agent@ssp-worldwide.com', mail: 'agent@ssp-worldwide.com', name: 'Agent Person' })])
  const records = [{ email: 'agent@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' }]
  const users = buildCanonicalUsers(records, directory, { includeUnassignedMicrosoftUsers: true })
  assert.equal(users.length, 1, 'the seeded entry and the attached record must merge into ONE person, not two')
  assert.equal(users[0].products.length, 1)
  assert.equal(users[0].products[0].product, 'Freshservice')
})

test('with includeUnassignedMicrosoftUsers: true, an unmatched provider record (no real Microsoft user) still cannot create a new canonical user', () => {
  const directory = buildMicrosoftDirectory([msUser({ upn: 'real@ssp-worldwide.com', mail: 'real@ssp-worldwide.com', name: 'Real Person' })])
  const records = [
    { email: 'real@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' },
    { email: 'not-a-real-employee@ssp-worldwide.com', product: 'Freshservice', _source: 'freshservice' }
  ]
  const users = buildCanonicalUsers(records, directory, { includeUnassignedMicrosoftUsers: true })
  assert.equal(users.length, 1, 'only the one real Microsoft user — the unmatched Freshservice record must not add a second person')
  assert.equal(users[0].name, 'Real Person')
})
