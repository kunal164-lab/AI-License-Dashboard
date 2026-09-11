// Authentication/authorization audit trail (Part 16 of the auth spec).
// Never pass a token/secret/password into `detail` — this is a plain JSON
// blob written to disk as-is, and is readable by any admin via
// GET /api/admin/access/audit-log.
import { run, all, persist } from '../db/index.js'

// Audit-event retention spec: this table exists purely to power a compact
// "recent events" admin viewer, not a long-term audit archive (that's what
// the other, real business-data tables already are — see MAX_RANGE_DAYS's
// own comment for why this table is deliberately kept small). Never
// applies to any other table — every other repository/scheduler in this
// app is completely untouched by this constant.
export const MAX_RETENTION_DAYS = 4

function cutoffIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

// Deletes events older than MAX_RETENTION_DAYS. Safe to call as often as
// convenient (called on every write below, plus once at server startup) —
// a plain indexed DELETE (idx_auth_audit_log_at), not a background job.
export function pruneOldEvents() {
  run('DELETE FROM auth_audit_log WHERE at < ?', [cutoffIso(MAX_RETENTION_DAYS)])
  persist()
}

export function record({ eventType, actorUpn = null, actorOid = null, detail = {} }) {
  run(
    'INSERT INTO auth_audit_log (at, event_type, actor_upn, actor_oid, detail_json) VALUES (?,?,?,?,?)',
    [new Date().toISOString(), eventType, actorUpn, actorOid, JSON.stringify(detail)]
  )
  // Lightweight periodic cleanup (Part B: "run cleanup safely... at
  // audit-event write... do not create an unnecessarily complicated
  // background job system") — piggybacks on the same persist() this write
  // already needs, so this never costs an extra database rewrite.
  pruneOldEvents()
}

function rowToEvent(r) {
  return { ...r, detail: JSON.parse(r.detail_json || '{}'), detail_json: undefined }
}

export function listRecent(limit = 200) {
  return all('SELECT * FROM auth_audit_log ORDER BY id DESC LIMIT ?', [limit]).map(rowToEvent)
}

// Backend-enforced range/limit query (Part D/E/G of the audit-events
// spec) — the ONE place these bounds are actually applied; every caller
// (the admin viewer route AND the export route) must go through this, so
// there is no second code path a request could use to ask for more than
// MAX_RETENTION_DAYS/MAX_LIMIT ever return. rangeDays/limit are clamped
// here, never trusted as already-valid from a route's query string.
export const MAX_LIMIT = 100
export const DEFAULT_RANGE_DAYS = 1
export const DEFAULT_LIMIT = 5

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export function queryEvents({ rangeDays, limit } = {}) {
  const clampedRangeDays = clampInt(rangeDays, { min: 1, max: MAX_RETENTION_DAYS, fallback: DEFAULT_RANGE_DAYS })
  const clampedLimit = clampInt(limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT })
  const events = all(
    'SELECT * FROM auth_audit_log WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?',
    [cutoffIso(clampedRangeDays), clampedLimit]
  ).map(rowToEvent)
  return { events, rangeDays: clampedRangeDays, limit: clampedLimit }
}
