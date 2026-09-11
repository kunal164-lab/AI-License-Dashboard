import { run, all, persist } from '../db/index.js'

// One row per normalized record, stored as JSON — the schema never needs a
// migration when a normalizer gains a new field. connection_id ties rows
// back to their source/account.
export function replaceRecordsForConnection(connectionId, records) {
  const now = new Date().toISOString()
  run('DELETE FROM usage_records WHERE connection_id = ?', [connectionId])
  for (const record of records) {
    run('INSERT INTO usage_records (connection_id, data_json, updated_at) VALUES (?, ?, ?)', [connectionId, JSON.stringify(record), now])
  }
  persist()
}

export function getRecordsForConnection(connectionId) {
  return all('SELECT data_json FROM usage_records WHERE connection_id = ?', [connectionId]).map((r) => JSON.parse(r.data_json))
}

export function getAllRecords() {
  return all('SELECT connection_id, data_json FROM usage_records', []).map((r) => ({ connectionId: r.connection_id, ...JSON.parse(r.data_json) }))
}

export function deleteRecordsForConnection(connectionId) {
  run('DELETE FROM usage_records WHERE connection_id = ?', [connectionId])
  persist()
}
