// Normalizes the real Claude MTD (Month-To-Date) spend/usage CSV
// (Claude_Spend_MTD.csv) into canonical product/license records. This is a
// SNAPSHOT, not a historical dataset — the file has no date column, and
// each new file is the CURRENT state of the current MTD period, never a
// daily delta to sum with a previous file (see server/services/claude/
// sync.js, which is what enforces "replace, never sum" at the storage
// layer — this file only ever processes ONE file's rows in isolation).
//
// One raw row = one (user, product, model) combination for the MTD period.
// A user can have several rows (different products, or the same product
// across several models) — this groups by (email, product) into ONE
// canonical record per product, with a `models` breakdown array so
// per-model detail is never discarded (see Part 11 of the spec this
// implements). Claude Chat + Claude Code still merge into one seat exactly
// as before (src/utils/providerRegistry.js's SEAT_GROUP_BY_PRODUCT +
// src/utils/productModel.js#mergeSeatGroupRecords) — this file only
// produces the per-product-per-user record; the cross-product seat merge
// happens later in the existing shared pipeline, unchanged.
//
// Identity: exactly the same rule as Kiro (src/utils/kiroNormalizer.js) —
// normalized user_email, EXACT match only (never fuzzy) against the
// current Microsoft 365 (SSP-gated) directory. An unmatched email is
// excluded from the canonical dataset and reported in diagnostics, never
// turned into a new canonical person.

export const REQUIRED_CLAUDE_COLUMNS = [
  'user_email', 'product', 'model', 'total_requests', 'total_prompt_tokens',
  'total_completion_tokens', 'total_net_spend_usd', 'total_gross_spend_usd'
]

function headerKeys(rawRows) {
  const first = rawRows.find((r) => r && typeof r === 'object')
  return first ? Object.keys(first).map((k) => k.trim().toLowerCase()) : []
}

export function validateClaudeCsv(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return { valid: false, reason: 'The file contains no data rows.' }
  const keys = new Set(headerKeys(rawRows))
  const missing = REQUIRED_CLAUDE_COLUMNS.filter((c) => !keys.has(c.toLowerCase()))
  if (missing.length) {
    return { valid: false, reason: `Missing required column(s): ${missing.join(', ')}. This does not look like a Claude MTD spend export.` }
  }
  return { valid: true, reason: null }
}

function pick(row, name) {
  const keys = Object.keys(row || {})
  const idx = keys.map((k) => k.trim().toLowerCase()).indexOf(name.toLowerCase())
  if (idx === -1) return null
  const v = row[keys[idx]]
  return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim()
}

function normEmail(e) {
  if (!e) return null
  const trimmed = String(e).trim().toLowerCase()
  // A real, if minimal, shape check — never invented, never guessed; a
  // value with no '@' or no text either side of it is simply not an email.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

// The real CSV's own placeholder for aggregated org-wide usage that isn't
// attributable to any one person — verified against the real file during
// implementation: it appears as "(org service usage)" in the user_email
// column (parentheses included), not a real address, and must never become
// a canonical user/license/cost/report row. Exact normalized match only
// (trim, lowercase, strip an optional wrapping "(...)") — never a broad
// substring rule that could accidentally exclude a real user whose data
// happens to mention these words.
function isOrgServiceUsageEntry(rawEmailValue) {
  if (!rawEmailValue) return false
  const stripped = String(rawEmailValue).trim().replace(/^\((.*)\)$/, '$1').trim().toLowerCase()
  return stripped === 'org service usage'
}

// Multiple rows for the same person (across products/models) can each
// carry their own seat_tier value — Part 6 of the spec this implements: ONE
// Claude seat per person means ONE resolved tier, not one per row/product.
// `tierValues` are the raw (un-normalized) values in CSV row order for one
// email, already filtered to non-blank. Comparison is case/whitespace
// normalized so "Standard" and " standard " count as the same tier, but the
// FIRST-SEEN original casing is what's actually displayed/stored.
function resolveSeatTier(tierValues) {
  if (!tierValues.length) return { tier: null, conflict: false, values: [] }
  const byKey = new Map()
  for (const v of tierValues) {
    const key = v.trim().toLowerCase()
    if (!byKey.has(key)) byKey.set(key, v.trim())
  }
  const uniqueValues = Array.from(byKey.values())
  if (uniqueValues.length === 1) return { tier: uniqueValues[0], conflict: false, values: uniqueValues }
  // Conflict: genuinely different tier values reported for the same person.
  // Deterministic, non-random rule (never "pick whichever happened to hash
  // first"): the file has no per-row date, so the LAST value in the file's
  // own row order is treated as the most-authoritative available signal —
  // every distinct value is still recorded below for diagnostics so this
  // is visible, not silently resolved.
  const last = tierValues[tierValues.length - 1].trim()
  return { tier: last, conflict: true, values: uniqueValues }
}

// Blank -> 0 contribution (no invented value, matches Kiro's convention —
// see kiroNormalizer.js#parseUsageField for the same distinction). Present
// but unparseable -> invalid, excludes the whole row (never silently
// treated as zero spend/usage).
function parseNumericField(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: 0, invalid: false }
  const cleaned = String(raw).replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: 0, invalid: true }
  const n = Number(cleaned)
  return Number.isFinite(n) ? { value: n, invalid: false } : { value: 0, invalid: true }
}

// The raw CSV's own product names ('Chat', 'Cowork', 'Claude Code',
// 'Office Agents', 'Claude Design', 'Claude in Chrome', ...) are NEVER
// hardcoded/enumerated here — whatever string the CSV contains is used
// as-is, just given a consistent 'Claude ' prefix so it reads as one
// product family and lines up with src/utils/providerRegistry.js's
// prefix-based Claude grouping rule. A value that already starts with
// 'Claude' (e.g. 'Claude Code') is left untouched, never double-prefixed.
function normalizeProductName(raw) {
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  return trimmed.toLowerCase().startsWith('claude') ? trimmed : `Claude ${trimmed}`
}

// `validEmails`: Set<normalizedEmail> — the current SSP-gated Microsoft 365
// directory (see kiroNormalizer.js for the identical convention). Omitting
// it disables the match gate (not used by any caller today — every real
// Claude entry point, automatic sync and manual import alike, always
// passes the real directory; kept optional only for symmetry/testability
// with kiroNormalizer.js's own convention).
export function normalizeClaudeSnapshot(rawRows, { validEmails } = {}) {
  const hasEmailGate = validEmails !== undefined && validEmails !== null
  const emailSet = hasEmailGate ? (validEmails instanceof Set ? validEmails : new Set(validEmails)) : null
  const rows = Array.isArray(rawRows) ? rawRows : []

  let invalidCount = 0
  const invalidReasons = {}
  function markInvalid(reason) {
    invalidCount++
    invalidReasons[reason] = (invalidReasons[reason] || 0) + 1
  }

  const unmatchedEmails = new Set()
  // key: `${email}::${product}` -> accumulator
  const groups = new Map()
  // email -> raw seat_tier values, in row order, across ALL of that
  // person's rows regardless of product (Part 6 — one seat, one tier).
  const tierValuesByEmail = new Map()
  let orgServiceUsageRowCount = 0

  for (const row of rows) {
    const emailRaw = pick(row, 'user_email')
    if (isOrgServiceUsageEntry(emailRaw)) { orgServiceUsageRowCount++; continue }
    const email = normEmail(emailRaw)
    if (!email) { markInvalid('missing_or_invalid_email'); continue }

    const productRaw = pick(row, 'product')
    if (!productRaw) { markInvalid('missing_product'); continue }
    const product = normalizeProductName(productRaw)

    const modelRaw = pick(row, 'model')
    const model = modelRaw || 'Unknown'

    const requestsField = parseNumericField(pick(row, 'total_requests'))
    const promptTokensField = parseNumericField(pick(row, 'total_prompt_tokens'))
    const completionTokensField = parseNumericField(pick(row, 'total_completion_tokens'))
    const netSpendField = parseNumericField(pick(row, 'total_net_spend_usd'))
    const grossSpendField = parseNumericField(pick(row, 'total_gross_spend_usd'))
    if (requestsField.invalid || promptTokensField.invalid || completionTokensField.invalid || netSpendField.invalid || grossSpendField.invalid) {
      markInvalid('non_numeric_usage_or_spend_fields')
      continue
    }

    // Retained on the model breakdown row for a future detailed view, but
    // never surfaced as a metric today (Part 1 of the spec this
    // implements: only expose what's actually asked for).
    const uncachedInput = parseNumericField(pick(row, 'total_uncached_input_tokens')).value
    const cacheRead = parseNumericField(pick(row, 'total_cache_read_tokens')).value
    const cacheWrite5m = parseNumericField(pick(row, 'total_cache_write_5m_tokens')).value
    const cacheWrite1h = parseNumericField(pick(row, 'total_cache_write_1h_tokens')).value
    const webSearchCount = parseNumericField(pick(row, 'total_web_search_count')).value

    if (emailSet && !emailSet.has(email)) {
      unmatchedEmails.add(email)
      continue
    }

    const seatTierRaw = pick(row, 'seat_tier')
    if (seatTierRaw) {
      if (!tierValuesByEmail.has(email)) tierValuesByEmail.set(email, [])
      tierValuesByEmail.get(email).push(seatTierRaw)
    }

    const key = `${email}::${product}`
    if (!groups.has(key)) {
      groups.set(key, {
        email, product,
        totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
        totalNetSpend: 0, totalGrossSpend: 0,
        models: []
      })
    }
    const g = groups.get(key)
    g.totalRequests += requestsField.value
    g.totalPromptTokens += promptTokensField.value
    g.totalCompletionTokens += completionTokensField.value
    g.totalNetSpend += netSpendField.value
    g.totalGrossSpend += grossSpendField.value
    g.models.push({
      model,
      total_requests: requestsField.value,
      total_prompt_tokens: promptTokensField.value,
      total_completion_tokens: completionTokensField.value,
      total_net_spend_usd: netSpendField.value,
      total_gross_spend_usd: grossSpendField.value,
      total_uncached_input_tokens: uncachedInput,
      total_cache_read_tokens: cacheRead,
      total_cache_write_5m_tokens: cacheWrite5m,
      total_cache_write_1h_tokens: cacheWrite1h,
      total_web_search_count: webSearchCount
    })
  }

  // Resolve ONE seat_tier per person (Part 4/6) — reused as the EXISTING
  // canonical `plan` field (not a separate seat_tier field: every other
  // provider's cost-rule matching, UserDetail.jsx's Plan column, and the
  // Users page all already key off `plan`, and costEngine.js#matchCostRule
  // reads exactly this field — so populating it here is what makes a
  // configured Claude Standard/Premium cost_rule apply automatically, with
  // no cost-engine change needed).
  const resolvedTierByEmail = new Map()
  const seatTierConflicts = []
  for (const [email, values] of tierValuesByEmail.entries()) {
    const resolved = resolveSeatTier(values)
    resolvedTierByEmail.set(email, resolved.tier)
    if (resolved.conflict) seatTierConflicts.push({ email, values: resolved.values })
  }

  const productCounts = {}
  const modelCounts = {}
  const records = Array.from(groups.values()).map((g) => ({
    _id: `${g.email}::${g.product}`,
    email: g.email,
    // Backfilled from the Microsoft directory during canonical merge
    // (src/utils/userModel.js) — Claude's own CSV has no display name.
    name: null,
    product: g.product,
    // N/A (null) only when seat_tier was genuinely blank/missing for this
    // person — a real non-blank value (e.g. the file's own "Unknown") is
    // shown verbatim, never silently reclassified as N/A (Part 4).
    plan: resolvedTierByEmail.get(g.email) || null,
    license_status: 'assigned',
    activity_count: g.totalRequests || null,
    total_requests: g.totalRequests,
    total_prompt_tokens: g.totalPromptTokens,
    total_completion_tokens: g.totalCompletionTokens,
    // SOURCE SPEND, not license cost — Claude's real per-seat price comes
    // exclusively from the centralized Cost Engine's configured Standard/
    // Premium cost_rules (matched by plan, via seatGroupForProduct — see
    // server/services/costEngine.js#matchCostRule), never from this CSV's
    // own usage-spend columns. Deliberately NOT copied onto `estimated_spend`
    // (a diagnostic audit found that field is exactly what
    // costEngine.js#sourceProvidedSpend treats as an authoritative
    // cost-rule OVERRIDE — copying usage spend into it silently replaced
    // the configured license price with whatever Anthropic happened to
    // bill that MTD period, e.g. $0 for a seat with no usage this month).
    // These two fields remain available as their own named metrics for a
    // genuine "source/vendor spend" display, kept distinct from cost.
    total_net_spend_usd: g.totalNetSpend,
    total_gross_spend_usd: g.totalGrossSpend,
    models: g.models,
    // No date column exists in this CSV (Part 4) — never invented here.
    // The snapshot's own import timestamp is tracked separately by the
    // caller (server/services/claude/sync.js), not faked onto this field.
    last_activity: null,
    _source: 'Claude MTD snapshot'
  }))

  for (const r of records) {
    productCounts[r.product] = (productCounts[r.product] || 0) + 1
    for (const m of r.models) modelCounts[m.model] = (modelCounts[m.model] || 0) + 1
  }

  return {
    records,
    diagnostics: {
      totalRows: rows.length,
      invalidRows: invalidCount,
      invalidReasons,
      matchedRecords: records.length,
      unmatchedEmails: Array.from(unmatchedEmails),
      unmatchedCount: unmatchedEmails.size,
      uniqueUserCount: new Set(records.map((r) => r.email)).size,
      productCounts,
      modelCounts,
      orgServiceUsageRowsExcluded: orgServiceUsageRowCount,
      seatTierConflicts
    }
  }
}

export default normalizeClaudeSnapshot
