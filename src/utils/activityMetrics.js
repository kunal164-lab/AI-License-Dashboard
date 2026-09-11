// Centralized, per-product "Top Activities" metric definitions (Dashboard
// Top Activities spec) — the ONE place that knows which real, already-
// normalized usage fields exist per product and how to label/aggregate
// them for the Overview page. Adding a future product's activity metrics
// means adding one entry to PRODUCT_METRIC_DEFS below, never touching
// Overview.jsx itself.
//
// Every `pick(record)` reads a field that a real provider normalizer
// already populates (src/utils/kiroNormalizer.js, claudeNormalizer.js,
// microsoftNormalizer.js, copilotNormalizer.js) — never invented, never a
// fabricated token/interaction count. A product with no real value for a
// given metric across every record simply never produces that row (see
// aggregateTopActivities' own filter), rather than showing a fake zero.
//
// GENERIC_METRIC_DEFS (chats/messages/code sessions/file edits/projects/
// artifacts) are the pre-existing generic fields a manual "Other" CSV
// import can populate (src/utils/dataNormalizer.js) — kept exactly as
// before (still real data when present), just no longer the ONLY thing
// this card can ever show regardless of which real products are connected.
function hasValue(v) {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))
}

function sumIfAny(...vals) {
  const present = vals.filter(hasValue)
  if (!present.length) return null
  return present.reduce((sum, v) => sum + Number(v), 0)
}

const GENERIC_METRIC_DEFS = [
  { key: 'chats_messages', label: 'Chats / Messages', pick: (r) => sumIfAny(r.chats, r.messages) },
  { key: 'code_sessions', label: 'Code Sessions', pick: (r) => r.code_sessions },
  { key: 'file_edits', label: 'File Edits', pick: (r) => r.file_edits },
  { key: 'projects', label: 'Projects', pick: (r) => sumIfAny(r.projects_created, r.projects_used) },
  { key: 'artifacts_created', label: 'Artifacts Created', pick: (r) => sumIfAny(r.artifacts_created, r.claude_code_artifacts) }
]

// Keyed on the CANONICAL, post-merge product name (src/utils/
// productModel.js#mergeSeatGroupRecords already renames Claude Chat/Code
// to 'Claude' before Overview.jsx's `allData`/`data` ever reaches this
// module, and already SUMS total_requests/total_prompt_tokens/
// total_completion_tokens across a person's Claude Chat + Claude Code rows
// — so reading them here on the merged 'Claude' record is already
// correct, never double-counted).
const PRODUCT_METRIC_DEFS = {
  // Kiro's own monthly usage fields (server/repositories/kiroRepo.js /
  // src/utils/kiroNormalizer.js) — credits_used is called out explicitly
  // as its own metric (a real, distinct cost/usage signal from chat
  // activity), never folded into a generic "chats" bucket.
  Kiro: [
    { key: 'kiro_credits_used', label: 'Kiro Credits Used', pick: (r) => r.credits_used },
    { key: 'kiro_chat_conversations', label: 'Kiro Chat Conversations', pick: (r) => r.chat_conversations },
    { key: 'kiro_total_messages', label: 'Kiro Messages', pick: (r) => r.total_messages }
  ],
  // Claude MTD data (src/utils/claudeNormalizer.js) — real request/token
  // counts, never spend (Claude spend is a cost/billing figure, resolved
  // separately by the Cost Engine, not an activity metric).
  Claude: [
    { key: 'claude_requests', label: 'Claude Requests', pick: (r) => r.total_requests },
    { key: 'claude_tokens', label: 'Claude Tokens', pick: (r) => sumIfAny(r.total_prompt_tokens, r.total_completion_tokens) }
  ],
  // Microsoft Graph's Copilot usage report (src/utils/microsoftNormalizer.js)
  // — prefer the real v2 "prompts submitted" figure when the tenant's
  // report includes it; otherwise fall back to the same real, already-
  // documented "how many Copilot surfaces show activity" signal that
  // feeds this app's own Active/Inactive classification (never both for
  // the same tenant — the fallback only ever fires when the real prompt
  // count is genuinely absent).
  'Microsoft Copilot': [
    { key: 'ms_copilot_prompts', label: 'Copilot Prompts', pick: (r) => r.ms_prompts_all_apps },
    { key: 'ms_copilot_interactions', label: 'Copilot Interactions', pick: (r) => (hasValue(r.ms_prompts_all_apps) ? null : r.activity_count) }
  ],
  // GitHub Copilot usage report (src/utils/copilotNormalizer.js) — the two
  // most meaningful real columns when a tenant's export includes them;
  // the generic activity_count fallback only fires when NEITHER specific
  // column is present for any record, avoiding a redundant third row.
  'GitHub Copilot': [
    { key: 'gh_chat_requests', label: 'Copilot Chat Requests', pick: (r) => r.copilot_chat_requests },
    { key: 'gh_code_completions', label: 'Copilot Code Assistance', pick: (r) => r.copilot_code_completions },
    {
      key: 'gh_activity',
      label: 'GitHub Copilot Activity',
      pick: (r) => (hasValue(r.copilot_chat_requests) || hasValue(r.copilot_code_completions) ? null : r.activity_count)
    }
  ]
}

const MAX_ACTIVITY_ROWS = 8

// `records` must already be the effective-scope (VBU/population/filter)
// dataset the caller is authorized to see — this module only aggregates
// whatever it is given, it never re-derives population or VBU scope
// itself (that already happened upstream, the same way every other
// Overview aggregate — calculateSummary, product/department charts —
// already works: the server scopes the rows, the client aggregates for
// display).
export function aggregateTopActivities(records) {
  const totals = new Map()
  function bump(key, label, raw) {
    if (!hasValue(raw)) return
    const n = Number(raw)
    const existing = totals.get(key)
    totals.set(key, { key, label, value: (existing?.value || 0) + n })
  }
  for (const r of records || []) {
    for (const def of GENERIC_METRIC_DEFS) bump(def.key, def.label, def.pick(r))
    const productDefs = PRODUCT_METRIC_DEFS[r.product]
    if (productDefs) for (const def of productDefs) bump(def.key, def.label, def.pick(r))
  }
  return Array.from(totals.values())
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_ACTIVITY_ROWS)
}
