// Kiro is a USAGE SOURCE, not a per-row license roster — the real Kiro CSV
// has one row per (user, date, client type), often several rows per user
// per month. This file turns that into ONE aggregated record per
// (canonical user, month) — never one record per raw CSV row — matching
// the same "canonical product/license record" shape every other
// provider's normalizer already produces, so it plugs into the existing
// canonical user/product/cost pipeline (src/utils/userModel.js,
// productModel.js, server/services/costEngine.js) with no special-casing
// anywhere else.
//
// Identity: Kiro NEVER creates its own user population. A row only becomes
// usage data if its right_PrimaryEmail (trimmed, lowercased, EXACT match —
// never fuzzy, never by display name) matches an email already present in
// the current Microsoft 365 directory (itself already gated to the SSP
// company population — see server/repositories/microsoftRepo.js#isSspCompany
// and src/utils/userModel.js#buildMicrosoftDirectory). A row whose email
// doesn't match is EXCLUDED from the aggregated dataset — never turned into
// a new standalone canonical person — and counted in the returned
// diagnostics so an admin can investigate it.

export const REQUIRED_KIRO_COLUMNS = [
  'Date', 'UserId', 'Client_Type', 'Chat_Conversations', 'Credits_Used',
  'Subscription_Tier', 'Total_Messages', 'right_PrimaryEmail'
]

function headerKeys(rawRows) {
  const first = rawRows.find((r) => r && typeof r === 'object')
  return first ? Object.keys(first).map((k) => k.trim().toLowerCase()) : []
}

// Structural check only (do the required columns exist at all) — separate
// from per-ROW validity (checked per-record during normalization below).
export function validateKiroCsv(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return { valid: false, reason: 'The file contains no data rows.' }
  const keys = new Set(headerKeys(rawRows))
  const missing = REQUIRED_KIRO_COLUMNS.filter((c) => !keys.has(c.toLowerCase()))
  if (missing.length) {
    return { valid: false, reason: `Missing required column(s): ${missing.join(', ')}. This does not look like a Kiro usage export.` }
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
  return e ? String(e).trim().toLowerCase() : null
}

// Accepts YYYY-MM-DD directly (no timezone-shifting Date parse needed for
// the common case) and falls back to a real Date parse for anything else —
// either way, only a value that resolves to a genuine calendar date is
// accepted; anything else is treated as invalid and excluded, never
// defaulted to "today" or invented.
function parseKiroDate(raw) {
  if (!raw) return null
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    const month = Number(m), day = Number(d)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return { iso: `${y}-${m}-${d}`, month: `${y}-${m}` }
  }
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return null
  const iso = t.toISOString().slice(0, 10)
  return { iso, month: iso.slice(0, 7) }
}

// A genuinely BLANK numeric field (no value reported that period) is not an
// error — it contributes 0, same as "no usage." A PRESENT-but-unparseable
// value ("abc") is the actual invalid-data case the spec calls out — never
// invented as 0 silently; `invalid: true` lets the caller reject the whole
// row instead of quietly treating junk data as "no usage."
function parseUsageField(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: 0, invalid: false }
  const cleaned = String(raw).replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: 0, invalid: true }
  const n = Math.round(Number(cleaned))
  return (Number.isFinite(n) && n >= 0) ? { value: n, invalid: false } : { value: 0, invalid: true }
}

// `validEmails`: Set<normalizedEmail> — the CURRENT canonical Microsoft
// directory (already SSP-gated). Every match is by this exact set only;
// nothing here ever falls back to email domain, display name, or any other
// field. Both real callers (the manual CSV import route, and the generic
// API/OAuth sync path via normalizeKiro below) pass the real directory and
// get the strict gate; omitting `validEmails` entirely (as opposed to
// passing an empty set) disables it, kept only so a caller with genuinely
// no directory available yet doesn't show zero users. Returns { records,
// diagnostics } — `records` is the final, canonical-pipeline-ready array
// (one per matched user+month); `diagnostics` is the full accounting the
// caller (server route) persists/reports so a data-quality problem is
// visible, never silently swallowed.
export function normalizeKiroUsage(rawRows, { validEmails } = {}) {
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
  const uniqueUserIds = new Set()
  // key: `${email}::${month}` -> accumulator
  const groups = new Map()

  for (const row of rows) {
    const userId = pick(row, 'UserId')
    if (userId) uniqueUserIds.add(userId)

    const dateRaw = pick(row, 'Date')
    const date = parseKiroDate(dateRaw)
    if (!date) { markInvalid('missing_or_invalid_date'); continue }

    const emailRaw = pick(row, 'right_PrimaryEmail')
    const email = normEmail(emailRaw)
    if (!email) { markInvalid('missing_email'); continue }

    const chatField = parseUsageField(pick(row, 'Chat_Conversations'))
    const creditsField = parseUsageField(pick(row, 'Credits_Used'))
    const messagesField = parseUsageField(pick(row, 'Total_Messages'))
    if (chatField.invalid || creditsField.invalid || messagesField.invalid) {
      markInvalid('non_numeric_usage_fields')
      continue
    }
    const chatConversations = chatField.value
    const creditsUsed = creditsField.value
    const totalMessages = messagesField.value

    const clientType = pick(row, 'Client_Type')
    const subscriptionTier = pick(row, 'Subscription_Tier')

    if (emailSet && !emailSet.has(email)) {
      unmatchedEmails.add(email)
      continue
    }

    const key = `${email}::${date.month}`
    if (!groups.has(key)) {
      groups.set(key, {
        email, month: date.month, userId,
        chatConversations: 0, creditsUsed: 0, totalMessages: 0,
        clientTypes: new Set(), lastActivity: date.iso,
        // Latest-dated non-null tier wins (Part 6) — tracked by comparing
        // each row's own date, not insertion order.
        tierDate: null, tier: null,
        // Lightweight per-day rows kept for a FUTURE detailed drill-down
        // (Part 16) — deliberately just the few fields a day/raw view would
        // need, not the entire original CSV row, so this stays cheap at
        // real data volumes.
        rawDailyRecords: []
      })
    }
    const g = groups.get(key)
    g.chatConversations += chatConversations || 0
    g.creditsUsed += creditsUsed || 0
    g.totalMessages += totalMessages || 0
    if (clientType) g.clientTypes.add(clientType)
    if (date.iso > g.lastActivity) g.lastActivity = date.iso
    if (subscriptionTier && (!g.tierDate || date.iso >= g.tierDate)) {
      g.tier = subscriptionTier
      g.tierDate = date.iso
    }
    g.rawDailyRecords.push({ date: date.iso, client_type: clientType, chat_conversations: chatConversations, credits_used: creditsUsed, total_messages: totalMessages, subscription_tier: subscriptionTier })
  }

  const planCounts = {}
  const clientTypeCounts = {}
  const monthsFound = new Set()

  const records = Array.from(groups.values()).map((g) => {
    monthsFound.add(g.month)
    const plan = g.tier || null
    if (plan) planCounts[plan] = (planCounts[plan] || 0) + 1
    const clientTypes = Array.from(g.clientTypes)
    for (const ct of clientTypes) clientTypeCounts[ct] = (clientTypeCounts[ct] || 0) + 1

    return {
      _id: `${g.email}::${g.month}`,
      email: g.email,
      // `name` is deliberately left for the canonical merge to backfill from
      // the Microsoft directory (userModel.js) — Kiro's own CSV has no real
      // display name field worth trusting over that.
      name: null,
      product: 'Kiro',
      plan,
      month: g.month,
      credits_used: g.creditsUsed,
      chat_conversations: g.chatConversations,
      total_messages: g.totalMessages,
      // Generic cross-provider fields (Overview/Users/reports already sum
      // these across every product) — chat_conversations/total_messages are
      // the closest real analogue to Claude's chats/messages; credits_used
      // is a distinct consumption metric, deliberately NOT folded into
      // activity_count (it would skew the shared Heavily Active/Active/Low
      // Activity/No Usage thresholds, which are calibrated around
      // chat/message-style counts, not a credits/billing unit).
      chats: g.chatConversations,
      messages: g.totalMessages,
      activity_count: g.chatConversations + g.totalMessages,
      last_activity: g.lastActivity,
      client_types: clientTypes,
      // No separate Kiro "license roster" exists — appearing in this
      // aggregated usage dataset at all IS the evidence of an assigned Kiro
      // subscription (Part 7). Usage Status is computed independently, from
      // activity_count above, by the same shared activityScore.js the rest
      // of the app already uses — never derived here.
      license_status: 'assigned',
      _source: 'Kiro usage CSV',
      _raw_daily_records: g.rawDailyRecords.sort((a, b) => a.date.localeCompare(b.date))
    }
  })

  return {
    records,
    diagnostics: {
      totalRows: rows.length,
      invalidRows: invalidCount,
      invalidReasons,
      uniqueUserIds: uniqueUserIds.size,
      matchedRecords: records.length,
      unmatchedEmails: Array.from(unmatchedEmails),
      unmatchedCount: unmatchedEmails.size,
      monthsFound: Array.from(monthsFound).sort(),
      planCounts,
      clientTypeCounts
    }
  }
}

// Picks ONE record per user — their LATEST month — to represent the
// current Kiro product/license relationship for the canonical pipeline
// (usage_records -> buildCanonicalUsers -> Users/Products/Cost/
// Optimization/Reports), which everywhere else in this app holds exactly
// one CURRENT record per person per product, never a historical time
// series (see calculations.js). The full monthly history (every record
// `normalizeKiroUsage` produced) is stored separately — see
// server/repositories/kiroRepo.js — for the dedicated Kiro page's own
// monthly table.
export function selectLatestPerUser(monthlyRecords) {
  const byEmail = new Map()
  for (const r of monthlyRecords || []) {
    const existing = byEmail.get(r.email)
    if (!existing || r.month > existing.month) byEmail.set(r.email, r)
  }
  return Array.from(byEmail.values())
}

// Entry point for the generic API/OAuth sync path (server/normalize.js#
// normalizeBySource, server/index.js#runSync) — same monthly aggregation
// and the SAME directory-email gate the manual CSV import route already
// applies via normalizeKiroUsage directly. `validEmails` used to be
// silently dropped here (runSync already builds it from
// msRepo.listAllUsers() and passes it into normalizeBySource — it just
// never reached this function), which meant a live Kiro OAuth/API sync
// could create canonical users for emails that don't exist in the
// Microsoft 365 directory, unlike every other import path in the app.
export function normalizeKiro(records, { validEmails } = {}) {
  return normalizeKiroUsage(records || [], { validEmails }).records
}

export default normalizeKiroUsage
