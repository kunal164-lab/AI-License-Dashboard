import { run, all, persist } from '../db/index.js'

function rowToUsage(row) {
  return {
    ...row,
    client_types: JSON.parse(row.client_types_json || '[]'),
    raw_daily_records: JSON.parse(row.raw_daily_json || '[]')
  }
}

// Full delete+insert per connection, same idempotent-replace pattern as
// recordsRepo.replaceRecordsForConnection/freshserviceRepo.replaceAgentsForConnection
// — re-importing the same CSV always produces the same aggregated rows, so
// the same input always yields the same stored rows, never doubled.
export function replaceUsageForConnection(connectionId, monthlyRecords) {
  run('DELETE FROM kiro_usage_monthly WHERE connection_id = ?', [connectionId])
  const now = new Date().toISOString()
  for (const r of monthlyRecords) {
    run(
      `INSERT INTO kiro_usage_monthly
        (connection_id, email, month, plan, credits_used, chat_conversations, total_messages, client_types_json, last_activity, raw_daily_json, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        connectionId, r.email, r.month, r.plan || null,
        r.credits_used || 0, r.chat_conversations || 0, r.total_messages || 0,
        JSON.stringify(r.client_types || []), r.last_activity || null,
        JSON.stringify(r._raw_daily_records || []), now
      ]
    )
  }
  persist()
  return monthlyRecords.length
}

export function listUsageForConnection(connectionId) {
  return all('SELECT * FROM kiro_usage_monthly WHERE connection_id = ? ORDER BY email, month', [connectionId]).map(rowToUsage)
}

export function listAllUsage() {
  return all('SELECT * FROM kiro_usage_monthly ORDER BY email, month').map(rowToUsage)
}

export function deleteAllForConnection(connectionId) {
  run('DELETE FROM kiro_usage_monthly WHERE connection_id = ?', [connectionId])
  persist()
}
