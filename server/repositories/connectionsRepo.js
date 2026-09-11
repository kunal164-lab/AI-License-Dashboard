import crypto from 'crypto'
import { run, all, get, persist } from '../db/index.js'
import { encrypt, decrypt } from '../crypto.js'

function genId() {
  return crypto.randomBytes(8).toString('hex')
}

function rowToConnection(row) {
  if (!row) return null
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    label: row.label,
    authType: row.auth_type,
    status: row.status,
    meta: JSON.parse(row.meta_json || '{}'),
    credentials: decrypt(row.credentials_enc),
    stats: { users: row.stats_users, records: row.stats_records },
    lastSync: row.last_sync,
    lastAttempt: row.last_attempt,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// kind: 'api' (OAuth/API-key connections) | 'csv' (manual file imports)
export function createConnection({ source, kind = 'api', label, authType, credentials, meta }) {
  const id = genId()
  const now = new Date().toISOString()
  run(
    `INSERT INTO connections (id, source, kind, label, auth_type, status, meta_json, credentials_enc, stats_users, stats_records, last_sync, last_attempt, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, 0, NULL, NULL, NULL, ?, ?)`,
    [id, source, kind, label || source, authType || null, JSON.stringify(meta || {}), encrypt(credentials || {}), now, now]
  )
  persist()
  return getConnection(id)
}

export function getConnection(id) {
  return rowToConnection(get('SELECT * FROM connections WHERE id = ?', [id]))
}

export function listConnections(source) {
  const rows = source
    ? all('SELECT * FROM connections WHERE source = ? ORDER BY created_at', [source])
    : all('SELECT * FROM connections ORDER BY created_at', [])
  return rows.map(rowToConnection)
}

// patch may include: status, lastSync, lastAttempt, lastError, stats {users,records}, meta, credentials, label
export function updateConnection(id, patch) {
  const current = getConnection(id)
  if (!current) return null
  const meta = patch.meta ? { ...current.meta, ...patch.meta } : current.meta
  const credentials = patch.credentials ? { ...current.credentials, ...patch.credentials } : current.credentials
  const stats = patch.stats ? { ...current.stats, ...patch.stats } : current.stats
  const now = new Date().toISOString()
  run(
    `UPDATE connections SET
       label = ?, status = ?, meta_json = ?, credentials_enc = ?,
       stats_users = ?, stats_records = ?, last_sync = ?, last_attempt = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.label ?? current.label,
      patch.status ?? current.status,
      JSON.stringify(meta),
      encrypt(credentials),
      stats.users ?? 0,
      stats.records ?? 0,
      patch.lastSync !== undefined ? patch.lastSync : current.lastSync,
      patch.lastAttempt !== undefined ? patch.lastAttempt : current.lastAttempt,
      patch.lastError !== undefined ? patch.lastError : current.lastError,
      now,
      id
    ]
  )
  persist()
  return getConnection(id)
}

export function deleteConnection(id) {
  const existed = !!getConnection(id)
  // sql.js does not enforce FK constraints by default even when declared,
  // so related rows are removed explicitly rather than relying on CASCADE.
  run('DELETE FROM usage_records WHERE connection_id = ?', [id])
  run('DELETE FROM sync_history WHERE connection_id = ?', [id])
  run('DELETE FROM freshservice_agents WHERE connection_id = ?', [id])
  run('DELETE FROM connections WHERE id = ?', [id])
  persist()
  return existed
}

// Fields sent to the browser — credentials are NEVER included.
export function toSafeView(conn) {
  return {
    id: conn.id,
    source: conn.source,
    kind: conn.kind,
    label: conn.label,
    authType: conn.authType,
    status: conn.status,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    lastSync: conn.lastSync,
    lastAttempt: conn.lastAttempt,
    lastError: conn.lastError,
    stats: conn.stats,
    org: conn.meta.org || null,
    enterprise: conn.meta.enterprise || null,
    login: conn.meta.login || null,
    tenantId: conn.meta.tenantId || null,
    apiBaseUrl: conn.meta.apiBaseUrl || null,
    sourceType: conn.meta.sourceType || null,
    period: conn.meta.period || null,
    signInsDays: conn.meta.signInsDays || null,
    msConnectionId: conn.meta.msConnectionId || null,
    // Freshservice-only (Part 1/6/14 of the two-ingestion-methods spec):
    // which method is active, its method-specific config, and the current
    // agent count — the same conn.stats.records both sync methods already
    // set identically, so this reads correctly regardless of which method
    // produced it.
    sourceMethod: conn.meta.sourceMethod || null,
    securityGroupName: conn.meta.securityGroupName || null,
    securityGroupId: conn.meta.securityGroupId || null,
    sharingUrl: conn.meta.sharingUrl || null,
    fileName: conn.meta.fileName || null,
    sharePointLocation: conn.meta.sharePointLocation || null,
    agentCount: conn.stats?.records ?? null,
    enabled: conn.meta.enabled !== false,
    lastSyncDurationMs: conn.meta.lastSyncDurationMs ?? null,
    // How the CURRENTLY STORED dataset was obtained — kept for sources that
    // still support a manual fallback (none currently do; retained for
    // forward compatibility with older stored connections).
    lastImportSourceType: conn.meta.lastImportSourceType || null,
    lastManualImport: conn.meta.lastManualImport || null
  }
}
