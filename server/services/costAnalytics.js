// Cost Analytics aggregation — the server-side engine behind every
// /api/cost/* analytics view (Overview, By Product, By Department, By VBU,
// By Domain, By User, By Plan, Potential Savings). Reuses the SAME pipeline
// already proven in /api/dashboard and /api/cost/summary — cost resolution
// (costEngine.js), shared-seat cost dedup, product/license identity merge
// (productModel.js) and canonical cross-source identity (userModel.js) —
// so a Claude Chat + Claude Code pair is still exactly one Claude seat/cost
// here, and Freshservice/Microsoft/Claude/Kiro/GitHub all participate
// identically. Nothing here recalculates cost; every figure comes from
// each record's own already-resolved display_cost/cost_type/usage_status.
import * as connectionsRepo from '../repositories/connectionsRepo.js'
import * as costRuleRepo from '../repositories/costRuleRepo.js'
import * as exchangeRateRepo from '../repositories/exchangeRateRepo.js'
import * as settingsRepo from '../repositories/settingsRepo.js'
import * as msRepo from '../repositories/microsoftRepo.js'
import * as kiroRepo from '../repositories/kiroRepo.js'
import * as claudeRepo from '../repositories/claudeRepo.js'
import { getAllEnrichedRecords } from './recordsPipeline.js'
import { resolveCostForRecords, consolidateSharedSeats, matchCostRule, monthlyEquivalentAmount, convert } from './costEngine.js'
import { mergeSeatGroupRecords } from '../../src/utils/productModel.js'
import { buildCanonicalUsers, buildMicrosoftDirectory } from '../../src/utils/userModel.js'
import { activityStatusFor } from '../../src/utils/activityScore.js'
import { isLicenseActive, licenseStatusLabel } from '../../src/utils/licenseStatus.js'
import { scopeCanonicalUsersByVbu, scopeRecordsByVbu } from '../auth/vbuScope.js'

function hasValue(v) { return v !== null && v !== undefined && v !== '' }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }
// LICENSE STATUS vs USAGE STATUS: "used"/"unused"/"low usage" only ever
// apply to a license that is itself currently active/assigned — an
// unassigned/inactive license is its own separate bucket (isInactive),
// never folded into "unused" (Part 11 of the spec this implements:
// "Unused License = license is active but has no meaningful usage").
function isInactive(r) { return !isLicenseActive(r) }
function isActive(r) { return isLicenseActive(r) && (r.usage_status === 'Active' || r.usage_status === 'Heavily Active') }
function isUnused(r) { return isLicenseActive(r) && r.usage_status === 'No Usage' }
function isLowUsage(r) { return isLicenseActive(r) && r.usage_status === 'Low Activity' }
function costOf(r) { return hasValue(r.display_cost) ? Number(r.display_cost) : 0 }
// A license correctly resolved to "not active, so no seat cost applies"
// (costEngine.js's inactive_license cost_type) is priced — intentionally
// zero — not missing pricing, same treatment as a shared_seat sibling.
function hasCost(r) { return hasValue(r.display_cost) || r.cost_type === 'inactive_license' }

// One full, cost-resolved, identity-merged pass over every connection —
// built once per request and shared by whichever view needs it. Cheap at
// this app's real data scale (hundreds of users/products), so there is no
// caching layer here (Part 43 of the spec this implements explicitly warns
// against over-engineering one) — this is the same amount of work
// /api/dashboard already does on every load.
//
// `access` (req.access, optional) is where real VBU data isolation is
// enforced for every Cost Analytics route AND GET /api/users/:id/detail in
// one place: a non-admin's canonicalUsers is scoped down to their own VBU
// (server/auth/vbuScope.js#scopeCanonicalUsersByVbu) before anything below
// (flattenForCost, aggregateBy, productDetail, vbuAnalytics, userList,
// userDetail, ...) ever sees it, so every one of those inherits correct
// scoping automatically — including userDetail(), where an out-of-VBU id
// now simply isn't in the array any more (the caller's existing 404 path,
// no separate ownership check needed). Fails CLOSED by default: omitting
// `access` (or passing one with no canWrite/vbu) yields an EMPTY
// canonicalUsers, never the full unscoped set — a future call site that
// forgets to pass req.access gets an obviously-broken empty response
// instead of a silent company-wide data leak. Every real route below
// always passes req.access.
export function buildCostDataset(access) {
  const connections = connectionsRepo.listConnections()
  const rules = costRuleRepo.listActiveRules()
  const exchangeRates = exchangeRateRepo.listRates()
  const appCurrency = settingsRepo.getCurrency()
  const flat = getAllEnrichedRecords()
  const costResolved = consolidateSharedSeats(resolveCostForRecords(flat, { rules, exchangeRates, appCurrency }))
  // Cost resolution above already read each record's raw license_status
  // (costEngine.js's isLicenseActive gate) — normalizing it into the clean
  // Active/Inactive/Unknown vocabulary here only affects display/grouping,
  // never cost. See src/utils/licenseStatus.js.
  const merged = mergeSeatGroupRecords(costResolved).map((r) => ({ ...r, usage_status: activityStatusFor(r), license_status: licenseStatusLabel(r) }))
  const microsoftDirectory = buildMicrosoftDirectory(msRepo.listAllUsers())
  const canonicalUsers = scopeCanonicalUsersByVbu(buildCanonicalUsers(merged, microsoftDirectory), access)
  const lastUpdated = connections.map((c) => c.lastSync).filter(Boolean).sort().slice(-1)[0] || null
  return { canonicalUsers, appCurrency, connections, lastUpdated }
}

// Flattens canonical users back into one row per (person, product) — the
// unit every grouping below aggregates over — but carrying the CANONICAL,
// Microsoft-365-EXCLUSIVE department/vbu/domain/manager/company/office/
// account_status/job_title (see userModel.js's AUTHORITATIVE_FIELDS) rather
// than that one product record's own value. This is exactly why a
// Claude-only record can still be correctly attributed to "IT" if Microsoft
// 365 is the source that actually knows this person's department — no other
// source (including Freshservice) is ever consulted for these fields.
export function flattenForCost(canonicalUsers) {
  const rows = []
  for (const u of canonicalUsers) {
    for (const p of u.products) {
      rows.push({
        ...p,
        user_id: u._id,
        user_name: u.name,
        user_email: u.email,
        role: u.role,
        job_title: u.job_title,
        department: u.department,
        vbu: u.vbu,
        manager: u.manager,
        company: u.company,
        office: u.office,
        domain: u.domain,
        account_status: u.account_status
      })
    }
  }
  return rows
}

// One row of aggregated cost/utilization stats for a group of (person,
// product) rows — the shared shape behind every Cost Analytics table
// (By Product/Department/VBU/Domain/Plan) so each view is a one-line call
// into this function with a different grouping key, never a re-implemented
// calculation.
function summarizeGroup(rows) {
  const users = new Set(rows.map((r) => r.user_email || r.user_id)).size
  const licenses = rows.length
  const withCost = rows.filter(hasCost)
  const activeRows = rows.filter(isActive)
  const unusedRows = rows.filter(isUnused)
  const lowUsageRows = rows.filter(isLowUsage)
  const inactiveRows = rows.filter(isInactive)
  const monthlyCost = withCost.reduce((s, r) => s + costOf(r), 0)
  const activeCost = activeRows.reduce((s, r) => s + costOf(r), 0)
  const unusedCost = unusedRows.reduce((s, r) => s + costOf(r), 0)
  const lowUsageCost = lowUsageRows.reduce((s, r) => s + costOf(r), 0)
  const potentialSavings = unusedCost + lowUsageCost
  return {
    users,
    licenses,
    // "activeLicenses" here means license_status active AND currently used
    // (Heavily Active/Active usage) — a license that's active but unused
    // lands in unusedLicenses/lowUsageLicenses instead, never double
    // counted. inactiveLicenses is the genuinely-not-assigned bucket,
    // tracked separately per Part 11 (never folded into "unused").
    activeLicenses: activeRows.length,
    unusedLicenses: unusedRows.length,
    lowUsageLicenses: lowUsageRows.length,
    inactiveLicenses: inactiveRows.length,
    monthlyCost: round2(monthlyCost),
    annualCost: round2(monthlyCost * 12),
    activeCost: round2(activeCost),
    unusedCost: round2(unusedCost),
    lowUsageCost: round2(lowUsageCost),
    potentialSavings: round2(potentialSavings),
    potentialAnnualSavings: round2(potentialSavings * 12),
    savingsPct: monthlyCost > 0 ? Math.round((potentialSavings / monthlyCost) * 100) : null,
    costCoveragePct: licenses ? Math.round((withCost.length / licenses) * 100) : null,
    missingPricingCount: licenses - withCost.length
  }
}

// Groups `rows` by keyFn (null/blank keys are dropped — never bucketed into
// a fabricated "Unknown" group for a dimension like domain/VBU where that
// would misrepresent real coverage), summarizes each group, and sorts by
// monthly cost descending (Part 9's "sort by monthly cost descending",
// applied consistently to every dimension). `describeFn`, if given, adds
// extra descriptive fields (e.g. provider/plan) taken from the group's
// first row.
export function aggregateBy(rows, keyFn, describeFn) {
  const groups = new Map()
  for (const r of rows) {
    const key = keyFn(r)
    if (!hasValue(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return Array.from(groups.entries())
    .map(([name, groupRows]) => ({
      name,
      ...(describeFn ? describeFn(groupRows[0], groupRows) : {}),
      ...summarizeGroup(groupRows)
    }))
    .sort((a, b) => b.monthlyCost - a.monthlyCost)
}

export function costOverview(rows, access) {
  const overall = summarizeGroup(rows)
  const byProduct = aggregateBy(rows, (r) => r.product, (first) => ({ provider: first.provider }))
  const byDepartment = aggregateBy(rows, (r) => r.department)
  const byVbu = aggregateBy(rows, (r) => r.vbu)
  const byDomain = aggregateBy(rows, (r) => r.domain)
  const byProvider = aggregateBy(rows, (r) => r.provider)
  return {
    kpis: overall,
    byProduct, byDepartment, byVbu, byDomain, byProvider,
    activeVsUnused: {
      active: overall.activeCost, unused: overall.unusedCost, lowUsage: overall.lowUsageCost
    },
    potentialSavingsByProduct: byProduct.filter((p) => p.potentialSavings > 0).map((p) => ({ name: p.name, value: p.potentialSavings })),
    trend: costTrend(rows, access)
  }
}

function normEmail(e) { return e ? String(e).trim().toLowerCase() : null }
function monthKeyFromIso(iso) { return iso ? String(iso).slice(0, 7) : null }
function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Reconstructs a REAL (never fabricated) per-month seat-based cost from a
// historical usage source that genuinely tracks per-month seat/plan data —
// Kiro's kiro_usage_monthly (a real `month` column) and Claude's MTD
// snapshots (bucketed to their own calendar month below). Priced at
// TODAY's configured cost_rule for that plan — the exact same seat-based
// pricing convention already used for the CURRENT month (costEngine.js's
// own comment: Claude/Kiro cost always comes from the configured
// cost_rule, never a usage-spend column) — there is no historical PRICE
// history to price it at instead, so this is a legitimate reconstruction
// of real historical seat-months at today's rate, not an invented number.
// `rows` is [{email, plan, month}]; deduped to one seat per (email,
// month) so a person's multiple capability rows in the same month/
// snapshot never bill twice (mirrors consolidateSharedSeats' own dedup
// principle).
function reconstructMonthlySeatCost(rows, product, rules, exchangeRates, appCurrency) {
  const seenPerMonth = new Map()
  const totals = new Map()
  for (const r of rows) {
    const email = normEmail(r.email)
    if (!email || !r.month) continue
    let seen = seenPerMonth.get(r.month)
    if (!seen) { seen = new Set(); seenPerMonth.set(r.month, seen) }
    if (seen.has(email)) continue
    seen.add(email)
    const rule = matchCostRule({ product, plan: r.plan }, rules)
    if (!rule || !hasValue(rule.amount)) continue
    const monthly = monthlyEquivalentAmount(rule)
    if (monthly === null) continue
    const conv = convert(monthly, rule.currency || 'USD', appCurrency, exchangeRates)
    totals.set(r.month, (totals.get(r.month) || 0) + conv.displayAmount)
  }
  return totals
}

// One {email, plan, month} row per (person, calendar month) that genuinely
// held a Claude seat that month — the LATEST snapshot within each month
// (the most complete "month to date" picture for that month, same "latest
// wins" rule claudeRepo.currentRecords() already applies overall, just
// per historical month here instead of once).
function buildClaudeMonthlySeatRows() {
  const claudeConnections = connectionsRepo.listConnections('Claude')
  const rows = []
  for (const conn of claudeConnections) {
    const snapshots = claudeRepo.listSnapshots(conn.id, 500).filter((s) => s.status === 'success' || s.status === 'unchanged')
    const latestSnapshotIdPerMonth = new Map()
    for (const snap of snapshots) {
      // listSnapshots orders newest-first (id DESC), so the first time a
      // given month is seen is already that month's latest snapshot.
      const month = monthKeyFromIso(snap.snapshot_imported_at)
      if (!month || latestSnapshotIdPerMonth.has(month)) continue
      latestSnapshotIdPerMonth.set(month, snap.id)
    }
    for (const [month, snapshotId] of latestSnapshotIdPerMonth.entries()) {
      for (const r of claudeRepo.recordsForSnapshot(snapshotId)) {
        rows.push({ email: r.user_email, plan: r.plan, month })
      }
    }
  }
  return rows
}

// Dashboard Cost Trend spec — a real monthly cost series built from actual
// stored historical data (Kiro's per-month usage table, Claude's MTD
// snapshot history), never synthetic/fake values. `rows` is the SAME
// already-scoped, already-cost-resolved flat dataset costOverview's own
// KPIs are built from — its already-computed current monthlyCost becomes
// the trend's most recent point (the one month covering EVERY connected
// product, not just Kiro/Claude), so the two can never disagree and are
// never double-counted (a month is either pure historical reconstruction
// OR the current live total, never both added together). `access` applies
// the SAME effective VBU scope as everywhere else (server/auth/
// vbuScope.js#scopeRecordsByVbu) — a client can never widen this by
// querying a different route or passing a different parameter, since
// scoping happens here, server-side, every time.
export function costTrend(rows, access) {
  const rules = costRuleRepo.listActiveRules()
  const exchangeRates = exchangeRateRepo.listRates()
  const appCurrency = settingsRepo.getCurrency()
  const directoryMap = buildMicrosoftDirectory(msRepo.listAllUsers())

  const kiroRows = scopeRecordsByVbu(kiroRepo.listAllUsage(), directoryMap, access)
  const claudeRows = scopeRecordsByVbu(buildClaudeMonthlySeatRows(), directoryMap, access)

  const monthlyTotals = new Map()
  for (const [month, amount] of reconstructMonthlySeatCost(kiroRows, 'Kiro', rules, exchangeRates, appCurrency)) {
    monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + amount)
  }
  for (const [month, amount] of reconstructMonthlySeatCost(claudeRows, 'Claude', rules, exchangeRates, appCurrency)) {
    monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + amount)
  }

  const hasHistory = monthlyTotals.size > 0
  if (!hasHistory && !rows.length) {
    return { available: false, message: 'Historical cost trend will appear as additional cost snapshots become available.' }
  }

  // The most recent month is always the full CURRENT total (every
  // connected product, including Microsoft 365/Freshservice/GitHub
  // Copilot, which have no historical monthly granularity of their own) —
  // replacing whatever partial Kiro/Claude-only reconstruction exists for
  // that same month, never adding to it.
  monthlyTotals.set(currentMonthKey(), round2(summarizeGroup(rows).monthlyCost))

  const months = Array.from(monthlyTotals.entries())
    .map(([month, total]) => ({ month, total: round2(total) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    available: true,
    months,
    currency: appCurrency,
    // Honest about partial coverage: Kiro and Claude are the only sources
    // with real per-month history today. Microsoft 365/Freshservice/
    // GitHub Copilot only ever have their CURRENT state, so any month
    // before the most recent one reflects Kiro/Claude seat costs only —
    // never silently presented as the full company-wide figure for that
    // past month.
    note: months.length > 1
      ? 'Earlier months reflect Kiro and Claude seat costs only (the only sources with real monthly history). The most recent month reflects the current total across all connected products.'
      : null
  }
}

export function productDetail(rows, productName) {
  const scoped = rows.filter((r) => r.product === productName)
  if (!scoped.length) return null
  return {
    summary: { name: productName, provider: scoped[0].provider, ...summarizeGroup(scoped) },
    rows: scoped,
    byPlan: aggregateBy(scoped, (r) => r.plan),
    byDepartment: aggregateBy(scoped, (r) => r.department),
    byVbu: aggregateBy(scoped, (r) => r.vbu),
    byDomain: aggregateBy(scoped, (r) => r.domain)
  }
}

function dimensionDetail(rows, key, value) {
  const scoped = rows.filter((r) => r[key] === value)
  if (!scoped.length) return null
  return {
    summary: { name: value, ...summarizeGroup(scoped) },
    rows: scoped,
    byProduct: aggregateBy(scoped, (r) => r.product, (first) => ({ provider: first.provider })),
    byProvider: aggregateBy(scoped, (r) => r.provider),
    byPlan: aggregateBy(scoped, (r) => r.plan)
  }
}

export function departmentDetail(rows, name) { return dimensionDetail(rows, 'department', name) }
export function vbuDetail(rows, name) { return dimensionDetail(rows, 'vbu', name) }
export function domainDetail(rows, name) { return dimensionDetail(rows, 'domain', name) }

// Cost by VBU dashboard (GET /api/cost/by-vbu) — a richer, combinable-filter
// version of vbuDetail() above for the dedicated Cost -> By VBU analytics
// view. `vbu` is Microsoft 365's authoritative field on every row already
// (flattenForCost — never Freshservice/Kiro/Claude/GitHub, never a
// fallback); this function only ever groups/filters by whatever's already
// on the row, it never re-derives or re-prioritizes a value.
const VBU_ANALYTICS_FILTER_FIELDS = {
  department: 'department', provider: 'provider', product: 'product', plan: 'plan',
  domain: 'domain', usageStatus: 'usage_status', licenseStatus: 'license_status', user: 'user_email'
}
// A filter value may be a single value or a comma-joined list (e.g. clicking
// the "Active License Cost" KPI needs "Active,Heavily Active" — usage_status
// has more granular real values than the simple active/unused/low-usage
// grouping, so a single exact match can't express it).
function applyRowFilters(rows, filters) {
  let scoped = rows
  for (const [param, field] of Object.entries(VBU_ANALYTICS_FILTER_FIELDS)) {
    const raw = filters?.[param]
    if (!raw) continue
    const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean)
    scoped = scoped.filter((r) => values.includes(r[field]))
  }
  return scoped
}

// `filters.vbu` is deliberately excluded from `scopedExceptVbu` — the four
// VBU-comparison charts (Cost/License Count/Active-vs-Unused/Potential
// Savings "by VBU") always compare ACROSS every VBU so a user can click a
// different bar to switch, while still respecting every OTHER active filter
// (department/provider/product/etc). `scoped` additionally applies the vbu
// filter itself — used for the KPI row, the "within selected VBU"
// department/product breakdowns, and the detail table.
export function vbuAnalytics(rows, filters = {}) {
  const scopedExceptVbu = applyRowFilters(rows, filters)
  const scoped = filters?.vbu ? scopedExceptVbu.filter((r) => r.vbu === filters.vbu) : scopedExceptVbu
  // annual_cost/potential_monthly_savings are pure display derivations of
  // this SAME row's already-resolved display_cost/usage_status/license_status
  // (annualizing = ×12 per Part 11 of the spec; "potential savings" reuses
  // the exact isUnused/isLowUsage/costOf helpers every other Cost Analytics
  // KPI already uses) — never a new pricing decision, computed here once so
  // the client (detail table + exports) never re-implements this logic.
  const rowsWithDerived = scoped.map((r) => ({
    ...r,
    annual_cost: hasValue(r.display_cost) ? round2(Number(r.display_cost) * 12) : null,
    potential_monthly_savings: (isUnused(r) || isLowUsage(r)) ? round2(costOf(r)) : 0
  }))
  return {
    summary: { name: filters?.vbu || null, ...summarizeGroup(scoped) },
    byVbu: aggregateBy(scopedExceptVbu, (r) => r.vbu),
    byDepartment: aggregateBy(scoped, (r) => r.department),
    byProduct: aggregateBy(scoped, (r) => r.product, (first) => ({ provider: first.provider })),
    rows: rowsWithDerived
  }
}

export function planList(rows) {
  return aggregateBy(rows, (r) => `${r.product}::${r.plan || ''}`, (first) => ({
    provider: first.provider, product: first.product, plan: first.plan || null,
    costType: first.cost_type, costLabel: first.cost_label
  }))
}

// Cost by User (Part 13) — one row per canonical person, reusing the exact
// figures buildCanonicalUsers already computed (totalSpend/totalLicenses),
// plus the active/unused/low-usage split from that person's own products.
export function userList(canonicalUsers) {
  return canonicalUsers.map((u) => {
    const activeLicenses = u.products.filter(isActive).length
    const unusedLicenses = u.products.filter(isUnused).length
    const lowUsageLicenses = u.products.filter(isLowUsage).length
    const unusedCost = u.products.filter(isUnused).reduce((s, p) => s + costOf(p), 0)
    const lowUsageCost = u.products.filter(isLowUsage).reduce((s, p) => s + costOf(p), 0)
    const potentialSavings = round2(unusedCost + lowUsageCost)
    return {
      id: u._id, name: u.name, email: u.email, department: u.department, vbu: u.vbu,
      domain: u.domain, role: u.role, job_title: u.job_title, manager: u.manager,
      company: u.company, office: u.office, account_status: u.account_status,
      products: u.product, provider: u.provider,
      licenses: u.totalLicenses, activeLicenses, unusedLicenses, lowUsageLicenses,
      monthlyCost: u.totalSpend, annualCost: u.totalSpend !== null ? round2(u.totalSpend * 12) : null,
      potentialSavings, usage_status: u.usage_status
    }
  }).sort((a, b) => (b.monthlyCost || 0) - (a.monthlyCost || 0))
}

export function userDetail(canonicalUsers, id) {
  const key = String(id || '').toLowerCase()
  return canonicalUsers.find((u) => (u.email || '').toLowerCase() === key || u._id === id) || null
}

// Groups (Part 15 of the spec) — Microsoft Graph groups are synced
// (microsoft_groups) but WITHOUT membership data (no join table linking a
// group to its member users' license cost currently exists), so an honest
// "not available" is returned rather than a group list with no real
// members/cost behind it. This is a genuine data-availability gap, not a
// missing feature to patch around.
export function groupsAvailability() {
  const groups = msRepo.listAllGroups()
  return {
    available: false,
    groupCount: groups.length,
    message: 'Group cost analysis is unavailable because no group membership data is currently connected.'
  }
}
