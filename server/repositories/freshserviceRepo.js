import { run, all, persist } from '../db/index.js'

const COLUMNS = [
  'record_key', 'name', 'email', 'agent_id', 'license_type', 'status',
  'department', 'location', 'role', 'job_title', 'employee_id', 'manager',
  'last_active', 'last_login', 'created_date', 'updated_date',
  'cost', 'vbu', 'cost_centre'
]

function rowToAgent(row) {
  return { ...row, raw: JSON.parse(row.raw_json || '{}') }
}

// Replaces the full agent set for a connection in one delete+insert, same
// pattern as recordsRepo.replaceRecordsForConnection. Only called after the
// CSV has been fully downloaded, validated and normalized in memory (see
// server/services/freshservice/sync.js) — the previous successful dataset
// is never touched until a new one is ready to fully replace it.
export function replaceAgentsForConnection(connectionId, agents) {
  run('DELETE FROM freshservice_agents WHERE connection_id = ?', [connectionId])
  const now = new Date().toISOString()
  const placeholders = COLUMNS.map(() => '?').join(', ')
  for (const agent of agents) {
    run(
      `INSERT INTO freshservice_agents (connection_id, ${COLUMNS.join(', ')}, raw_json, synced_at)
       VALUES (?, ${placeholders}, ?, ?)`,
      [connectionId, ...COLUMNS.map((c) => agent[c] ?? null), JSON.stringify(agent.raw || {}), now]
    )
  }
  persist()
  return agents.length
}

export function listAgents(connectionId) {
  return all('SELECT * FROM freshservice_agents WHERE connection_id = ? ORDER BY name', [connectionId]).map(rowToAgent)
}

export function listAllAgents() {
  return all('SELECT * FROM freshservice_agents ORDER BY name').map(rowToAgent)
}

export function deleteAllForConnection(connectionId) {
  run('DELETE FROM freshservice_agents WHERE connection_id = ?', [connectionId])
  persist()
}
