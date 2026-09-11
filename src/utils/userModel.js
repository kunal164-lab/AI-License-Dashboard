// Canonical (person-level) user derivation. Groups the flat per-product,
// per-connection records (one row per person per product per source — the
// shape already produced by each provider's normalizer, e.g.
// src/utils/{copilotNormalizer,kiroNormalizer,microsoftNormalizer,
// dataNormalizer}.js) into ONE object per real person, WITHOUT collapsing
// their products into each other — the opposite of dataNormalizer.js's old
// mergeByEmail, which flattened every record for an email into a single
// row and silently dropped every product but the first. A person keeps an
// unlimited `products` array; nothing about a product/license/usage record
// is ever discarded because the person already exists.
import { providerForProduct } from './providerRegistry.js'
import { activityStatusFor, NOT_TRACKED_STATUS } from './activityScore.js'

// `role` is the only identity field still resolved across sources — name
// (see AUTHORITATIVE_FIELDS below — moved here after a real data audit
// found ~half of all canonical users showing the literal string "Unknown"
// as their name: anyone whose only product was Kiro/Claude, which
// deliberately never report a name of their own, had NOTHING to fall back
// to since the Microsoft directory map never carried a name at all),
// department/vbu/manager/job_title/company/office/domain/account_status
// are Microsoft-365-EXCLUSIVE, see AUTHORITATIVE_FIELDS below. Neither list
// is about products/licenses/usage, which stay per-source on each record
// in `products` regardless.
const IDENTITY_FIELDS = ['role']
// These nine fields have exactly ONE allowed source: the Microsoft 365
// directory (microsoftDirectory param below, built from the synced
// microsoft_users table). No priority order, no "first non-empty wins"
// across sources, no fallback to any other provider's CSV/API data — if
// Microsoft has no value, the field is null (rendered N/A), full stop.
const AUTHORITATIVE_FIELDS = ['name', 'job_title', 'department', 'vbu', 'manager', 'company', 'office', 'domain', 'account_status']
// 'Not Tracked' explicitly ranks BELOW every real measured status (even
// 'No Usage', itself a real "we measured, it was zero" claim) — a person
// with one capability-less product (Freshservice) and one real
// usage-tracked product must always show the real product's status, never
// 'Not Tracked'. Its rank must stay lower than every entry above, not
// merely absent (see finalizeCanonicalUser's reduce for why an absent key
// alone isn't enough).
const STATUS_RANK = { 'Heavily Active': 3, 'Active': 2, 'Low Activity': 1, 'No Usage': 0, 'Unused': 0, [NOT_TRACKED_STATUS]: -1 }

function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : null
}
function hasValue(v) {
  return v !== null && v !== undefined && v !== '' && v !== 'Unknown'
}
function uniqueList(values) {
  return Array.from(new Set((values || []).filter((v) => v !== null && v !== undefined && v !== '')))
}

// Identity resolution: normalized email first, then the record's own
// stable id as a fallback, then (only if neither exists) the record is
// preserved as its own standalone person rather than guessed at via name
// matching — matching the "safe identity resolution" requirement.
//
// `microsoftDirectory`: Map<normalizedEmail, {job_title, department, vbu,
// manager, company, office, domain, account_status}> — built once from the
// synced Microsoft 365 directory (microsoft_users table via
// server/repositories/microsoftRepo.js#listAllUsers, see
// buildMicrosoftDirectory below) and passed in by every real caller
// (src/App.jsx, src/pages/Products.jsx, server/services/costAnalytics.js).
// This is the ONLY source ever consulted for the eight AUTHORITATIVE_FIELDS
// — never a per-record value from any product/usage record, regardless of
// source or priority. A person with no Microsoft directory match gets null
// (N/A) for all eight; nothing is ever invented or borrowed from another
// source.
// Grouping key: resolved through microsoftDirectory's canonicalEmail (see
// buildMicrosoftDirectory below) rather than the record's own raw email
// string. Without this, the SAME real person ends up as TWO canonical
// users whenever two providers happen to report a different address form
// for them (a common, real pattern — e.g. Microsoft's own Copilot record
// uses upn rituj.shah@ssp-worldwide.com while a Freshservice/Kiro export
// reports mail rituj.shah@ssp-uki.com for the identical person). Fixed
// after a real data audit found the canonical user population inflated
// well past the actual Microsoft 365 headcount for exactly this reason —
// buildMicrosoftDirectory already deduped its OWN enrichment lookups this
// way (see its own comment), but buildCanonicalUsers's grouping never was,
// so the merge and the enrichment silently disagreed on "how many people
// are there."
//
// Defense in depth (Part 1 of the fix this implements — "a provider must
// never silently increase the canonical user population"): when
// microsoftDirectory is non-empty (Microsoft 365 has actually synced), a
// record whose email matches NEITHER a known upn/mail is excluded from the
// canonical merge entirely rather than becoming its own new "person." Every
// provider's own normalizer is already supposed to gate on this at import
// time (src/utils/canonicalIdentity.js#buildValidEmailSet) — this is a
// second, independent check at the merge layer so a bug or drift in any
// ONE provider's own gate (present or future — Freshservice, Claude, Kiro,
// GitHub Copilot) can never inflate Total Users on its own. When Microsoft
// hasn't synced yet (microsoftDirectory is empty), this gate is skipped —
// grouping falls back to the record's own raw email — so the app doesn't
// show zero users just because Microsoft isn't connected yet.
// Microsoft 365 is the authoritative SSP population, full stop — a real
// SSP employee does not stop existing in the canonical Users population
// just because they currently hold zero connected products/licenses.
// When `includeUnassignedMicrosoftUsers` is set, every Microsoft directory
// entry is seeded as its own canonical user FIRST, before any product
// record is even looked at, so:
//   372 Microsoft SSP users == 372 canonical users
// always holds regardless of how many of them happen to have a Claude/
// Copilot/Kiro/Freshservice/GitHub record. Provider records only ever
// ATTACH to one of these seeded people (or are excluded — see the gate
// below); they never define who exists. `microsoftDirectory` is dual-keyed
// (upn AND mail -> the SAME info object, see buildMicrosoftDirectory) so
// this dedupes by `canonicalEmail` exactly like the per-record loop below,
// never seeding the same real person twice.
//
// This is opt-in (default false), NOT baked unconditionally into every
// call — buildCanonicalUsers is also used to answer a narrower, different
// question at several call sites: "of the records I already handed you,
// who are the real people" (a single provider's own user count on
// Products.jsx, a dedicated Claude/Kiro page's own lookup map, etc.).
// Unconditionally seeding every Microsoft user there would silently turn
// e.g. "how many people actually use Freshservice" into "the entire
// company," which is a different, wrong answer to a different question.
// Only the app-wide Total Users population (src/App.jsx) passes true.
function seedMicrosoftUsers(microsoftDirectory) {
  const map = new Map()
  const order = []
  const seen = new Set()
  for (const info of microsoftDirectory.values()) {
    const key = info.canonicalEmail
    if (!key || seen.has(key)) continue
    seen.add(key)
    map.set(key, { _id: key, email: key, records: [] })
    order.push(key)
  }
  return { map, order }
}

export function buildCanonicalUsers(productRecords, microsoftDirectory = new Map(), { includeUnassignedMicrosoftUsers = false } = {}) {
  const gated = microsoftDirectory.size > 0
  const { map, order } = (gated && includeUnassignedMicrosoftUsers) ? seedMicrosoftUsers(microsoftDirectory) : { map: new Map(), order: [] }

  for (const r of productRecords || []) {
    const rawEmail = normEmail(r.email)
    const msMatch = rawEmail ? microsoftDirectory.get(rawEmail) : null
    if (gated && !msMatch && rawEmail) continue // unmatched — see comment above; not silently promoted to a new person
    const key = msMatch?.canonicalEmail || rawEmail || r._id || `_unkeyed_${order.length}`
    if (!map.has(key)) {
      map.set(key, { _id: key, email: msMatch?.canonicalEmail || rawEmail || r.email || null, records: [] })
      order.push(key)
    }
    map.get(key).records.push(r)
  }

  return order.map((key) => finalizeCanonicalUser(map.get(key), microsoftDirectory))
}

function resolveIdentityField(records, field) {
  for (const r of records) if (hasValue(r[field])) return r[field]
  return null
}

function finalizeCanonicalUser(u, microsoftDirectory) {
  const identity = {}
  for (const f of IDENTITY_FIELDS) identity[f] = resolveIdentityField(u.records, f)

  const msIdentity = microsoftDirectory.get(normEmail(u.email)) || {}
  const authoritative = {}
  for (const f of AUTHORITATIVE_FIELDS) authoritative[f] = hasValue(msIdentity[f]) ? msIdentity[f] : null

  // Products keep their OWN real values — name is backfilled onto a blank
  // product record from the Microsoft directory (never from another
  // product's own value, and never invented); department/VBU are
  // Microsoft-only too, so a product's own (possibly wrong, non-Microsoft)
  // department/vbu is never borrowed FROM or backfilled ONTO anything here.
  const products = u.records.map((r) => ({
    ...r,
    provider: providerForProduct(r.product),
    name: hasValue(r.name) ? r.name : (authoritative.name || r.name)
  }))

  // BUG FIXED: 'Not Tracked' (a capability-less product like Freshservice —
  // see activityScore.js#NOT_TRACKED_STATUS) has no STATUS_RANK entry, so
  // it resolves to the same -1 the reduce's initial `best = null` sentinel
  // also resolves to via `STATUS_RANK[best] ?? -1`. Without the explicit
  // `best === null` check below, `-1 > -1` is false on the very first
  // product, so `best` NEVER actually adopts 'Not Tracked' as a real value
  // — it silently stays `null` through the whole reduce for anyone whose
  // ONLY product(s) are all capability-less, and the `bestStatus ||
  // 'No Usage'` fallback below then wrongly reports a REAL, measured
  // "zero activity" claim for a person who was never usage-tracked at all
  // (confirmed: this put Freshservice-only canonical users in "Low/No
  // Usage" and the Overview "Low / No Usage Users" widget). The fix:
  // always adopt the FIRST product's real status unconditionally, then
  // only let a later product override it by actually outranking it — a
  // real measured status (rank >= 0) always beats 'Not Tracked' (rank -1)
  // this way, exactly as before, but 'Not Tracked' is no longer
  // indistinguishable from "nothing observed yet."
  const bestStatus = products.reduce((best, p) => {
    const s = activityStatusFor(p)
    if (best === null) return s
    return (STATUS_RANK[s] ?? -1) > (STATUS_RANK[best] ?? -1) ? s : best
  }, null)

  // display_cost is the centralized cost engine's one authoritative figure
  // per product record (server/services/costEngine.js) — already resolved
  // through the source-provided/actual/configured/reference priority.
  const spendValues = products.map((p) => p.display_cost).filter(hasValue).map(Number).filter((n) => !Number.isNaN(n))
  const totalSpend = spendValues.length ? Math.round(spendValues.reduce((a, b) => a + b, 0) * 100) / 100 : null

  const lastActivity = products.map((p) => p.last_activity).filter(Boolean).sort().slice(-1)[0] || null

  return {
    _id: u._id,
    email: u.email,
    // Microsoft-authoritative (Part 1/3/11 of the spec this implements) —
    // never a provider's own value, never invented. A real Microsoft user
    // always has a display name from Graph; null here means this person's
    // email genuinely isn't in the synced Microsoft directory at all (which
    // every provider's own normalizer should already be preventing from
    // reaching buildCanonicalUsers in the first place — see each
    // normalizer's own email-matching gate).
    name: authoritative.name || null,
    role: identity.role || null,
    job_title: authoritative.job_title,
    department: authoritative.department,
    vbu: authoritative.vbu,
    manager: authoritative.manager,
    company: authoritative.company,
    office: authoritative.office,
    domain: authoritative.domain,
    account_status: authoritative.account_status,
    products,
    product: uniqueList(products.map((p) => p.product)),
    provider: uniqueList(products.map((p) => p.provider)),
    plan: uniqueList(products.map((p) => p.plan)),
    license_status: uniqueList(products.map((p) => p.license_status)),
    source: uniqueList(products.map((p) => p._source)),
    totalLicenses: products.length,
    totalSpend,
    activity_count: products.reduce((s, p) => s + (Number(p.activity_count) || 0), 0),
    last_activity: lastActivity,
    // A Microsoft SSP user seeded with zero product records (see
    // seedMicrosoftUsers above) was never usage-tracked at all — the same
    // "an absent measurement is not a real zero" principle as a
    // capability-less product's own 'Not Tracked' status, so `bestStatus`
    // being null here (the reduce never ran — empty `products`) must NOT
    // fall back to 'No Usage', which would falsely claim this person WAS
    // measured and had zero activity.
    usage_status: bestStatus || (products.length === 0 ? NOT_TRACKED_STATUS : 'No Usage')
  }
}

// Provider-scoped canonical users — used for provider-level KPIs so a
// person appearing under two products of the SAME provider is still
// counted once (never sum of each product's own user count).
export function buildCanonicalUsersForProvider(productRecords, providerName, microsoftDirectory = new Map()) {
  const scoped = (productRecords || []).filter((r) => providerForProduct(r.product) === providerName)
  return buildCanonicalUsers(scoped, microsoftDirectory)
}

// Builds the microsoftDirectory Map every buildCanonicalUsers call above
// expects, from raw Microsoft 365 directory rows (server-side:
// server/repositories/microsoftRepo.js#listAllUsers; client-side: the
// `microsoftDirectory` field /api/dashboard now returns, built from the
// same repo function). account_status uses "Enabled"/"Disabled"
// deliberately, NOT "Active"/"Inactive" — that vocabulary is reserved for
// usage_status, and the two must never be visually conflated (a disabled
// account and an inactive-usage account are different, unrelated facts).
//
// Keyed by BOTH normalized upn AND mail (when they differ), pointing at the
// SAME info object — not just upn with mail as a same-slot fallback. Fixed
// after a real data audit found genuine SSP employees (e.g. upn
// rituj.shah@ssp-worldwide.com, mail rituj.shah@ssp-uki.com — a real,
// common pattern for UK&I entities on a different mail domain) showing
// department/vbu/etc as null despite being correctly matched by an
// external provider (which reports whichever address — upn or mail — its
// own export happens to carry, exactly like this same dual-key set every
// provider's own email-matching gate already builds — see
// buildValidEmailSet in src/utils/canonicalIdentity.js). A single-key map
// silently missed the match whenever a provider's email happened to be the
// non-preferred variant.
export function buildMicrosoftDirectory(users) {
  const map = new Map()
  for (const u of users || []) {
    const upnKey = normEmail(u.upn)
    const mailKey = normEmail(u.mail)
    const info = {
      name: u.display_name || null,
      job_title: u.job_title || null,
      department: u.department || null,
      vbu: u.vbu || null,
      manager: u.manager_display_name || null,
      company: u.company_name || null,
      office: u.office_location || null,
      domain: u.domain || null,
      account_status: u.account_enabled === true || u.account_enabled === 1 ? 'Enabled' : (u.account_enabled === false || u.account_enabled === 0 ? 'Disabled' : null),
      // The ONE stable key buildCanonicalUsers groups this person by,
      // regardless of which of their address forms (upn or mail) any
      // given provider record happens to report — see that function's own
      // comment for why this exists (mail preferred, since it's the
      // address a human actually reads/receives mail at).
      canonicalEmail: mailKey || upnKey
    }
    if (upnKey) map.set(upnKey, info)
    if (mailKey && mailKey !== upnKey) map.set(mailKey, info)
  }
  return map
}
