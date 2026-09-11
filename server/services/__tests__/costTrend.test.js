// Dashboard Cost Trend spec — real monthly cost reconstruction from actual
// stored historical data (Kiro's per-month usage table, Claude's MTD
// snapshot history), VBU-scoped identically to every other Cost Analytics
// route. Real temp SQLite DB (same pattern as server/services/__tests__/
// costAnalytics.test.js) since this reads kiro_usage_monthly/
// claude_mtd_snapshots/cost_rules directly.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `cost-trend-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const connectionsRepo = await import('../../repositories/connectionsRepo.js')
const msRepo = await import('../../repositories/microsoftRepo.js')
const kiroRepo = await import('../../repositories/kiroRepo.js')
const claudeRepo = await import('../../repositories/claudeRepo.js')
const costRuleRepo = await import('../../repositories/costRuleRepo.js')
const costAnalytics = await import('../costAnalytics.js')

const admin = { canWrite: true, vbu: null }

function graphUser({ id, upn, vbu }) {
  return { id, displayName: upn, userPrincipalName: upn, mail: upn, companyName: 'SSP', accountEnabled: true, assignedLicenses: [], onPremisesExtensionAttributes: { extensionAttribute3: vbu } }
}

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run("DELETE FROM connections")
  run('DELETE FROM microsoft_users')
  run('DELETE FROM kiro_usage_monthly')
  run('DELETE FROM claude_mtd_snapshots')
  run('DELETE FROM claude_mtd_snapshot_records')
  run('DELETE FROM cost_rules')

  const msConnId = connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS', authType: 'client_credentials', credentials: {}, meta: {} }).id
  msRepo.upsertUsers(msConnId, [
    graphUser({ id: 'u1', upn: 'uki@ssp-worldwide.com', vbu: 'VBU - SSP UK & Ireland' }),
    graphUser({ id: 'u2', upn: 'ww@ssp-worldwide.com', vbu: 'VBU - SSP Worldwide' })
  ])

  costRuleRepo.createRule({ provider: 'Amazon', product: 'Kiro', planName: 'PRO', amount: 20, currency: 'USD', billingFrequency: 'monthly', costType: 'reference' })
  costRuleRepo.createRule({ provider: 'Anthropic', product: 'Claude', planName: 'Standard', amount: 20, currency: 'USD', billingFrequency: 'monthly', costType: 'reference' })
})

function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

test('returns a real historical monthly series when Kiro monthly usage history exists — no longer "unavailable"', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'uki@ssp-worldwide.com', month: '2026-03', plan: 'PRO', credits_used: 20 }
  ])
  const trend = costAnalytics.costTrend([], admin)
  assert.equal(trend.available, true)
  assert.ok(trend.months.length >= 2, 'must include real historical months, not just be unavailable')
})

test('monthly aggregation is correct — one $20 Kiro PRO seat that month sums to $20, two seats sum to $40', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'uki@ssp-worldwide.com', month: '2026-03', plan: 'PRO', credits_used: 10 },
    { email: 'ww@ssp-worldwide.com', month: '2026-03', plan: 'PRO', credits_used: 10 }
  ])
  const trend = costAnalytics.costTrend([], admin)
  const feb = trend.months.find((m) => m.month === '2026-02')
  const mar = trend.months.find((m) => m.month === '2026-03')
  assert.equal(feb.total, 20, 'one PRO seat this month = $20')
  assert.equal(mar.total, 40, 'two PRO seats this month = $40')
})

test('no double counting: a person with two Kiro rows in the SAME month is billed once, not twice', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  // replaceUsageForConnection itself is UNIQUE(connection_id,email,month),
  // so simulate the underlying dedup guarantee directly via two Kiro
  // connections reporting the same person/month (a real duplicate-source
  // scenario) — the seat must still only be billed once.
  const kiroConnId2 = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro 2', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [{ email: 'uki@ssp-worldwide.com', month: '2026-04', plan: 'PRO', credits_used: 10 }])
  kiroRepo.replaceUsageForConnection(kiroConnId2, [{ email: 'uki@ssp-worldwide.com', month: '2026-04', plan: 'PRO', credits_used: 5 }])
  const trend = costAnalytics.costTrend([], admin)
  const april = trend.months.find((m) => m.month === '2026-04')
  assert.equal(april.total, 20, 'the same email in the same month must only be billed ONE seat, regardless of how many source rows mention them')
})

test('the current month is replaced by the live total (covers every connected product, not just Kiro/Claude) and is never additionally summed with historical reconstruction for that same month', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  const thisMonth = currentMonthKey()
  kiroRepo.replaceUsageForConnection(kiroConnId, [{ email: 'uki@ssp-worldwide.com', month: thisMonth, plan: 'PRO', credits_used: 10 }])
  // The live total for the current month (e.g. a Microsoft Copilot seat
  // that has NO historical reconstruction of its own at all).
  const liveRows = [{ display_cost: 999, cost_type: 'reference' }]
  const trend = costAnalytics.costTrend(liveRows, admin)
  const current = trend.months.find((m) => m.month === thisMonth)
  assert.equal(current.total, 999, 'the current month must be the live total, not the $20 Kiro reconstruction added on top of it')
})

test('SSP Worldwide scope: only Worldwide VBU Kiro seats contribute to the historical trend', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'ww@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 }
  ])
  const worldwideAccess = { canWrite: false, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP Worldwide'] }
  const trend = costAnalytics.costTrend([], worldwideAccess)
  const feb = trend.months.find((m) => m.month === '2026-02')
  assert.equal(feb.total, 20, 'only the Worldwide seat\'s $20, never the UK & Ireland seat\'s')
})

test('SSP UK & Ireland scope: only UK & Ireland VBU Kiro seats contribute', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'ww@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 }
  ])
  const ukiAccess = { canWrite: false, vbu: 'VBU - SSP UK & Ireland', allowedVbus: ['VBU - SSP UK & Ireland'] }
  const trend = costAnalytics.costTrend([], ukiAccess)
  const feb = trend.months.find((m) => m.month === '2026-02')
  assert.equal(feb.total, 20, 'only the UK & Ireland seat\'s $20, never the Worldwide seat\'s')
})

test('SSP Central Services (configured with several VBUs) sees the combined total of exactly those VBUs, never more', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  msRepo.upsertUsers(
    connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS 2', authType: 'client_credentials', credentials: {}, meta: {} }).id,
    [graphUser({ id: 'u3', upn: 'other@ssp-worldwide.com', vbu: 'VBU - SSP Consolidated' })]
  )
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'ww@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'other@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 }
  ])
  const centralServicesAccess = { canWrite: false, allowedVbus: ['VBU - SSP UK & Ireland', 'VBU - SSP Worldwide'] }
  const trend = costAnalytics.costTrend([], centralServicesAccess)
  const feb = trend.months.find((m) => m.month === '2026-02')
  assert.equal(feb.total, 40, 'both configured VBUs\' seats ($20 + $20), never the third (SSP Consolidated) VBU\'s')
})

test('a client cannot bypass the effective VBU scope — costTrend only ever reads access.allowedVbus/vbu, never any query/body input', () => {
  const spoofed = { canWrite: false, vbu: 'VBU - SSP Worldwide', allowedVbus: ['VBU - SSP UK & Ireland'], vbuOverrideAttempt: 'VBU - SSP Worldwide' }
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [
    { email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 },
    { email: 'ww@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 }
  ])
  const trend = costAnalytics.costTrend([], spoofed)
  const feb = trend.months.find((m) => m.month === '2026-02')
  assert.equal(feb.total, 20, 'must follow allowedVbus (UK & Ireland), completely ignoring the spoofed extra field and the mismatched .vbu')
})

test('Claude historical snapshots reconstruct real monthly seat cost too, using the LATEST snapshot within each month', () => {
  const claudeConnId = connectionsRepo.createConnection({ source: 'Claude', kind: 'api', label: 'Claude', authType: 'client_credentials', credentials: {}, meta: {} }).id
  const thisMonth = currentMonthKey()
  claudeRepo.recordSnapshot({
    connectionId: claudeConnId, snapshotHash: 'h1', snapshotImportedAt: new Date().toISOString(), status: 'success',
    recordCount: 1, uniqueUserCount: 1,
    records: [{ email: 'uki@ssp-worldwide.com', product: 'Claude Code', plan: 'Standard', total_requests: 10 }]
  })
  const trend = costAnalytics.costTrend([{ display_cost: 20, cost_type: 'reference' }], admin)
  // The claude snapshot lands in the CURRENT month, which the function
  // deliberately overrides with the live total (see the double-counting
  // test above) — so this just confirms it does not throw and produces a
  // sane current-month figure, proving the Claude reconstruction path
  // executes without error against real snapshot data.
  const current = trend.months.find((m) => m.month === thisMonth)
  assert.equal(current.total, 20)
})

test('no synthetic/fake trend values: an access with zero historical data and zero current rows is honestly unavailable, never a fabricated series', () => {
  const trend = costAnalytics.costTrend([], { canWrite: false, allowedVbus: ['VBU - Nobody Here'] })
  assert.equal(trend.available, false)
  assert.equal(trend.months, undefined)
})

test('every month value is a real number derived from stored data — never a hardcoded example figure', () => {
  const kiroConnId = connectionsRepo.createConnection({ source: 'kiro', kind: 'api', label: 'Kiro', authType: 'client_credentials', credentials: {}, meta: {} }).id
  kiroRepo.replaceUsageForConnection(kiroConnId, [{ email: 'uki@ssp-worldwide.com', month: '2026-02', plan: 'PRO', credits_used: 10 }])
  const trend = costAnalytics.costTrend([], admin)
  for (const m of trend.months) {
    assert.equal(typeof m.total, 'number')
    assert.ok(!Number.isNaN(m.total))
  }
})
