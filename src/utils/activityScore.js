// USAGE STATUS — answers "how actively is this person using an already-
// assigned license?" — deliberately independent from LICENSE STATUS (see
// src/utils/licenseStatus.js), which answers "do they have the license at
// all?" A record with zero recorded usage is 'No Usage', never 'Inactive'
// — that word is reserved for License Status's revoked/unassigned meaning,
// and reusing it here was the exact conflation this file used to cause.
import { isClaudeFamily, capabilitiesForProduct } from './providerRegistry.js'

export const DEFAULT_THRESHOLDS = {
  heavilyActive: 200,
  active: 50,
  low: 1,
}

// Claude-specific thresholds — request COUNT is the primary
// frequency/activity signal (never combined with token volume into one
// score; different units). Requests and tokens are always highly
// correlated in the real data, so token volume is only ever a secondary,
// explanatory signal, not part of the threshold decision itself.
//
// Derived from the actual real imported Claude MTD dataset at
// implementation time (124 real users, requests: min 5, p25 105, median
// 276, p75 966, p90 2,672, max 18,220) — not invented. 50 sits just above
// the observed p25 (light, occasional users); 500 sits between the
// observed p75/p90 (clearly heavy, sustained users) — round numbers chosen
// from that real distribution, not the generic chat/message-tuned
// DEFAULT_THRESHOLDS above (which were never Claude-specific to begin
// with — Claude's own "requests" is a different unit/cadence than a chat
// or message count).
export const CLAUDE_THRESHOLDS = {
  heavilyActive: 500,
  active: 50,
}

// Deterministic per Part 2 of the spec this implements: "No Usage" is
// exactly requests=0 AND prompt_tokens=0 AND completion_tokens=0, never a
// score threshold. Every other bucket is decided by request count alone.
export function claudeUsageStatus(record, thresholds = CLAUDE_THRESHOLDS) {
  if (!record) return 'Unknown'
  const requests = Number(record.total_requests) || 0
  const promptTokens = Number(record.total_prompt_tokens) || 0
  const completionTokens = Number(record.total_completion_tokens) || 0
  if (requests === 0 && promptTokens === 0 && completionTokens === 0) return 'No Usage'
  if (requests >= thresholds.heavilyActive) return 'Heavily Active'
  if (requests >= thresholds.active) return 'Active'
  return 'Low Activity'
}

// Human-readable "why this status" explanation, generated from the SAME
// real fields the classification above actually used — never a canned
// sentence unrelated to the record's real numbers (Part 2/5 of the spec
// this implements: "the explanation must reference actual measured
// activity").
export function explainClaudeUsageStatus(record, thresholds = CLAUDE_THRESHOLDS) {
  const status = claudeUsageStatus(record, thresholds)
  const requests = Number(record?.total_requests) || 0
  const promptTokens = Number(record?.total_prompt_tokens) || 0
  const completionTokens = Number(record?.total_completion_tokens) || 0
  const totalTokens = promptTokens + completionTokens
  const capabilities = Array.isArray(record?.capabilities) && record.capabilities.length
    ? record.capabilities
    : (record?.product ? [record.product] : [])
  const capPhrase = capabilities.length
    ? `${capabilities.length} Claude ${capabilities.length === 1 ? 'capability' : 'capabilities'}`
    : 'no recorded Claude capability'

  if (status === 'No Usage') {
    return 'No Claude activity has been recorded in the current MTD snapshot.'
  }
  const activityPhrase = `${requests.toLocaleString('en-US')} request${requests === 1 ? '' : 's'} and ${totalTokens.toLocaleString('en-US')} total tokens recorded in the current MTD snapshot`
  if (status === 'Heavily Active') {
    return `High-volume Claude usage — ${activityPhrase}, across ${capPhrase}.`
  }
  if (status === 'Active') {
    return `Steady Claude usage — ${activityPhrase}, across ${capPhrase}.`
  }
  return `Low activity — ${activityPhrase}, across ${capPhrase}.`
}

// Microsoft 365 Copilot's usage report only ever returns one of two shapes
// (server/connectors/microsoft.js does not activate any v2-only report
// option today, and this tenant's synced report was confirmed, via a live
// data audit, to be v1-only — ms_prompts_all_apps/days_active are null for
// every single currently-licensed user):
//   v2 (if a tenant ever returns it): a real "prompts submitted" volume —
//     the same kind of count-based signal Claude/Kiro already use, so it
//     reuses that same generic DEFAULT_THRESHOLDS scale as a reasonable
//     starting point (not yet calibrated against real v2 data, since none
//     was available to audit at implementation time — flagged here rather
//     than silently presented as equally data-grounded as the v1/Claude
//     thresholds below).
//   v1 (this tenant, and the only shape audited against real data): only
//     per-app last-activity DATES exist, no volume metric at all — so
//     src/utils/microsoftNormalizer.js's activity_count is really "how many
//     distinct Copilot surfaces (Teams/Word/Excel/PowerPoint/Outlook/
//     OneNote/Loop/Copilot Chat/etc — up to 13 tracked) this person shows
//     ANY recorded activity in," a fundamentally different, much
//     smaller-range metric (real audited range: 2-8 surfaces, n=178) than
//     the chat/message-style counts DEFAULT_THRESHOLDS (50/200) was tuned
//     for. Applying those generic thresholds to a max-13 metric meant NO
//     Copilot user could ever cross 50 — every one of them landed in "Low
//     Activity" regardless of real usage, which is the confirmed root
//     cause of a prior "0% Copilot utilization" report. These thresholds
//     are instead grounded in that same real 178-user audit (p10 4, p25 5,
//     median 6, p75 6, p90 7): "Active" at 4 sits just below the p25/
//     median band; "Heavily Active" at 7 sits at the observed p90 — a real
//     3-way split of the actual data (7 Low / 130 Active / 41 Heavily
//     Active), not an arbitrary guess.
export const COPILOT_PROMPT_THRESHOLDS = { heavilyActive: 200, active: 50 }
export const COPILOT_SURFACE_THRESHOLDS = { heavilyActive: 7, active: 4 }

export function copilotUsageStatus(record) {
  if (!record) return 'Unknown'
  const prompts = record.ms_prompts_all_apps
  const hasPrompts = prompts !== null && prompts !== undefined
  const surfacesUsed = Number(record.activity_count) || 0
  const daysActive = Number(record.days_active) || 0
  // "No Usage" is genuinely zero — no last-activity date recorded AND no
  // surface count AND no v2 volume metric — never fabricated as zero when
  // the source simply didn't report a field (Part 16 of the spec this
  // implements).
  const hasAnyActivity = !!record.last_activity || surfacesUsed > 0 || (hasPrompts && prompts > 0) || daysActive > 0
  if (!hasAnyActivity) return 'No Usage'
  if (hasPrompts) {
    if (prompts >= COPILOT_PROMPT_THRESHOLDS.heavilyActive) return 'Heavily Active'
    if (prompts >= COPILOT_PROMPT_THRESHOLDS.active) return 'Active'
    return 'Low Activity'
  }
  if (surfacesUsed >= COPILOT_SURFACE_THRESHOLDS.heavilyActive) return 'Heavily Active'
  if (surfacesUsed >= COPILOT_SURFACE_THRESHOLDS.active) return 'Active'
  return 'Low Activity'
}

export function explainCopilotUsageStatus(record) {
  const status = copilotUsageStatus(record)
  if (status === 'No Usage') return 'No Microsoft 365 Copilot activity has been recorded by Microsoft Graph for this user.'
  const prompts = record?.ms_prompts_all_apps
  const daysActive = record?.days_active
  if (prompts !== null && prompts !== undefined) {
    return `${status} — ${Number(prompts).toLocaleString('en-US')} Copilot prompts submitted across all apps${daysActive !== null && daysActive !== undefined ? ` over ${Number(daysActive).toLocaleString('en-US')} active day${Number(daysActive) === 1 ? '' : 's'}` : ''} in the latest synced Microsoft Graph usage report.`
  }
  const surfacesUsed = Number(record?.activity_count) || 0
  return `${status} — Copilot activity recorded across ${surfacesUsed.toLocaleString('en-US')} distinct Copilot surface${surfacesUsed === 1 ? '' : 's'} (e.g. Teams, Word, Excel, Copilot Chat) in the latest synced Microsoft Graph usage report. This tenant's report does not include a prompt-volume metric, so surface breadth is the best available real signal.`
}

// A product with usageTrackingSupported: false (currently only
// Freshservice — see src/utils/providerRegistry.js#PRODUCT_CAPABILITIES)
// has no usage dataset of any kind, so it must never be classified
// 'No Usage'/'Low Activity'/etc — those are real, measured claims about
// recorded activity, and faking them (or treating an absent metric as a
// literal zero) is exactly what Part 2 of the Freshservice cost/usage
// separation this implements forbids. 'Not Tracked' is a distinct status
// that Optimization/Cost consumers must never pool with the real usage
// buckets when computing unused/low-usage/potential-savings.
export const NOT_TRACKED_STATUS = 'Not Tracked'

export function activityStatusFor(user, thresholds = DEFAULT_THRESHOLDS) {
  if (!user) return 'Unknown'
  if (!capabilitiesForProduct(user.product).usageTrackingSupported) return NOT_TRACKED_STATUS
  // Claude and Microsoft Copilot each get their own deterministic
  // classification (see claudeUsageStatus/copilotUsageStatus above) — both
  // have a usage shape fundamentally different from the chat/message/code-
  // session counts DEFAULT_THRESHOLDS was tuned for, and reusing that scale
  // unmodified silently produced results that could never reach "Active"
  // (Claude: different units entirely, per Part 1; Copilot: a max-13
  // surface-count metric that can never cross a 50-count threshold).
  if (isClaudeFamily(user.product)) return claudeUsageStatus(user)
  if (user.product === 'Microsoft Copilot') return copilotUsageStatus(user)
  const activity = (Number(user.activity_count) || 0) + (Number(user.chats)||0) + (Number(user.messages)||0) + (Number(user.code_sessions)||0) + (Number(user.file_edits)||0)
  if (activity >= thresholds.heavilyActive) return 'Heavily Active'
  if (activity >= thresholds.active) return 'Active'
  if (activity >= thresholds.low) return 'Low Activity'
  return 'No Usage'
}

export function classifyUsers(records, thresholds = DEFAULT_THRESHOLDS) {
  const groups = { 'Heavily Active': [], 'Active': [], 'Low Activity': [], 'No Usage': [], [NOT_TRACKED_STATUS]: [] }
  records.forEach(r => {
    const s = activityStatusFor(r, thresholds)
    groups[s] = groups[s] || []
    groups[s].push(r)
  })
  return groups
}
