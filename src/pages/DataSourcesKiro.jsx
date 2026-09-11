import React, { useState } from 'react'
import { ArrowLeft, Plus, Plug, Unplug, X, Check } from 'lucide-react'
import useConnections from '../hooks/useConnections'
import ConnectionCard from '../components/ConnectionCard'
import CsvImporter from '../components/CsvImporter'
import BrandLogo from '../components/BrandLogo'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import toast from '../utils/toast'

// Kiro usage CSVs have one row per (user, date, client type) — this card
// posts the raw picked rows to the server as-is (server/index.js's
// /api/kiro/import-csv) rather than normalizing client-side, since the
// aggregation (group by user+month, sum credits/chats/messages, match
// against the current Microsoft directory) needs server-side data
// (src/utils/kiroNormalizer.js) that doesn't exist in the browser. On
// success the server's diagnostics (matched/unmatched/invalid counts,
// months found, plan/client-type breakdowns) are shown so an admin can spot
// a data-quality problem immediately, matching Freshservice's manual import
// pattern (DataSourcesFreshservice.jsx#ManualCsvImportCard).
function KiroCsvImportCard({ conn, onImported }) {
  const [pending, setPending] = useState(null) // { fileName, rows } | null
  const [importing, setImporting] = useState(false)

  function handlePicked(rows, meta) {
    const fileName = meta.files[0]?.fileName || 'upload.csv'
    setPending({ fileName, rows })
  }

  async function confirmImport() {
    setImporting(true)
    try {
      const r = await fetch('/api/kiro/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conn?.id, rows: pending.rows, fileName: pending.fileName })
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error((j.error || 'Import failed') + (j.reason ? `: ${j.reason}` : '') + ' — previous data retained.')
        return
      }
      const d = j.diagnostics || {}
      toast.success(`Kiro usage imported — ${(d.matchedRecords ?? 0).toLocaleString()} monthly user record(s) from ${pending.fileName}.`)
      setPending(null)
      await onImported()
    } finally {
      setImporting(false)
    }
  }

  const columns = pending ? Object.keys(pending.rows[0] || {}) : []
  const previewColumns = columns.slice(0, 6)
  const lastImport = conn?.lastManualImport

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Kiro Usage CSV Import</div>
      <div className="muted small" style={{ marginTop: 2, marginBottom: 8 }}>
        Import a Kiro usage export. Rows are grouped by user + month on the server (multiple rows for the same user/month are summed, never treated as separate licenses) and matched to the existing Microsoft 365 user directory by email — a Kiro import never creates a new person.
      </div>

      {!pending ? (
        <>
          <CsvImporter accept=".csv,.xlsx" label="Upload Kiro Usage CSV" onImport={handlePicked} />
          <div className="muted small" style={{ marginTop: 8 }}>
            Last import: {lastImport ? formatRelativeTime(lastImport.importedAt) : 'Never'}
            {lastImport && (
              <>
                {' '}&nbsp;·&nbsp; File: {lastImport.fileName}
                &nbsp;·&nbsp; Monthly records: {(lastImport.matchedRecords ?? 0).toLocaleString()}
                &nbsp;·&nbsp; Unique Kiro users in file: {(lastImport.uniqueUserIds ?? 0).toLocaleString()}
                {lastImport.unmatchedCount > 0 && <>&nbsp;·&nbsp; Unmatched emails: {lastImport.unmatchedCount.toLocaleString()}</>}
                {lastImport.invalidRows > 0 && <>&nbsp;·&nbsp; Invalid rows skipped: {lastImport.invalidRows.toLocaleString()}</>}
              </>
            )}
          </div>
          {lastImport?.monthsFound?.length > 0 && (
            <div className="muted small" style={{ marginTop: 4 }}>
              Months: {lastImport.monthsFound.join(', ')}
              {lastImport.planCounts && Object.keys(lastImport.planCounts).length > 0 && (
                <> &nbsp;·&nbsp; Plans: {Object.entries(lastImport.planCounts).map(([p, n]) => `${p} (${n})`).join(', ')}</>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ marginTop: 4 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Preview — {pending.fileName}</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div className="muted small">Raw rows found</div><strong>{pending.rows.length.toLocaleString()}</strong></div>
            <div><div className="muted small">Detected columns</div><strong>{columns.length}</strong></div>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>{columns.join(', ') || 'No columns detected'}</div>
          {previewColumns.length > 0 && (
            <div className="table" style={{ marginTop: 10, border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
              <table>
                <thead><tr>{previewColumns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {pending.rows.slice(0, 3).map((r, i) => (
                    <tr key={i}>{previewColumns.map((c) => <td key={c}>{r[c] === null || r[c] === undefined || r[c] === '' ? 'N/A' : String(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="button secondary" onClick={() => setPending(null)}><X size={14} /> Cancel</button>
            <button className="button primary" onClick={confirmImport} disabled={importing}><Check size={14} /> {importing ? 'Importing...' : 'Import'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DataSourcesKiro({ navigate, onImportGeneric, onDisconnect }) {
  const { connections, loading, error, refresh } = useConnections('kiro')
  const [showForm, setShowForm] = useState(false)
  const [method, setMethod] = useState('apiKey') // 'apiKey' | 'oauth'
  const [label, setLabel] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [headerName, setHeaderName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')
  const [scope, setScope] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function resetForm() {
    setLabel(''); setApiBaseUrl(''); setApiKey(''); setHeaderName('')
    setClientId(''); setClientSecret(''); setAuthorizationUrl(''); setTokenUrl(''); setScope('')
  }

  async function addApiKeyConnection() {
    if (!apiBaseUrl) { toast.error('Provide an API endpoint / report URL'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'kiro', authType: 'apiKey', label: label || 'Kiro', apiBaseUrl, apiKey, headerName })
      })
      const j = await r.json()
      if (!r.ok) { toast.error('Connection failed: ' + (j.error || 'unknown error')) }
      else toast.success(`Kiro connected — ${j.records ? j.records.length.toLocaleString() : 0} records.`)
      if (j.records && onImportGeneric && j.connection) onImportGeneric(j.connection.id, j.records)
      await refresh()
      if (r.ok) { setShowForm(false); resetForm() }
    } finally {
      setSubmitting(false)
    }
  }

  async function startOAuth() {
    if (!clientId || !clientSecret || !authorizationUrl || !tokenUrl || !apiBaseUrl) { toast.error('Fill in all OAuth fields'); return }
    const r = await fetch('/api/kiro/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || 'Kiro', clientId, clientSecret, authorizationUrl, tokenUrl, apiBaseUrl, scope })
    })
    const j = await r.json()
    if (!r.ok || !j.authUrl) { toast.error('Failed to start OAuth: ' + (j.error || 'unknown error')); return }
    const w = window.open(j.authUrl, 'kiro_oauth', 'width=900,height=700')
    const poll = setInterval(() => {
      refresh()
      if (w && w.closed) clearInterval(poll)
    }, 1500)
    setTimeout(() => clearInterval(poll), 120000)
  }

  async function syncConnection(id) {
    const r = await fetch(`/api/connections/${id}/sync`, { method: 'POST' })
    const j = await r.json()
    if (j.records && onImportGeneric) onImportGeneric(id, j.records)
    await refresh()
    if (!r.ok) toast.error('Sync failed: ' + (j.error || 'unknown error'))
    else toast.success(`Synced ${j.records ? j.records.length.toLocaleString() : 0} records.`)
  }

  async function disconnectConnection(id) {
    await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    if (onDisconnect) onDisconnect(id)
    await refresh()
    toast.info('Kiro account disconnected.')
  }

  async function removeCsvConnection(id, label) {
    if (!confirm(`Permanently remove "${label}"? This deletes the imported Kiro usage data, not just the connection.`)) return
    await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    if (onDisconnect) onDisconnect(id)
    await refresh()
    toast.info(`${label} removed.`)
  }

  const apiConnections = connections.filter((c) => c.kind !== 'csv')
  const csvConnections = connections.filter((c) => c.kind === 'csv')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <BrandLogo product="Kiro" size="md" />
        <h3 style={{ margin: 0 }}>Kiro</h3>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="muted small">{connections.length} account{connections.length === 1 ? '' : 's'} connected</div>
          <div>
            {navigate && <button className="button secondary" onClick={() => navigate('/data-sources')} style={{ marginRight: 8 }}><ArrowLeft size={16} /> Back</button>}
            <button className="button primary" onClick={() => setShowForm((s) => !s)}><Plus size={16} /> Add Kiro Account</button>
          </div>
        </div>

        {showForm && (
          <div style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              <label><input type="radio" checked={method === 'apiKey'} onChange={() => setMethod('apiKey')} /> API Key</label>
              <label><input type="radio" checked={method === 'oauth'} onChange={() => setMethod('oauth')} /> OAuth2</label>
            </div>
            <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
              <label>Label<input style={{ width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
              {method === 'apiKey' ? (
                <>
                  <label>API Endpoint / Report URL<input style={{ width: '100%' }} value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://api.kiro.dev/usage" /></label>
                  <label>API Key<input style={{ width: '100%' }} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
                  <label>Header name (optional — default Authorization: Bearer)<input style={{ width: '100%' }} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="e.g. X-Api-Key" /></label>
                  <div><button className="button primary" onClick={addApiKeyConnection} disabled={submitting}><Plug size={16} /> {submitting ? 'Connecting...' : 'Connect'}</button></div>
                </>
              ) : (
                <>
                  <label>API Endpoint (data to fetch after auth)<input style={{ width: '100%' }} value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} /></label>
                  <label>Client ID<input style={{ width: '100%' }} value={clientId} onChange={(e) => setClientId(e.target.value)} /></label>
                  <label>Client Secret<input style={{ width: '100%' }} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} /></label>
                  <label>Authorization URL<input style={{ width: '100%' }} value={authorizationUrl} onChange={(e) => setAuthorizationUrl(e.target.value)} /></label>
                  <label>Token URL<input style={{ width: '100%' }} value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} /></label>
                  <label>Scope (optional)<input style={{ width: '100%' }} value={scope} onChange={(e) => setScope(e.target.value)} /></label>
                  <div><button className="button primary" onClick={startOAuth}><Plug size={16} /> Authorize with Kiro</button></div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="muted">Loading...</div>
      ) : (
        <>
          {apiConnections.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              onSync={syncConnection}
              onDisconnect={disconnectConnection}
              extra={<div className="muted small">Method: {c.authType === 'oauth' ? 'OAuth2' : 'API Key'}</div>}
            />
          ))}

          {csvConnections.map((c) => (
            <div key={c.id}>
              <KiroCsvImportCard conn={c} onImported={refresh} />
              <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 12 }}>
                <button className="danger" onClick={() => removeCsvConnection(c.id, c.label)}><Unplug size={14} /> Remove</button>
              </div>
            </div>
          ))}

          {csvConnections.length === 0 && <KiroCsvImportCard conn={null} onImported={refresh} />}

          {connections.length === 0 && !showForm && (
            <div className="card muted" style={{ marginTop: 12 }}>No Kiro accounts connected yet. Connect an account above, or import a usage CSV below.</div>
          )}
        </>
      )}
      {error && <div style={{ color: '#a00' }}>{error}</div>}
    </div>
  )
}
