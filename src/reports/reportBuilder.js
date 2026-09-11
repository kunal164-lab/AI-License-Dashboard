// Provider-agnostic report data model. Every function here operates purely
// on the normalized record shape (product/department/plan/usage_status/...)
// that every provider's normalizer already produces — there is no
// `if (provider === 'claude')` branching anywhere in this file. A metric is
// included only when at least one record actually carries it; nothing is
// ever fabricated to fill a gap.
import { describeFilters } from '../utils/tableFilters.js'
import { COLUMN_BY_KEY } from '../utils/columnRegistry.js'
import { providerForProduct } from '../utils/providerRegistry.js'
import { isLicenseActive } from '../utils/licenseStatus.js'

const ACTIVITY_METRICS = [
  { key: 'chats', label: 'Chats' },
  { key: 'messages', label: 'Messages' },
  { key: 'code_sessions', label: 'Code Sessions' },
  { key: 'file_edits', label: 'File Edits' },
  { key: 'pull_requests', label: 'Pull Requests' },
  { key: 'projects_created', label: 'Projects Created' },
  { key: 'projects_used', label: 'Projects Used' },
  { key: 'artifacts_created', label: 'Artifacts Created' },
  { key: 'claude_code_artifacts', label: 'Claude Code Artifacts' },
  { key: 'cowork_sessions', label: 'Cowork Sessions' },
  { key: 'cowork_messages', label: 'Cowork Messages' },
  { key: 'cowork_artifacts', label: 'Cowork Artifacts' }
]

function hasValue(v) {
  return v !== null && v !== undefined && v !== ''
}

// display_cost is the centralized cost engine's one authoritative figure
// per record (server/services/costEngine.js) — null (not 0) means "no cost
// data," never confused with "$0 of cost."
function spendFor(r) {
  return hasValue(r.display_cost) ? Number(r.display_cost) : null
}

// "Potential savings" candidates: LICENSE STATUS vs USAGE STATUS (src/utils/
// licenseStatus.js) — a license that's genuinely unassigned/inactive already
// costs nothing (costEngine.js's inactive_license cost_type), so it's never
// a "savings opportunity"; only a still-ACTIVE license with No Usage/Low
// Activity usage is. Matches src/utils/calculations.js and
// src/pages/Optimization.jsx's exact same definition, so this report's
// numbers never disagree with what those pages already show on screen.
function isSavingsCandidate(r) {
  return isLicenseActive(r) && (r.usage_status === 'No Usage' || r.usage_status === 'Low Activity')
}

function sumMoney(list) {
  const spends = list.map(spendFor).filter((v) => v !== null)
  return spends.length ? Math.round(spends.reduce((a, b) => a + b, 0) * 100) / 100 : null
}

// "Active"/"Utilization" in every breakdown table below mean LICENSE STATUS
// (is it currently assigned?) — the same vocabulary Overview/Products/Cost
// already use everywhere else in this app — never usage/activity. Real
// recorded usage is preserved separately in the `usage` column, so nothing
// is lost, it just isn't mislabeled as "Active" anymore.
function groupBreakdown(records, keyFn) {
  const groups = new Map()
  records.forEach((r) => {
    const k = keyFn(r) || 'Unknown'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  })
  return Array.from(groups.entries()).map(([name, list]) => {
    const users = new Set(list.map((r) => r.email || r._id)).size
    const licenses = list.length
    const activeLicenses = list.filter(isLicenseActive).length
    const utilization = licenses ? Math.round((activeLicenses / licenses) * 100) : null
    const spend = sumMoney(list)
    const usage = list.reduce((s, r) => s + (Number(r.activity_count) || 0), 0)
    return { name, users, licenses, activeLicenses, utilization, spend, usage }
  }).sort((a, b) => b.licenses - a.licenses)
}

export function buildExecutiveSummary(records, meta = {}) {
  const totalUsers = new Set(records.map((r) => r.email || r._id)).size
  const totalLicenses = records.length
  // LICENSE STATUS vs USAGE STATUS: "Active Licenses" means currently
  // assigned — never a proxy for "has recorded activity." Matches
  // calculations.js#calculateSummary's exact same definition.
  const activeLicenses = records.filter(isLicenseActive).length
  const unusedLicenses = totalLicenses - activeLicenses
  const utilization = totalLicenses ? Math.round((activeLicenses / totalLicenses) * 100) : null
  const totalSpend = sumMoney(records)
  const potentialSavings = sumMoney(records.filter(isSavingsCandidate))
  return {
    totalUsers, totalLicenses, activeLicenses, unusedLicenses, utilization, totalSpend, potentialSavings,
    connectedSources: meta.connectedCount ?? null
  }
}

export function buildProviderBreakdown(records) {
  return groupBreakdown(records, (r) => providerForProduct(r.product))
}

export function buildProductBreakdown(records) {
  const rows = groupBreakdown(records, (r) => r.product)
  return rows.map((row) => {
    const list = records.filter((r) => (r.product || 'Unknown') === row.name)
    const potentialSavings = sumMoney(list.filter(isSavingsCandidate))
    return { ...row, potentialSavings }
  })
}

export function buildDepartmentBreakdown(records) {
  return groupBreakdown(records, (r) => r.department)
}

export function buildVbuBreakdown(records) {
  return groupBreakdown(records, (r) => r.vbu)
}

// Domain is Microsoft 365's authoritative field (src/utils/userModel.js) by
// the time records reach here — never re-derived from the record's own
// email, which could disagree with Microsoft's real UPN-based domain for an
// edge case (e.g. a Claude account under a personal/alias email address).
export function buildDomainBreakdown(records) {
  return groupBreakdown(records, (r) => r.domain)
}

export function buildPlanBreakdown(records) {
  return groupBreakdown(records, (r) => (r.product ? `${r.product} — ${r.plan || 'Unknown'}` : null))
}

export function buildUserAnalysis(records, { topLimit = 10, candidateLimit = 20 } = {}) {
  const topUsers = [...records].sort((a, b) => (Number(b.activity_count) || 0) - (Number(a.activity_count) || 0)).slice(0, topLimit)
  // Optimization candidates are scoped to STILL-ACTIVE licenses only — a
  // genuinely unassigned/inactive license already costs nothing and isn't
  // an optimization candidate, it's already gone (isSavingsCandidate above).
  const lowUsage = records.filter(isSavingsCandidate)
    .sort((a, b) => (Number(a.activity_count) || 0) - (Number(b.activity_count) || 0)).slice(0, topLimit)
  const optimizationCandidates = records
    .filter(isSavingsCandidate)
    .map((r) => ({ ...r, potentialSaving: spendFor(r) }))
    .sort((a, b) => (b.potentialSaving || 0) - (a.potentialSaving || 0))
    .slice(0, candidateLimit)
  return { topUsers, lowUsage, optimizationCandidates }
}

export function buildActivitySummary(records) {
  return ACTIVITY_METRICS
    .map((m) => {
      const present = records.some((r) => hasValue(r[m.key]))
      if (!present) return null
      const total = records.reduce((s, r) => s + (Number(r[m.key]) || 0), 0)
      return { label: m.label, total }
    })
    .filter(Boolean)
}

// meta: { connectedCount, lastUpdated, sources: [{label, status, lastSync}] }
export function buildReportModel({ allRecords, filteredRecords, scope, filters, meta = {} }) {
  const dataset = scope === 'filtered' ? filteredRecords : allRecords
  return {
    title: 'AI License & Usage Report',
    scope,
    generatedAt: new Date().toISOString(),
    dataLastUpdated: meta.lastUpdated || null,
    sources: meta.sources || [],
    filtersApplied: scope === 'filtered' ? describeFilters(filters, COLUMN_BY_KEY) : [],
    rawFilters: scope === 'filtered' ? (filters || {}) : {},
    recordCount: dataset.length,
    executiveSummary: buildExecutiveSummary(dataset, meta),
    providerBreakdown: buildProviderBreakdown(dataset),
    productBreakdown: buildProductBreakdown(dataset),
    departmentBreakdown: buildDepartmentBreakdown(dataset),
    userAnalysis: buildUserAnalysis(dataset),
    activitySummary: buildActivitySummary(dataset),
    dataset
  }
}

// The Optimization page's own report — same underlying data, but scoped to
// only the optimization-relevant slice with no candidate-count cap.
export function buildOptimizationReportModel({ allRecords, filteredRecords, scope, filters, meta = {} }) {
  const dataset = scope === 'filtered' ? filteredRecords : allRecords
  // Scoped to STILL-ACTIVE licenses only (isLicenseActive) — an already
  // unassigned/inactive license isn't an optimization candidate, it's
  // already gone (matches Optimization.jsx's exact same unused/lowUsage
  // definitions, so this PDF never disagrees with the on-screen page).
  const unused = dataset.filter((r) => isLicenseActive(r) && r.usage_status === 'No Usage')
  const lowUsage = dataset.filter((r) => isLicenseActive(r) && r.usage_status === 'Low Activity')
  const candidates = [...unused, ...lowUsage]
    .map((r) => ({
      ...r,
      potentialSaving: spendFor(r),
      recommendation: r.usage_status === 'No Usage' ? 'Consider removal' : 'Review / Consider downgrade'
    }))
    .sort((a, b) => (b.potentialSaving || 0) - (a.potentialSaving || 0))
  const potentialSavings = sumMoney([...unused, ...lowUsage])
  return {
    title: 'AI License Optimization Report',
    scope,
    generatedAt: new Date().toISOString(),
    dataLastUpdated: meta.lastUpdated || null,
    sources: meta.sources || [],
    filtersApplied: scope === 'filtered' ? describeFilters(filters, COLUMN_BY_KEY) : [],
    rawFilters: scope === 'filtered' ? (filters || {}) : {},
    recordCount: dataset.length,
    totalLicenses: dataset.length,
    unusedLicenses: unused.length,
    lowUsageLicenses: lowUsage.length,
    highCostLowUsageCount: candidates.filter((c) => (c.potentialSaving || 0) > 0).length,
    potentialSavings,
    potentialSavingsAnnual: potentialSavings !== null ? Math.round(potentialSavings * 12 * 100) / 100 : null,
    candidates
  }
}

// The Cost page's own report — audit-oriented, so it adds VBU/domain/plan
// breakdowns and a low-usage cost split on top of the general model's
// provider/product/department breakdowns (reused as-is, never recomputed).
// Uses the SAME centralized cost fields (display_cost/cost_label/...)
// every other report/page already reads — no separate cost calculation.
// No separate "unused cost" line here: current license + No Usage is a
// potential-savings candidate, already covered by executiveSummary's
// potentialSavings (isSavingsCandidate above) — not its own obsolete
// "Unused License Cost" concept.
export function buildCostReportModel({ allRecords, filteredRecords, scope, filters, meta = {} }) {
  const dataset = scope === 'filtered' ? filteredRecords : allRecords
  const lowUsageCost = sumMoney(dataset.filter((r) => isLicenseActive(r) && r.usage_status === 'Low Activity'))
  return {
    title: 'Cost & License Audit Report',
    scope,
    generatedAt: new Date().toISOString(),
    dataLastUpdated: meta.lastUpdated || null,
    sources: meta.sources || [],
    filtersApplied: scope === 'filtered' ? describeFilters(filters, COLUMN_BY_KEY) : [],
    rawFilters: scope === 'filtered' ? (filters || {}) : {},
    recordCount: dataset.length,
    executiveSummary: buildExecutiveSummary(dataset, meta),
    lowUsageCost,
    providerBreakdown: buildProviderBreakdown(dataset),
    productBreakdown: buildProductBreakdown(dataset),
    departmentBreakdown: buildDepartmentBreakdown(dataset),
    vbuBreakdown: buildVbuBreakdown(dataset),
    domainBreakdown: buildDomainBreakdown(dataset),
    planBreakdown: buildPlanBreakdown(dataset),
    userAnalysis: buildUserAnalysis(dataset),
    activitySummary: buildActivitySummary(dataset),
    dataset
  }
}
