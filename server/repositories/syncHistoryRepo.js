import { run, all, persist } from '../db/index.js'

// Append-only audit trail — one row per sync/import attempt, success or
// failure, never overwritten. Not surfaced in the UI yet, but this is the
// data a future usage/cost/license trend feature would read from, so it's
// captured from day one rather than bolted on later.
export function recordSyncAttempt({ connectionId, status, recordCount, errorMessage }) {
  run(
    'INSERT INTO sync_history (connection_id, attempted_at, status, record_count, error_message) VALUES (?, ?, ?, ?, ?)',
    [connectionId, new Date().toISOString(), status, recordCount ?? null, errorMessage || null]
  )
  persist()
}

export function getHistoryForConnection(connectionId, limit = 50) {
  return all('SELECT * FROM sync_history WHERE connection_id = ? ORDER BY attempted_at DESC LIMIT ?', [connectionId, limit])
}
