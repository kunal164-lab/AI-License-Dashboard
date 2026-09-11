// Product/license identity resolution — collapses sibling records that are
// really ONE paid seat reported across more than one source/CSV (e.g. the
// Claude Chat and Claude Code exports) into a single canonical product
// record, so license counts, product filters and the Users/Products pages
// see "1 Claude license" rather than "Claude Chat" + "Claude Code" as two
// separate products. This is a genuinely different concern from
// server/services/costEngine.js's shared-seat cost dedup (which only stops
// the SAME seat being billed twice) — that runs first and already leaves
// exactly one member of the group holding the real resolved cost; this
// function runs after it and merges the group's records into one, carrying
// that already-resolved cost forward rather than recomputing it.
//
// Only products listed in providerRegistry.js's SEAT_GROUP_BY_PRODUCT are
// ever touched — every other provider's records pass through completely
// unchanged, so this can never affect Microsoft 365, Freshservice, Kiro or
// GitHub Copilot data.
import { seatGroupForProduct, capabilityForProduct } from './providerRegistry.js'

const PLAN_CONFLICT_LABEL = 'Plan Conflict — Investigate'

function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : null
}
function hasValue(v) {
  return v !== null && v !== undefined && v !== ''
}
function uniqueNonEmpty(values) {
  return Array.from(new Set((values || []).filter(hasValue)))
}
function normalizedPlanKey(plan) {
  return hasValue(plan) ? String(plan).trim().toLowerCase() : null
}

export function mergeSeatGroupRecords(records) {
  const groups = new Map()
  records.forEach((r, idx) => {
    const seatGroup = seatGroupForProduct(r.product)
    // Not part of a multi-source seat group (the default for every product
    // not explicitly listed) — nothing to merge, leave it exactly as is.
    if (seatGroup === r.product) return
    // Still canonicalized to the seat group's product name/capabilities
    // even with no email (nothing to merge it WITH, safely) — an
    // "_unkeyed" record never groups with anything else, matching
    // userModel.js's own identity-key fallback.
    const email = normEmail(r.email)
    const key = email ? `${email}::${seatGroup}` : `_unkeyed_${idx}::${seatGroup}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(idx)
  })

  if (!groups.size) return records

  const toRemove = new Set()
  const merged = []
  for (const indices of groups.values()) {
    indices.forEach((i) => toRemove.add(i))
    const members = indices.map((i) => records[i])
    const seatGroup = seatGroupForProduct(members[0].product)

    // Plan agreement: if every member that HAS a plan agrees, use it. If
    // two members report genuinely different plans for the same seat,
    // never silently pick one — surface it as a conflict and withhold cost
    // until an admin investigates (see Part 3 of the spec this implements).
    const planValues = uniqueNonEmpty(members.map((m) => m.plan))
    const planKeys = uniqueNonEmpty(members.map((m) => normalizedPlanKey(m.plan)))
    const planConflict = planKeys.length > 1

    const capabilities = uniqueNonEmpty(members.map((m) => capabilityForProduct(m.product) || m.product))
    const sources = uniqueNonEmpty(members.map((m) => m._source))
    const activityCount = members.reduce((s, m) => s + (Number(m.activity_count) || 0), 0)
    const lastActivity = uniqueNonEmpty(members.map((m) => m.last_activity)).sort().slice(-1)[0] || null
    // Shared-seat cost consolidation (costEngine.js's consolidateSharedSeats)
    // already ran before this and left exactly one member holding the real
    // resolved display_cost — that member's cost fields are carried
    // forward as-is; this never recomputes cost.
    const costSource = members.find((m) => hasValue(m.display_cost)) || members[0]

    // Claude-specific aggregate fields (src/utils/claudeNormalizer.js) — a
    // per-model breakdown array plus request/token totals live on EACH
    // member (one per Claude product/capability, e.g. Chat vs Code), so a
    // plain last-member-wins spread (below) would silently drop every
    // member's data but the last. Keyed on field PRESENCE, not a hardcoded
    // product name, so this stays generic — any other current/future seat
    // group whose members happen to carry these same field names gets the
    // same safe combine-across-members behavior for free.
    const combinedModels = members.some((m) => Array.isArray(m.models))
      ? members.flatMap((m) => Array.isArray(m.models) ? m.models : [])
      : undefined
    const summedFields = {}
    for (const f of ['total_requests', 'total_prompt_tokens', 'total_completion_tokens', 'total_net_spend_usd', 'total_gross_spend_usd']) {
      if (members.some((m) => hasValue(m[f]))) summedFields[f] = members.reduce((s, m) => s + (Number(m[f]) || 0), 0)
    }

    merged.push({
      ...Object.assign({}, ...members),
      _id: members.find((m) => hasValue(m.email))?.email || members[0]._id,
      product: seatGroup,
      capabilities,
      capabilityRecords: members,
      plan: planConflict ? null : (planValues[0] || null),
      plan_conflict: planConflict ? planValues : null,
      activity_count: activityCount || null,
      last_activity: lastActivity,
      _source: sources.join(','),
      cost_type: planConflict ? 'plan_conflict' : costSource.cost_type,
      cost_label: planConflict ? PLAN_CONFLICT_LABEL : costSource.cost_label,
      cost_source: planConflict
        ? `Conflicting plan values across this seat's capability sources (${planValues.join(' vs ')}) — cost withheld until resolved.`
        : costSource.cost_source,
      display_cost: planConflict ? null : costSource.display_cost,
      display_currency: planConflict ? null : costSource.display_currency,
      exchange_rate: planConflict ? null : costSource.exchange_rate,
      exchange_rate_date: planConflict ? null : costSource.exchange_rate_date,
      cost_rule_id: planConflict ? null : costSource.cost_rule_id,
      monthly_cost: planConflict ? null : costSource.monthly_cost,
      ...(combinedModels !== undefined ? { models: combinedModels } : {}),
      ...summedFields
    })
  }

  const passthrough = records.filter((_, i) => !toRemove.has(i))
  return [...passthrough, ...merged]
}
