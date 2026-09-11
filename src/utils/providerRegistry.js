// Small, extensible product -> provider lookup. Not a switch statement:
// adding a future product's provider grouping is a one-line addition here,
// and any product NOT listed automatically becomes its own provider (its
// exact product name) rather than falling into an "Unknown" bucket or
// requiring a code change before it can be grouped/filtered at all.
const PRODUCT_TO_PROVIDER = {
  'Claude Code': 'Anthropic',
  'Claude Chat': 'Anthropic',
  // 'Claude' (no capability suffix) is the canonical, post-merge product
  // name productModel.js's mergeSeatGroupRecords renames Claude Chat/Code
  // records to — buildCanonicalUsers recomputes `provider` from that
  // already-merged product name, so this entry must exist too, and must
  // agree with the two above (Anthropic is the real provider — see Part 1
  // of the Claude product-normalization spec this app follows).
  'Claude': 'Anthropic',
  'GitHub Copilot': 'GitHub',
  // Kiro is an AWS/Amazon product, not its own provider/company — Amazon is
  // the real provider (a genuine, sourced fact, not invented) that happens
  // to make exactly one product this app tracks today.
  'Kiro': 'Amazon',
  'Microsoft Copilot': 'Microsoft',
  // Freshservice is the PRODUCT; Freshworks is the company/provider that
  // makes it — these are two different names, not synonyms (see the
  // branding spec this fixes). Previously unmapped, so providerForProduct
  // fell back to returning the product's own name ("Freshservice") as if
  // it were also the provider, conflating the two everywhere a provider
  // grouping was shown (Products' Providers card, Cost's byProvider, the
  // brand-logo registry).
  'Freshservice': 'Freshworks'
}

// The real Claude MTD CSV's own `product` column is dynamic — Cowork,
// Office Agents, Claude Design, Claude in Chrome, etc. alongside Chat/Code,
// and future exports may add more (see src/utils/claudeNormalizer.js,
// which never hardcodes an enum of allowed product values). Rather than
// hardcoding every variant into PRODUCT_TO_PROVIDER/SEAT_GROUP_BY_PRODUCT
// above (which WOULD be exactly the hardcoding the spec forbids), any
// product name in the "Claude " family — the literal 'Claude' (the
// post-merge canonical name) or anything starting with 'Claude ' — is
// recognized by this prefix rule instead, so a brand-new Claude product
// name in tomorrow's CSV is grouped correctly with zero code changes.
// Exported so other Claude-aware logic (src/utils/activityScore.js's
// Claude-specific usage classification) can recognize the same product
// family without duplicating this rule.
export function isClaudeFamily(product) {
  return product === 'Claude' || (typeof product === 'string' && product.startsWith('Claude '))
}

export function providerForProduct(product) {
  if (!product) return 'Unknown'
  if (PRODUCT_TO_PROVIDER[product]) return PRODUCT_TO_PROVIDER[product]
  if (isClaudeFamily(product)) return 'Anthropic'
  return product
}

// Some providers export the SAME paid seat/license as more than one
// product/report (e.g. Anthropic issues one Claude seat, but the Claude
// Code and Claude Chat usage reports arrive as two separate CSVs — same
// license, two activity surfaces). Grouping them here means the cost
// engine can recognize "this person already has this seat's cost counted
// under a sibling product" and bill it exactly once, without a per-
// provider branch in the engine itself. A product not listed here is its
// own seat group of one (the default, e.g. every other current provider).
const SEAT_GROUP_BY_PRODUCT = {
  'Claude Code': 'Claude',
  'Claude Chat': 'Claude'
}

export function seatGroupForProduct(product) {
  if (!product) return 'Unknown'
  if (SEAT_GROUP_BY_PRODUCT[product]) return SEAT_GROUP_BY_PRODUCT[product]
  if (isClaudeFamily(product)) return 'Claude'
  return product
}

// Which capability/feature a seat-grouped product's own report represents
// (e.g. the Claude Chat CSV is the "Chat" capability of the one Claude
// seat). Only meaningful for products actually listed in
// SEAT_GROUP_BY_PRODUCT above — null for everything else, since a product
// that isn't split across multiple source reports has no separate
// capability to name.
const CAPABILITY_LABEL_BY_PRODUCT = {
  'Claude Code': 'Code',
  'Claude Chat': 'Chat'
}

export function capabilityForProduct(product) {
  if (CAPABILITY_LABEL_BY_PRODUCT[product]) return CAPABILITY_LABEL_BY_PRODUCT[product]
  // e.g. 'Claude Cowork' -> 'Cowork', 'Claude Office Agents' -> 'Office Agents'.
  if (typeof product === 'string' && product.startsWith('Claude ')) return product.slice('Claude '.length)
  return null
}

// Which dashboard capabilities a product actually supports — usage
// tracking (does this source ever report activity/last-seen data at all?),
// optimization eligibility (can "low/no usage" ever be a valid removal
// recommendation for it?), and cost tracking (can it participate in the
// Cost Engine at all?). A product not listed here gets the default: every
// current usage-based product (Claude, Kiro, Microsoft Copilot, GitHub
// Copilot) behaves exactly as before — this table only needs an entry for
// a product that DIFFERS from that default.
//
// Freshservice is a ticketing/service-management platform whose CSV only
// ever establishes an Agent license relationship — it has no usage dataset
// of any kind (no activity count, no last-seen date), so treating it like
// a usage-tracked product would silently invent "No Usage"/"Low Activity"
// classifications and removal recommendations with nothing real behind
// them (see src/utils/activityScore.js#activityStatusFor and
// src/pages/Optimization.jsx, which both consult this registry). It still
// fully participates in cost reporting — an agent-license price is exactly
// the kind of cost the Cost Engine already knows how to price and total.
const PRODUCT_CAPABILITIES = {
  Freshservice: { usageTrackingSupported: false, optimizationEligible: false, costTrackingSupported: true }
}
const DEFAULT_CAPABILITIES = { usageTrackingSupported: true, optimizationEligible: true, costTrackingSupported: true }

export function capabilitiesForProduct(product) {
  return PRODUCT_CAPABILITIES[product] || DEFAULT_CAPABILITIES
}

// Every provider name reachable from the given product records, in a
// stable order (first-seen), for building a provider list/grid.
export function listProviders(records) {
  const seen = []
  const set = new Set()
  for (const r of records || []) {
    const p = providerForProduct(r.product)
    if (!set.has(p)) { set.add(p); seen.push(p) }
  }
  return seen
}
