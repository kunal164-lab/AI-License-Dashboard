// Top Activities aggregation (Dashboard Top Activities spec) — pure-
// function tests against the real client util, same convention as
// server/utils/__tests__/dashboardUserPopulation.test.js (a src/utils/*.js
// module tested via node:test even though it's client-side code).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateTopActivities } from '../../../src/utils/activityMetrics.js'

test('no longer hardcoded to Chats / Messages — a Kiro-only dataset produces Kiro-specific rows, not a generic chat metric', () => {
  const records = [
    { product: 'Kiro', email: 'a@ssp.com', credits_used: 100, chat_conversations: 5, total_messages: 20 },
    { product: 'Kiro', email: 'b@ssp.com', credits_used: 50, chat_conversations: 3, total_messages: 10 }
  ]
  const activities = aggregateTopActivities(records)
  assert.equal(activities.some((a) => a.label === 'Chats / Messages'), false, 'must never fabricate a generic Chats/Messages row for Kiro')
  const byKey = Object.fromEntries(activities.map((a) => [a.key, a.value]))
  assert.equal(byKey.kiro_credits_used, 150)
  assert.equal(byKey.kiro_chat_conversations, 8)
  assert.equal(byKey.kiro_total_messages, 30)
})

test('Kiro Credits Used is its own separate metric, distinct from messages/conversations', () => {
  const records = [{ product: 'Kiro', email: 'a@ssp.com', credits_used: 999, chat_conversations: 1, total_messages: 1 }]
  const activities = aggregateTopActivities(records)
  const credits = activities.find((a) => a.key === 'kiro_credits_used')
  assert.ok(credits)
  assert.equal(credits.label, 'Kiro Credits Used')
  assert.equal(credits.value, 999)
})

test('Claude Requests and Claude Tokens are available when Claude data exists, spend is never treated as an activity metric', () => {
  const records = [
    { product: 'Claude', email: 'a@ssp.com', total_requests: 100, total_prompt_tokens: 500, total_completion_tokens: 300, monthly_cost: 20, display_cost: 20 },
    { product: 'Claude', email: 'b@ssp.com', total_requests: 50, total_prompt_tokens: 200, total_completion_tokens: 100, monthly_cost: 100, display_cost: 100 }
  ]
  const activities = aggregateTopActivities(records)
  const byKey = Object.fromEntries(activities.map((a) => [a.key, a.value]))
  assert.equal(byKey.claude_requests, 150)
  assert.equal(byKey.claude_tokens, 1100, 'prompt + completion tokens summed')
  assert.equal(activities.some((a) => a.label.toLowerCase().includes('spend') || a.label.toLowerCase().includes('cost')), false, 'spend/cost must never appear as an activity metric')
})

test('Microsoft Copilot prefers the real v2 prompt count when available, never both prompts and the surfaces-used fallback for the same tenant', () => {
  const withPrompts = [{ product: 'Microsoft Copilot', email: 'a@ssp.com', ms_prompts_all_apps: 40, activity_count: 3 }]
  const activitiesWithPrompts = aggregateTopActivities(withPrompts)
  assert.equal(activitiesWithPrompts.find((a) => a.key === 'ms_copilot_prompts')?.value, 40)
  assert.equal(activitiesWithPrompts.some((a) => a.key === 'ms_copilot_interactions'), false, 'must not show the fallback alongside the real prompt count')
})

test('Microsoft Copilot falls back to the real surfaces-used signal only when no v2 prompt data exists at all', () => {
  const withoutPrompts = [{ product: 'Microsoft Copilot', email: 'a@ssp.com', ms_prompts_all_apps: null, activity_count: 2 }]
  const activities = aggregateTopActivities(withoutPrompts)
  assert.equal(activities.find((a) => a.key === 'ms_copilot_interactions')?.value, 2)
  assert.equal(activities.some((a) => a.key === 'ms_copilot_prompts'), false)
})

test('Microsoft Copilot never invents a token count — no ms_copilot token metric exists at all', () => {
  const records = [{ product: 'Microsoft Copilot', email: 'a@ssp.com', ms_prompts_all_apps: 40 }]
  const activities = aggregateTopActivities(records)
  assert.equal(activities.some((a) => a.label.toLowerCase().includes('token')), false)
})

test('Freshservice never receives a fabricated activity metric — no PRODUCT_METRIC_DEFS entry exists for it, and it has no generic fields either', () => {
  const records = [{ product: 'Freshservice', email: 'a@ssp.com', license_status: 'assigned' }]
  const activities = aggregateTopActivities(records)
  assert.deepEqual(activities, [])
})

test('GitHub Copilot uses real chat-request/code-completion columns when present, and the generic fallback only when neither is', () => {
  const withSpecific = [{ product: 'GitHub Copilot', email: 'a@ssp.com', copilot_chat_requests: 12, copilot_code_completions: 34, activity_count: 46 }]
  const specificActivities = aggregateTopActivities(withSpecific)
  assert.equal(specificActivities.find((a) => a.key === 'gh_chat_requests')?.value, 12)
  assert.equal(specificActivities.find((a) => a.key === 'gh_code_completions')?.value, 34)
  assert.equal(specificActivities.some((a) => a.key === 'gh_activity'), false, 'the generic fallback must not appear alongside real specific columns')

  const withoutSpecific = [{ product: 'GitHub Copilot', email: 'b@ssp.com', activity_count: 7 }]
  const fallbackActivities = aggregateTopActivities(withoutSpecific)
  assert.equal(fallbackActivities.find((a) => a.key === 'gh_activity')?.value, 7)
})

test('the existing generic Chats/Messages metric (from a manual "Other" CSV import) is preserved as ONE entry among several, not the only one', () => {
  const records = [
    { product: 'Other', email: 'legacy@ssp.com', chats: 100, messages: 200 },
    { product: 'Kiro', email: 'a@ssp.com', credits_used: 50 }
  ]
  const activities = aggregateTopActivities(records)
  assert.equal(activities.find((a) => a.key === 'chats_messages')?.value, 300)
  assert.equal(activities.find((a) => a.key === 'kiro_credits_used')?.value, 50)
  assert.ok(activities.length >= 2, 'both the legacy generic metric and the product-specific one must coexist')
})

test('unsupported/zero-value metrics never appear — no N/A rows, no fake zero rows', () => {
  const records = [{ product: 'Kiro', email: 'a@ssp.com', credits_used: 0, chat_conversations: null, total_messages: undefined }]
  const activities = aggregateTopActivities(records)
  assert.deepEqual(activities, [], 'an all-zero/null dataset must produce zero rows, never a fake placeholder')
})

test('activity aggregation never double-counts a Claude person\'s Chat+Code capability rows — already merged before reaching this module', () => {
  // Mirrors src/utils/productModel.js#mergeSeatGroupRecords' own real
  // combining behavior: total_requests is already summed across a
  // person's Claude Chat + Claude Code rows into ONE merged 'Claude'
  // record by the time Overview.jsx's allData reaches this module.
  const alreadyMergedRecord = { product: 'Claude', email: 'a@ssp.com', total_requests: 150, total_prompt_tokens: 700, total_completion_tokens: 400 }
  const activities = aggregateTopActivities([alreadyMergedRecord])
  assert.equal(activities.find((a) => a.key === 'claude_requests')?.value, 150, 'must read the already-merged total exactly once, not re-sum per capability')
})

test('a mixed multi-product dataset produces a bounded, meaningful list — not a huge unbounded one', () => {
  const records = [
    { product: 'Kiro', email: 'a@ssp.com', credits_used: 1000, chat_conversations: 50, total_messages: 200 },
    { product: 'Claude', email: 'b@ssp.com', total_requests: 500, total_prompt_tokens: 10000, total_completion_tokens: 5000 },
    { product: 'Microsoft Copilot', email: 'c@ssp.com', ms_prompts_all_apps: 300 },
    { product: 'GitHub Copilot', email: 'd@ssp.com', copilot_chat_requests: 60, copilot_code_completions: 120 },
    { product: 'Other', email: 'e@ssp.com', chats: 40, messages: 60, code_sessions: 10, file_edits: 5, projects_created: 2, artifacts_created: 3 }
  ]
  const activities = aggregateTopActivities(records)
  assert.ok(activities.length <= 8, 'the list must stay bounded/compact')
  // Sorted descending by value.
  for (let i = 1; i < activities.length; i++) assert.ok(activities[i - 1].value >= activities[i].value)
})
