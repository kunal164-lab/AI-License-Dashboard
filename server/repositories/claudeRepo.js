import { run, all, get, persist } from '../db/index.js'

function rowToSnapshot(row) {
  return row ? { ...row, unique_user_count: row.unique_user_count } : null
}

function rowToSnapshotRecord(row) {
  return { ...row, models: JSON.parse(row.models_json || '[]') }
}

// Records ONE snapshot attempt (success, unchanged, or failed) — see
// server/services/claude/sync.js for the full state machine. `records` is
// only ever provided (and only ever persisted) for a genuinely NEW,
// successful snapshot; an "unchanged" or "failed" attempt still gets its
// own metadata row (for the history/audit trail) but writes no records.
export function recordSnapshot({ connectionId, snapshotHash, snapshotImportedAt, reportingType = 'MTD', recordCount = 0, uniqueUserCount = 0, status, errorMessage = null, records = null }) {
  const now = new Date().toISOString()
  run(
    `INSERT INTO claude_mtd_snapshots
      (connection_id, snapshot_hash, snapshot_imported_at, reporting_type, record_count, unique_user_count, status, error_message, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [connectionId, snapshotHash, snapshotImportedAt, reportingType, recordCount, uniqueUserCount, status, errorMessage, now]
  )
  const snapshotId = get('SELECT last_insert_rowid() AS id', []).id

  if (Array.isArray(records) && records.length) {
    for (const r of records) {
      run(
        `INSERT INTO claude_mtd_snapshot_records
          (snapshot_id, user_email, product, plan, total_requests, total_prompt_tokens, total_completion_tokens, total_net_spend_usd, total_gross_spend_usd, models_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          snapshotId, r.email, r.product, r.plan || null,
          r.total_requests || 0, r.total_prompt_tokens || 0, r.total_completion_tokens || 0,
          r.total_net_spend_usd || 0, r.total_gross_spend_usd || 0,
          JSON.stringify(r.models || [])
        ]
      )
    }
  }
  persist()
  return snapshotId
}

// The most recent SUCCESSFUL snapshot for a connection — "successful" means
// it actually produced/kept a real dataset (status 'success' for a newly
// imported snapshot, or 'unchanged' for a re-check that confirmed the prior
// one is still current); a 'failed' row is deliberately excluded here so a
// failed attempt is never mistaken for the current dataset (Part 4/15).
export function latestSuccessfulSnapshot(connectionId) {
  const row = get(
    `SELECT * FROM claude_mtd_snapshots WHERE connection_id = ? AND status IN ('success','unchanged') ORDER BY id DESC LIMIT 1`,
    [connectionId]
  )
  return rowToSnapshot(row)
}

export function latestSnapshot(connectionId) {
  return rowToSnapshot(get('SELECT * FROM claude_mtd_snapshots WHERE connection_id = ? ORDER BY id DESC LIMIT 1', [connectionId]))
}

// History for a future trends feature (Part 14) — newest first, capped so
// a long-lived connection's history table can't make this unbounded.
export function listSnapshots(connectionId, limit = 90) {
  return all('SELECT * FROM claude_mtd_snapshots WHERE connection_id = ? ORDER BY id DESC LIMIT ?', [connectionId, limit]).map(rowToSnapshot)
}

// Records belonging to the snapshot that actually feeds the current
// dashboard — the LATEST snapshot that has records at all (a pure
// 'unchanged' check writes no new records row; its data is still whatever
// the last records-bearing snapshot left behind).
export function currentRecords(connectionId) {
  const snap = get(
    `SELECT s.id FROM claude_mtd_snapshots s
     WHERE s.connection_id = ? AND s.status IN ('success','unchanged')
       AND EXISTS (SELECT 1 FROM claude_mtd_snapshot_records r WHERE r.snapshot_id = s.id)
     ORDER BY s.id DESC LIMIT 1`,
    [connectionId]
  )
  if (!snap) return []
  return all('SELECT * FROM claude_mtd_snapshot_records WHERE snapshot_id = ?', [snap.id]).map(rowToSnapshotRecord)
}

// One historical snapshot's own records, by id (Cost Trend spec — real
// monthly cost reconstruction needs a SPECIFIC past snapshot's per-user
// plan data, not just "the latest overall" that currentRecords() above
// returns). Never filters by status — the caller (costAnalytics.js)
// already chose which snapshot id to use from listSnapshots()'s own
// success/unchanged-filtered list.
export function recordsForSnapshot(snapshotId) {
  return all('SELECT * FROM claude_mtd_snapshot_records WHERE snapshot_id = ?', [snapshotId]).map(rowToSnapshotRecord)
}

// sql.js does not enforce `ON DELETE CASCADE` without an explicit
// `PRAGMA foreign_keys = ON` (not set anywhere in this app — see
// server/db/index.js), so the child snapshot_records rows are deleted
// explicitly here rather than relying on the FK declaration alone.
export function deleteAllForConnection(connectionId) {
  const snapshotIds = all('SELECT id FROM claude_mtd_snapshots WHERE connection_id = ?', [connectionId]).map((r) => r.id)
  for (const id of snapshotIds) run('DELETE FROM claude_mtd_snapshot_records WHERE snapshot_id = ?', [id])
  run('DELETE FROM claude_mtd_snapshots WHERE connection_id = ?', [connectionId])
  persist()
}
