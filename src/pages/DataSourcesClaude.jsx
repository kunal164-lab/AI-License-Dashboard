import React, { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Play, Square, AlertTriangle, Check, X, KeyRound } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import CsvImporter from '../components/CsvImporter'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import toast from '../utils/toast'

// The automatic Claude source is a SINGLE, server-configured connection —
// folder URL and expected file name (Claude_Spend_MTD.csv) are hardcoded
// server-side (server/index.js) and deliberately not editable here (Part 1
// of the spec this implements). There is no "Add Account" form on this
// page at all, unlike every other Data Sources page — just status, and the
// three controls the spec asks for (Refresh Now / Start / Stop).
function claudeStatusLabel(source, busy) {
  if (busy) return 'Running'
  if (!source || !source.configured) return 'Never synced'
  if (source.connection.enabled === false) return 'Stopped'
  if (!source.lastSuccessfulSync) return source.lastError ? 'Failed' : 'Never synced'
  if (source.connection.status === 'error') return 'Failed'
  return 'Connected'
}

export default function DataSourcesClaude({ navigate, onDataChanged }) {
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lastResultMessage, setLastResultMessage] = useState(null)
  // The password never lives anywhere but this one input's local state,
  // and only until the moment it's submitted — never persisted to
  // localStorage/sessionStorage, never included in any GET response (the
  // backend only ever tells us `passwordConfigured: true/false`), cleared
  // immediately on a successful save.
  const [passwordInput, setPasswordInput] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  function refresh() {
    return fetch('/api/claude/source').then((r) => r.json()).then(setSource).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  async function refreshNow() {
    setBusy(true)
    setLastResultMessage(null)
    try {
      const r = await fetch('/api/claude/refresh', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      setLastResultMessage({ ok: r.ok && j.success, text: j.message || (r.ok ? 'Refreshed.' : 'Refresh failed.') })
      if (r.ok && j.success) toast.success(j.message || 'Claude refreshed.')
      else toast.error(j.message || j.error || 'Claude refresh failed.')
      await refresh()
      if (onDataChanged) await onDataChanged()
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setBusy(true)
    try {
      await fetch('/api/claude/start', { method: 'POST' })
      await refresh()
      toast.success('Claude automatic source started.')
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!confirm('Stop the automatic Claude MTD source? This stops future scheduled refreshes. Existing imported Claude data will be preserved.')) return
    setBusy(true)
    try {
      await fetch('/api/claude/stop', { method: 'POST' })
      await refresh()
      toast.info('Claude automatic source stopped. Existing data preserved.')
    } finally {
      setBusy(false)
    }
  }

  async function savePassword() {
    if (!passwordInput) { toast.error('Enter the share-link password.'); return }
    setSavingPassword(true)
    try {
      const r = await fetch('/api/claude/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error || 'Failed to save password.'); return }
      setPasswordInput('')
      await refresh()
      toast.success('Share-link password saved.')
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleManualImport(rows, meta) {
    const fileName = meta.files[0]?.fileName || 'upload.csv'
    setBusy(true)
    try {
      const r = await fetch('/api/claude/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, fileName })
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error((j.error || 'Import failed') + (j.reason ? `: ${j.reason}` : '') + ' — previous data retained.')
        return
      }
      toast.success(`Claude MTD CSV imported — ${(j.diagnostics?.matchedRecords ?? 0).toLocaleString()} record(s) from ${fileName}.`)
      await refresh()
      if (onDataChanged) await onDataChanged()
    } finally {
      setBusy(false)
    }
  }

  const label = claudeStatusLabel(source, busy)
  const enabled = source?.connection?.enabled !== false

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          {navigate && <button className="button secondary" onClick={() => navigate('/data-sources')} style={{ marginBottom: 8 }}><ArrowLeft size={16} /> Back</button>}
          <h3 style={{ margin: 0 }}>Claude</h3>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading...</div>
      ) : (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Automatic Source</div>
              <div className="muted small" style={{ marginTop: 2 }}>
                OneDrive / SharePoint &nbsp;·&nbsp; File: Claude_Spend_MTD.csv &nbsp;·&nbsp; Schedule: Daily &nbsp;·&nbsp; Reporting: MTD Snapshot
              </div>
            </div>
            <StatusBadge status={label} spin={busy} />
          </div>

          <div className="muted small" style={{ marginTop: 10 }}>
            Last checked: {source?.lastChecked ? formatRelativeTime(source.lastChecked) : 'Never'}
            &nbsp;·&nbsp; Last successful sync: {source?.lastSuccessfulSync ? formatRelativeTime(source.lastSuccessfulSync) : 'Never'}
            <br />
            Records: {(source?.recordCount ?? 0).toLocaleString()} &nbsp;·&nbsp; Users: {(source?.uniqueUserCount ?? 0).toLocaleString()}
            <br />
            Password: {source?.passwordConfigured ? 'Configured' : 'Not configured'}
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border, #eee)' }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Share-link password</label>
            <div className="muted small" style={{ marginBottom: 6 }}>
              The password required by the configured SharePoint/OneDrive share link. Stored encrypted server-side — it is never shown again after saving.
            </div>
            <div style={{ display: 'flex', gap: 8, maxWidth: 360 }}>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={source?.passwordConfigured ? 'Enter a new password to replace it' : 'Enter share-link password'}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="button secondary" onClick={savePassword} disabled={savingPassword || !passwordInput}>
                <KeyRound size={14} /> {savingPassword ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {source?.lastError && (
            <div className="small" style={{ color: 'var(--bad)', marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Refresh failed. Previous successful data is still being used.{source.lastError ? ` (${source.lastError})` : ''}</span>
            </div>
          )}
          {lastResultMessage && (
            <div className="small" style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 6, color: lastResultMessage.ok ? 'var(--good)' : 'var(--bad)' }}>
              {lastResultMessage.ok ? <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} /> : <X size={14} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>{lastResultMessage.text}</span>
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button" onClick={refreshNow} disabled={busy}>
              <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Refreshing...' : 'Refresh Now'}
            </button>
            {enabled ? (
              <button className="button secondary" onClick={stop} disabled={busy}><Square size={14} /> Stop</button>
            ) : (
              <button className="button secondary" onClick={start} disabled={busy}><Play size={14} /> Start</button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 13 }}>Manual CSV Import</div>
        <div className="muted small" style={{ marginTop: 2, marginBottom: 8 }}>
          Use a Claude MTD CSV export as a fallback when the automatic OneDrive/SharePoint source is unavailable. This is still an MTD snapshot, not historical daily data — importing replaces the current Claude dataset, it does not add to it.
        </div>
        <CsvImporter accept=".csv,.xlsx" label="Upload Claude MTD CSV" onImport={handleManualImport} />
        {source?.connection?.lastManualImport && (
          <div className="muted small" style={{ marginTop: 8 }}>
            Last manual import: {formatRelativeTime(source.connection.lastManualImport.importedAt)}
            &nbsp;·&nbsp; File: {source.connection.lastManualImport.fileName}
            &nbsp;·&nbsp; Records: {source.connection.lastManualImport.recordCount?.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
