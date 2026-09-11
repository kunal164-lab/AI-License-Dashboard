import React, { useState } from 'react'
import { RefreshCw, Unplug } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { formatRelativeTime } from '../utils/formatRelativeTime'

export default function ConnectionCard({ connection, onSync, onDisconnect, extra }) {
  const [busy, setBusy] = useState(false)

  async function handleSync() {
    setBusy(true)
    try { await onSync(connection.id) } finally { setBusy(false) }
  }

  async function handleDisconnect() {
    if (!confirm(`Disconnect "${connection.label}"?`)) return
    await onDisconnect(connection.id)
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{connection.label}</strong>
        <StatusBadge status={busy ? 'Syncing' : connection.status === 'connected' ? 'Connected' : connection.status === 'error' ? 'Needs attention' : 'Pending'} spin={busy} />
      </div>
      {extra}
      <div className="muted small" style={{ marginTop: 6 }}>
        Last Sync: {formatRelativeTime(connection.lastSync)} · Users: {connection.stats?.users ?? 0} · Records: {connection.stats?.records ?? 0}
      </div>
      {connection.lastError && <div style={{ marginTop: 6, color: 'var(--bad)' }}>{connection.lastError}</div>}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button className="button" onClick={handleSync} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          {busy ? 'Syncing...' : 'Sync Now'}
        </button>
        <button className="danger" onClick={handleDisconnect}>
          <Unplug size={16} />
          Disconnect
        </button>
      </div>
    </div>
  )
}
