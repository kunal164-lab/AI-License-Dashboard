// THE single, centralized cost calculation layer. Every page (Overview,
// Products, Users, Optimization, Reports) reads whatever this attaches to
// a record — nothing re-derives spend on its own. Applied once, read-time
// only, in server/index.js's /api/dashboard route, over every record from
// every connection (Microsoft Copilot's own SKU/service-plan enrichment in
// copilotEnrichment.js runs first and is untouched by this file; this is a
// separate, provider-agnostic pass that runs afterward for everyone).
import { providerForProduct, seatGroupForProduct } from '../../src/utils/providerRegistry.js'
import { isLicenseActive } from '../../src/utils/licenseStatus.js'

export const COST_TYPE_LABELS = {
  source_provided: 'From Source Data',
  reference: 'Reference / List Price',
  configured: 'Admin-Configured Price',
  actual_contract: 'Actual Contract Price',
  actual_billing: 'Actual Billing Cost',
  shared_seat: 'Same Seat (billed once)',
  plan_conflict: 'Plan Conflict — Investigate',
  inactive_license: 'Inactive License (No Seat Cost)',
  unavailable: 'N/A'
}

// Billing frequencies with an unambiguous recurring time period — these
// can be safely normalized into a monthly-equivalent figure for the
// Monthly/Annualized Spend KPIs. One-time/per-transaction/usage-based
// amounts are NOT a predictable recurring cost, so they are never forced
// into "monthly spend" - the rule stays visible/editable, it's simply
// excluded from spend aggregation rather than misrepresented.
const MONTHLY_EQUIVALENT = {
  monthly: (amount) => amount,
  per_user: (amount) => amount,
  per_device: (amount) => amount,
  per_license: (amount) => amount,
  per_seat: (amount) => amount,
  annual: (amount) => amount / 12,
  quarterly: (amount) => amount / 3
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== ''
}

// Plan values from different sources sometimes repeat the product name
// (e.g. a CSV column reading "Claude Standard" instead of just "Standard").
// This strips exactly that redundant "<Product> " prefix (case-insensitive,
// exact prefix only) before comparing — still an exact-string match on the
// normalized value, never fuzzy/similarity matching, and the record's own
// original `plan` value is never altered, only compared.
function normalizedPlanKey(product, plan) {
  if (!hasValue(plan)) return null
  const raw = String(plan).trim()
  const prefix = `${product} `.toLowerCase()
  const normalized = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length).trim() : raw
  return normalized.toLowerCase()
}

// Exact matching only (never fuzzy): SKU ID -> SKU -> product+plan ->
// product-level default (a rule with no plan/sku, scoped to just the
// product) -> no match. Matches on `product` alone, NOT provider: `provider`
// on a cost_rules row is free text an admin typed for display/grouping —
// it isn't guaranteed to equal providerForProduct()'s internal canonical
// string (e.g. an admin-entered "Anthropic" vs. the registry's "Anthropic /
// Claude" for the same product), and requiring that exact match would
// silently fail to match a genuinely correct rule. Product names are
// already unique per product in this app's data model, so product alone is
// sufficient and unambiguous - this matches Part 2 of the spec, which
// only ever lists SKU/Plan/Product as match keys, never Provider.
//
// Matches against the record's CANONICAL SEAT-GROUP product
// (seatGroupForProduct — src/utils/providerRegistry.js), not its raw
// per-capability product name. This function runs BEFORE
// mergeSeatGroupRecords (needed pre-merge for shared-seat dedup and other
// providers), so a Claude record's own `product` is still "Claude Chat" /
// "Claude Code" / "Claude Cowork" / etc. at this point — a cost rule is
// always configured against the merged seat name ("Claude"), so matching
// on the raw per-capability name would never find it (a real, confirmed
// diagnostic finding: every Claude capability failed to match its
// correctly-configured Standard/Premium rule until this resolution was
// added). Provider-agnostic and generic: any product NOT listed in
// SEAT_GROUP_BY_PRODUCT (i.e. every other current provider) maps to
// itself, so this is a no-op for Microsoft Copilot/Kiro/GitHub/Freshservice.
export function matchCostRule(record, rules) {
  const productKey = seatGroupForProduct(record.product)
  const candidates = (rules || []).filter((r) => r.product === productKey && r.is_active)
  if (!candidates.length) return null

  if (hasValue(record.sku_id)) {
    const m = candidates.find((r) => hasValue(r.sku_id) && r.sku_id === record.sku_id)
    if (m) return m
  }
  const sku = record.sku_part_number || record.sku
  if (hasValue(sku)) {
    const m = candidates.find((r) => hasValue(r.sku) && r.sku === sku)
    if (m) return m
  }
  if (hasValue(record.plan)) {
    const recordPlanKey = normalizedPlanKey(productKey, record.plan)
    const m = candidates.find((r) => hasValue(r.plan_name) && !hasValue(r.sku) && !hasValue(r.sku_id) && normalizedPlanKey(r.product, r.plan_name) === recordPlanKey)
    // A record with a KNOWN plan must match that exact plan — it must
    // never silently fall back to a generic product-level default, which
    // could apply a different plan's price (e.g. a Premium user getting
    // the Standard rate just because no Premium-specific rule exists yet).
    return m || null
  }
  return candidates.find((r) => !hasValue(r.plan_name) && !hasValue(r.sku) && !hasValue(r.sku_id)) || null
}

// A literal 0 in a usage-metered field (e.g. Claude's per-user "Estimated
// Spend" — token/usage-based, not a seat price) means "no usage this
// period," not "this license genuinely costs nothing." Treating a real
// $0 reading as an authoritative cost would permanently hide a real,
// known per-seat/plan price (e.g. Claude Standard/Premium) behind a
// metering column that just happens to read zero for most people most
// periods. A genuinely non-zero source figure still takes priority, per
// the source-provided-cost-wins rule.
function sourceProvidedSpend(record) {
  const parts = [record.estimated_spend, record.monthly_license_cost]
    .filter(hasValue).map(Number).filter((n) => !Number.isNaN(n) && n !== 0)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

// exchangeRates: array of {base_currency, target_currency, rate, rate_date, source}
export function convert(amount, fromCurrency, toCurrency, exchangeRates) {
  if (!hasValue(amount) || !fromCurrency || !toCurrency || fromCurrency === toCurrency) {
    return { displayAmount: amount, displayCurrency: fromCurrency || toCurrency, exchangeRate: null, rateDate: null }
  }
  const match = (exchangeRates || []).find((r) => r.base_currency === fromCurrency && r.target_currency === toCurrency)
  if (!match) {
    // No configured rate - never fake a conversion. Show the ORIGINAL
    // currency/amount rather than a wrong number under the wrong symbol.
    return { displayAmount: amount, displayCurrency: fromCurrency, exchangeRate: null, rateDate: null }
  }
  return { displayAmount: Math.round(amount * match.rate * 100) / 100, displayCurrency: toCurrency, exchangeRate: match.rate, rateDate: match.rate_date }
}

// The real, monthly-equivalent amount for a matched cost_rule (Cost Trend
// spec — historical monthly cost reconstruction needs this SAME
// normalization applied to a past month's seat, not just the current
// one). Exported so a caller outside resolveCostFields (which already
// uses it internally, below) can price a rule without duplicating the
// billing-frequency normalization logic.
export function monthlyEquivalentAmount(rule) {
  const normalizer = MONTHLY_EQUIVALENT[rule?.billing_frequency]
  return normalizer ? normalizer(Number(rule.amount)) : null
}

// record: one normalized usage/license record (from any provider).
// options: { rules, exchangeRates, appCurrency }
export function resolveCost(record, options) {
  return { provider: providerForProduct(record.product), ...resolveCostFields(record, options) }
}

function resolveCostFields(record, { rules, exchangeRates, appCurrency }) {
  const sourceSpend = sourceProvidedSpend(record)
  if (sourceSpend !== null) {
    const conv = convert(sourceSpend, 'USD', appCurrency, exchangeRates)
    return {
      monthly_cost: sourceSpend,
      cost_type: 'source_provided',
      cost_label: COST_TYPE_LABELS.source_provided,
      cost_source: 'Source-provided usage cost (from the connection\'s own data)',
      cost_rule_id: null,
      currency: 'USD',
      billing_frequency: 'monthly',
      display_cost: conv.displayAmount,
      display_currency: conv.displayCurrency,
      exchange_rate: conv.exchangeRate,
      exchange_rate_date: conv.rateDate
    }
  }

  // License Status vs Usage Status: a record whose license is confirmed
  // NOT currently assigned/active (license_status explicitly says so — see
  // src/utils/licenseStatus.js; never inferred from activity/usage) must
  // not keep accruing a rule-based seat cost — that would misrepresent an
  // unassigned seat as an ongoing charge. This only gates the CONFIGURED/
  // REFERENCE rule path below; source-provided cost (above) already
  // reflects whatever the source itself reports and stays authoritative
  // either way (e.g. actual billing that genuinely continues).
  if (!isLicenseActive(record)) {
    return {
      monthly_cost: null,
      cost_type: 'inactive_license',
      cost_label: COST_TYPE_LABELS.inactive_license,
      cost_source: 'License is not currently assigned/active (license_status) — no seat cost applied',
      cost_rule_id: null,
      currency: null,
      billing_frequency: null,
      display_cost: null,
      display_currency: null,
      exchange_rate: null,
      exchange_rate_date: null
    }
  }

  const rule = matchCostRule(record, rules)
  if (!rule || !hasValue(rule.amount)) {
    return {
      monthly_cost: null,
      cost_type: 'unavailable',
      cost_label: COST_TYPE_LABELS.unavailable,
      cost_source: 'Not available — no cost rule configured for this product/plan/SKU',
      cost_rule_id: rule?.id ?? null,
      currency: null,
      billing_frequency: null,
      display_cost: null,
      display_currency: null,
      exchange_rate: null,
      exchange_rate_date: null
    }
  }

  const monthlyCost = monthlyEquivalentAmount(rule)
  const baseAmount = monthlyCost !== null ? monthlyCost : Number(rule.amount)
  const conv = convert(baseAmount, rule.currency || 'USD', appCurrency, exchangeRates)

  return {
    monthly_cost: monthlyCost,
    cost_type: rule.cost_type,
    cost_label: COST_TYPE_LABELS[rule.cost_type] || rule.cost_type,
    cost_source: rule.source || null,
    cost_rule_id: rule.id,
    currency: rule.currency || 'USD',
    billing_frequency: rule.billing_frequency,
    display_cost: monthlyCost !== null ? conv.displayAmount : null,
    display_currency: monthlyCost !== null ? conv.displayCurrency : null,
    exchange_rate: monthlyCost !== null ? conv.exchangeRate : null,
    exchange_rate_date: monthlyCost !== null ? conv.rateDate : null
  }
}

function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : null
}

// After every record already has its own independently-resolved cost,
// find people holding more than one record in the SAME seat group (e.g.
// Claude Code + Claude Chat - one paid Anthropic seat, reported as two
// separate CSVs/activity surfaces - see seatGroupForProduct) and make sure
// that seat's cost is counted exactly once. Whichever record in the group
// actually resolved a real cost "wins" and keeps it; every other record in
// that (person, seat group) cluster is explicitly marked as sharing that
// seat - excluded from spend totals (no double-billing) and from Missing
// Pricing (its cost isn't unknown, it's just recorded on a sibling row).
// MUST run over every connection's records together, not one connection
// at a time, since the same person's two CSVs could in principle be
// imported as separate connections.
export function consolidateSharedSeats(records) {
  const groups = new Map()
  records.forEach((r, idx) => {
    const email = normEmail(r.email)
    if (!email) return
    const key = `${email}::${seatGroupForProduct(r.product)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(idx)
  })

  const out = records.slice()
  for (const indices of groups.values()) {
    if (indices.length < 2) continue
    const primaryIdx = indices.find((i) => out[i].cost_type !== 'unavailable') ?? indices[0]
    const primary = out[primaryIdx]
    const seatGroup = seatGroupForProduct(primary.product)
    for (const i of indices) {
      if (i === primaryIdx) continue
      out[i] = {
        ...out[i],
        cost_type: 'shared_seat',
        cost_label: COST_TYPE_LABELS.shared_seat,
        cost_source: `Same ${seatGroup} seat as this person's ${primary.product} record (${primary.cost_label || primary.cost_type}) — billed once, not counted again here.`,
        display_cost: null,
        display_currency: null,
        exchange_rate: null,
        exchange_rate_date: null
      }
    }
  }
  return out
}

// Applies resolveCost to every record, in place of a per-page loop.
export function resolveCostForRecords(records, options) {
  return (records || []).map((r) => ({ ...r, ...resolveCost(r, options) }))
}
