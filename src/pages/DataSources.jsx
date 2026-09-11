import React, { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, CheckCircle2, XCircle, FileUp, Unplug, Database, Info, Settings } from 'lucide-react'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import AddSourceModal from '../components/AddSourceModal'
import StatusBadge from '../components/StatusBadge'
import BrandLogo from '../components/BrandLogo'
import toast from '../utils/toast'

// 'Claude' (capital C) matches the exact `source` value stored on both the
// automatic (kind:'api') and manual-CSV (kind:'csv') Claude connections —
// see src/App.jsx's DataSourcesFileImport provider="Claude" prop, which the
// automatic source's bootstrap (server/index.js) deliberately reuses rather
// than introducing a second, differently-cased provider key.
const PROVIDER_LABELS = { github: 'GitHub Copilot', kiro: 'Kiro', microsoft: 'Microsoft 365', freshservice: 'Freshservice', Claude: 'Claude' }
// Where "Manage" sends an API source to configure/add accounts, sync, or
// disconnect in more detail than this table's row actions allow.
const PROVIDER_MANAGE_ROUTES = { github: '/data-sources/github', kiro: '/data-sources/kiro', microsoft: '/data-sources/microsoft-copilot', freshservice: '/data-sources/freshservice', Claude: '/data-sources/claude' }

export default function DataSources({ navigate, csvSources, onAddCsvSource, onEditCsvSource, onCsvDisconnect, onSyncApplied, onDisconnectApplied, onRefreshAll, refreshingAll }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshResults, setRefreshResults] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [showAddSource, setShowAddSource] = useState(false)

  const refresh = useCallback(() => {
    // CSV/XLSX sources are now backend connections too (kind: 'csv'), but this
    // page renders them separately via the csvSources prop — exclude them
    // here so they aren't listed twice.
    return fetch('/api/connections').then((r) => r.json()).then((j) => setConnections((j.connections || []).filter((c) => c.kind !== 'csv'))).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function refreshOne(conn) {
    setBusyId(conn.id)
    try {
      const r = await fetch(`/api/connections/${conn.id}/sync`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.records) { onSyncApplied(conn.id, conn.source, j.records); toast.success(`${conn.label}: refreshed (${j.records.length.toLocaleString()} records).`) }
      else if (r.ok && j.recordCount !== undefined) { toast.success(`${conn.label}: refreshed (${j.recordCount.toLocaleString()} records).`) }
      else if (r.ok && j.skipped) { toast.info(`${conn.label}: ${j.reason || 'skipped'}.`) }
      else toast.error(`${conn.label}: refresh failed — ${j.error || 'unknown error'}`)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function disconnectApi(conn) {
    // Freshservice: disconnect removes this connection's configuration and
    // its current agent data (src/pages/DataSourcesFreshservice.jsx's
    // Manage page has the same behavior, with the same confirm wording —
    // these two entry points used to disagree: this one only soft-disabled
    // the connection [PATCH enabled:false], leaving it sitting in the list
    // with a "Stopped" badge instead of actually going away, which is the
    // confirmed reason disconnecting from the table looked like it "did
    // nothing." Microsoft 365 itself, its users, and every other source's
    // data are completely unaffected either way.
    if (conn.source === 'freshservice') {
      const configLabel = conn.sourceMethod === 'manual_csv' ? 'Manual CSV Upload' : (conn.securityGroupName || 'security group')
      if (!confirm(`Disconnect Freshservice? This removes the "${configLabel}" configuration and its agent data. Microsoft 365 itself is not affected.`)) return
      await fetch(`/api/connections/${conn.id}`, { method: 'DELETE' })
      onDisconnectApplied(conn.id)
      await refresh()
      toast.info('Freshservice disconnected.')
      return
    }
    // Claude's automatic source is a single, server-managed connection, not
    // a user-added account — "Disconnect" here means the same as "Stop" on
    // its own dedicated page (Part 19: stopping must never erase data), not
    // a hard delete of imported Claude MTD data.
    if (conn.source === 'Claude') {
      if (!confirm('Stop the automatic Claude MTD source? This stops future scheduled refreshes. Existing imported Claude data will be preserved.')) return
      await fetch('/api/claude/stop', { method: 'POST' })
      await refresh()
      toast.info('Claude automatic source stopped. Existing data preserved.')
      return
    }
    if (!confirm(`Disconnect "${conn.label}"?`)) return
    await fetch(`/api/connections/${conn.id}`, { method: 'DELETE' })
    onDisconnectApplied(conn.id)
    await refresh()
    toast.info(`${conn.label} disconnected.`)
  }

  function disconnectCsv(row) {
    if (!confirm(`Disconnect "${row.account}"?`)) return
    onCsvDisconnect(row.id)
    toast.info(`${row.account} disconnected.`)
  }

  async function handleRefreshAll() {
    const results = await onRefreshAll()
    // CSV/XLSX sources are never touched by refresh-all (manual import
    // required) — call that out explicitly rather than leaving them absent
    // from the summary, so it's clear they weren't simply forgotten.
    const csvInfo = Object.values(csvSources || {}).map((c) => ({ id: c.id, label: c.label, manual: true }))
    setRefreshResults([...results, ...csvInfo])
    await refresh()
  }

  function handleSelectSource(key) {
    setShowAddSource(false)
    if (key === 'claude') navigate('/data-sources/claude')
    else if (key === 'other') onAddCsvSource('Other')
    else if (key === 'github') navigate('/data-sources/github')
    else if (key === 'kiro') navigate('/data-sources/kiro')
    else if (key === 'microsoft') navigate('/data-sources/microsoft-copilot')
    else if (key === 'freshservice') navigate('/data-sources/freshservice')
  }

  // One row per ACTUAL connected account — API connections and manual
  // CSV/XLSX sources normalized into the same shape for the table.
  const apiRows = connections.map((c) => ({
    kind: 'api',
    id: c.id,
    provider: PROVIDER_LABELS[c.source] || c.source,
    account: c.label,
    organization: c.org || c.enterprise || c.tenantId || c.securityGroupName || c.fileName || '—',
    type: c.source === 'freshservice' ? (c.sourceMethod === 'manual_csv' ? 'Manual CSV Upload' : 'Microsoft 365 Security Group') : 'API',
    status: c.enabled === false ? 'stopped' : c.status,
    lastUpdated: c.lastSync,
    records: c.stats?.records ?? 0,
    errorMessage: c.lastError,
    raw: c
  }))
  const csvRows = Object.values(csvSources || {}).map((c) => ({
    kind: 'csv',
    id: c.id,
    provider: c.source,
    account: c.label,
    organization: '—',
    type: (c.sourceType || 'csv').toUpperCase(),
    status: c.status,
    lastUpdated: c.lastSync,
    records: c.recordCount ?? 0,
    errorMessage: c.errorMessage,
    raw: c
  }))
  const rows = [...apiRows, ...csvRows]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Data Sources</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={() => setShowAddSource(true)}><Plus size={16} /> Add Data Source</button>
          <button className="button primary" onClick={handleRefreshAll} disabled={refreshingAll || connections.length === 0}>
            <RefreshCw size={16} className={refreshingAll ? 'spin' : ''} />
            {refreshingAll ? 'Refreshing...' : 'Refresh All Sources'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Connected Sources</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          API sources refresh automatically. Manual (CSV/XLSX) sources keep their last imported data — use Replace Report to update them.
        </div>

        {refreshResults && (
          <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 6 }}>
            {refreshResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: r.manual ? 'var(--muted)' : r.ok ? 'var(--good)' : 'var(--bad)', fontSize: 13 }}>
                {r.manual ? <Info size={14} /> : r.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {' '}{r.label} {r.manual ? '— Manual import' : r.ok ? 'Updated' : `Failed — ${r.error || 'unknown error'}`}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="muted" style={{ marginTop: 12 }}>Loading...</div>
        ) : rows.length === 0 ? (
          <EmptyStateInline onAdd={() => setShowAddSource(true)} />
        ) : (
          <div className="table" style={{ marginTop: 12, border: 'none', boxShadow: 'none', padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Provider</th><th>Account</th><th>Organization</th><th>Type</th><th>Status</th><th>Last Updated</th><th>Records</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><BrandLogo provider={row.provider} product={row.provider} size="sm" label /></td>
                    <td>{row.account}</td>
                    <td>{row.organization}</td>
                    <td>{row.type}</td>
                    <td><StatusBadge status={busyId === row.id ? 'Syncing' : row.status === 'stopped' ? 'Stopped' : row.status === 'connected' ? 'Connected' : row.status === 'error' ? 'Needs attention' : 'Pending'} spin={busyId === row.id} /></td>
                    <td>{formatRelativeTime(row.lastUpdated)}</td>
                    <td>{row.records.toLocaleString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {row.kind === 'api' ? (
                          <>
                            <button className="button" onClick={() => refreshOne(row.raw)} disabled={busyId === row.id}>
                              <RefreshCw size={14} className={busyId === row.id ? 'spin' : ''} />
                              {busyId === row.id ? 'Syncing...' : 'Refresh'}
                            </button>
                            {PROVIDER_MANAGE_ROUTES[row.raw.source] && (
                              <button className="button secondary" onClick={() => navigate(PROVIDER_MANAGE_ROUTES[row.raw.source])}>
                                <Settings size={14} /> Manage
                              </button>
                            )}
                            <button className="danger" onClick={() => disconnectApi(row.raw)}><Unplug size={14} /> Disconnect</button>
                          </>
                        ) : (
                          <>
                            <button className="button secondary" onClick={() => onEditCsvSource(row.id, row.provider)}><FileUp size={14} /> Replace Report</button>
                            <button className="danger" onClick={() => disconnectCsv(row)}><Unplug size={14} /> Disconnect</button>
                          </>
                        )}
                      </div>
                      {row.errorMessage && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{row.errorMessage}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddSource && <AddSourceModal onClose={() => setShowAddSource(false)} onSelect={handleSelectSource} />}
    </div>
  )
}

function EmptyStateInline({ onAdd }) {
  return (
    <div className="empty-state">
      <Database size={28} className="empty-state-icon" />
      <div className="empty-state-title">No sources connected yet</div>
      <div className="empty-state-hint">Connect an AI provider or import a usage report to start tracking license and usage data.</div>
      <button className="button primary" style={{ marginTop: 12 }} onClick={onAdd}><Plus size={16} /> Add Data Source</button>
    </div>
  )
}
