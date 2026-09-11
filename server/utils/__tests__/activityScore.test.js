// Regression coverage for Part 2 of the Freshservice fix: a product with
// usageTrackingSupported: false (see src/utils/providerRegistry.js#
// PRODUCT_CAPABILITIES) must never be classified 'No Usage'/'Low Activity'
// /etc — those are real, measured claims, and Freshservice's CSV has no
// usage dataset at all (it only establishes an Agent license
// relationship). 'Not Tracked' is a distinct status so downstream
// consumers (Optimization.jsx, calculations.js, reportBuilder.js) that
// filter on the exact strings 'No Usage'/'Low Activity' automatically
// exclude it, without needing their own per-product branching.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityStatusFor, classifyUsers, NOT_TRACKED_STATUS } from '../../../src/utils/activityScore.js'

test('a Freshservice record is classified "Not Tracked", never "No Usage", regardless of its (absent) activity fields', () => {
  const record = { product: 'Freshservice', activity_count: 0, last_activity: null }
  assert.equal(activityStatusFor(record), 'Not Tracked')
})

test('a Freshservice record with fields that WOULD indicate high activity on another product is still "Not Tracked" — capability gate runs first', () => {
  const record = { product: 'Freshservice', activity_count: 999, chats: 999 }
  assert.equal(activityStatusFor(record), 'Not Tracked')
})

test('a usage-tracked product (Kiro) is unaffected by the capability gate', () => {
  assert.equal(activityStatusFor({ product: 'Kiro', activity_count: 0 }), 'No Usage')
  assert.equal(activityStatusFor({ product: 'Kiro', activity_count: 500 }), 'Heavily Active')
})

test('classifyUsers groups Freshservice records under NOT_TRACKED_STATUS, never mixed into No Usage/Low Activity', () => {
  const records = [
    { product: 'Freshservice', email: 'a@x.com' },
    { product: 'Freshservice', email: 'b@x.com' },
    { product: 'Kiro', email: 'c@x.com', activity_count: 0 }
  ]
  const groups = classifyUsers(records)
  assert.equal(groups[NOT_TRACKED_STATUS].length, 2)
  assert.equal(groups['No Usage'].length, 1)
})
