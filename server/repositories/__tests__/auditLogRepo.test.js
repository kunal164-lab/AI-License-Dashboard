// Audit-event retention/range/limit spec (Part 1 of the audit-retention/
// VBU spec) — pure repository-level tests against a real temp SQLite file,
// same pattern as server/repositories/__tests__/dashboardViewsRepo.test.js.
// Directly inserts rows with a controlled `at` timestamp (bypassing
// record()'s always-"now" timestamp) so retention/range behavior can be
// tested deterministically without waiting real days.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `audit-log-repo-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const auditLogRepo = await import('../auditLogRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => { run('DELETE FROM auth_audit_log') })

function insertAt(daysAgo, eventType = 'login_success', actorUpn = 'user@ssp.com') {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  run('INSERT INTO auth_audit_log (at, event_type, actor_upn, actor_oid, detail_json) VALUES (?,?,?,?,?)', [at, eventType, actorUpn, null, '{}'])
  return at
}

test('record() writes a real row retrievable via listRecent, newest first', () => {
  auditLogRepo.record({ eventType: 'login_success', actorUpn: 'a@ssp.com' })
  auditLogRepo.record({ eventType: 'logout', actorUpn: 'a@ssp.com' })
  const events = auditLogRepo.listRecent(10)
  assert.equal(events.length, 2)
  assert.equal(events[0].event_type, 'logout', 'the most recently written event must come first')
})

test('queryEvents defaults to rangeDays=1, limit=5 when nothing is requested', () => {
  for (let i = 0; i < 8; i++) insertAt(0.1, `event_${i}`)
  const { events, rangeDays, limit } = auditLogRepo.queryEvents()
  assert.equal(rangeDays, 1)
  assert.equal(limit, 5)
  assert.equal(events.length, 5)
})

test('events are returned newest first regardless of insertion order', () => {
  insertAt(3, 'oldest')
  insertAt(0.5, 'newest')
  insertAt(1.5, 'middle')
  const { events } = auditLogRepo.queryEvents({ rangeDays: 4, limit: 10 })
  assert.deepEqual(events.map((e) => e.event_type), ['newest', 'middle', 'oldest'])
})

test('rangeDays is clamped to MAX_RETENTION_DAYS (4) even when a caller asks for far more', () => {
  insertAt(3.9, 'within_range')
  const { rangeDays } = auditLogRepo.queryEvents({ rangeDays: 3650, limit: 10 })
  assert.equal(rangeDays, auditLogRepo.MAX_RETENTION_DAYS)
})

test('limit is clamped to MAX_LIMIT (100) even when a caller asks for far more', () => {
  const { limit } = auditLogRepo.queryEvents({ rangeDays: 1, limit: 999999 })
  assert.equal(limit, auditLogRepo.MAX_LIMIT)
})

test('a non-numeric rangeDays/limit falls back to the default rather than returning nothing/everything', () => {
  const { rangeDays, limit } = auditLogRepo.queryEvents({ rangeDays: 'not-a-number', limit: 'also-not-a-number' })
  assert.equal(rangeDays, auditLogRepo.DEFAULT_RANGE_DAYS)
  assert.equal(limit, auditLogRepo.DEFAULT_LIMIT)
})

test('a rangeDays/limit of 0 (a real number, just out of range) clamps up to the minimum of 1 rather than silently substituting the default', () => {
  const { rangeDays, limit } = auditLogRepo.queryEvents({ rangeDays: 0, limit: 0 })
  assert.equal(rangeDays, 1)
  assert.equal(limit, 1)
})

test('an event older than the requested range is excluded even though it still physically exists in the table', () => {
  insertAt(0.5, 'recent')
  insertAt(2.5, 'older_than_2_days')
  const { events } = auditLogRepo.queryEvents({ rangeDays: 2, limit: 10 })
  assert.deepEqual(events.map((e) => e.event_type), ['recent'])
})

test('pruneOldEvents deletes events older than MAX_RETENTION_DAYS (4) and leaves newer ones intact', () => {
  insertAt(4.5, 'too_old')
  insertAt(3.9, 'within_retention')
  insertAt(0.1, 'brand_new')
  auditLogRepo.pruneOldEvents()
  const remaining = auditLogRepo.listRecent(100).map((e) => e.event_type).sort()
  assert.deepEqual(remaining, ['brand_new', 'within_retention'], 'only the event older than 4 days should be purged')
})

test('record() itself triggers the same retention prune on every write', () => {
  insertAt(10, 'ancient')
  auditLogRepo.record({ eventType: 'login_success', actorUpn: 'a@ssp.com' })
  const remaining = auditLogRepo.listRecent(100).map((e) => e.event_type)
  assert.equal(remaining.includes('ancient'), false, 'a write must prune stale rows, not just add a new one on top of them')
})

test('queryEvents never returns an event outside the 4-day retention window even if a caller somehow still has a stale reference to it', () => {
  insertAt(4.5, 'beyond_retention')
  insertAt(1, 'in_range')
  const { events } = auditLogRepo.queryEvents({ rangeDays: 4, limit: 100 })
  assert.equal(events.some((e) => e.event_type === 'beyond_retention'), false)
  assert.equal(events.some((e) => e.event_type === 'in_range'), true)
})
