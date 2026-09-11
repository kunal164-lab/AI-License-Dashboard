import React, { useEffect, useState } from 'react'
import { ArrowLeft, Plug, RefreshCw, Unplug, AlertTriangle, CloudOff, X, Check } from 'lucide-react'
import useConnections from '../hooks/useConnections'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import CsvImporter from '../components/CsvImporter'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import toast from '../utils/toast'

// Freshservice supports TWO independent ingestion methods — the
// administrator picks exactly one; they are never merged. Both borrow the
// SAME existing Microsoft 365 connection (ms_group for live Graph group
// membership; manual_csv purely for identity matching against the
// canonical Microsoft population — no separate Freshservice credentials
// are ever required by either). A third method, automatic SharePoint CSV,
// existed previously and was removed entirely: unreliable SharePoint
// app-only permissions/authentication made it fail in practice. Manual CSV
// Upload replaces it as the current non-Graph method; a different
// automated source is planned for later.
//
// Manual CSV Upload does NOT go through a "Connect" button — the CSV picker
// (ManualCsvUploadPanel) is shown inline, and a single "Import CSV" click
// both creates the Freshservice connection (if it doesn't exist yet — the
// self-provisioning /api/freshservice/import-csv route handles that
// server-side) and imports the file. ms_group still requires an explicit
// Connect click because it needs a real Graph group lookup first (see the
// /api/connections dispatch in server/index.js).
function ConnectForm({ msConnections, onSubmit, submitting, onImported }) {
  const [method, setMethod] = useState('ms_group')
  const [msConnectionId, setMsConnectionId] = useState(msConnections[0]?.id || '')
  const [securityGroupName, setSecurityGroupName] = useState('')

  useEffect(() => {
    if (!msConnectionId && msConnections[0]) setMsConnectionId(msConnections[0].id)
  }, [msConnections]) // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    onSubmit({ sourceMethod: 'ms_group', msConnectionId, securityGroupName: securityGroupName.trim() })
  }

  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
      <div style={{ display: 'grid', gap: 10, maxWidth: 560 }}>
        <div className="small" style={{ fontWeight: 600 }}>Source Method</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="fs-method" checked={method === 'ms_group'} onChange={() => setMethod('ms_group')} />
            Microsoft 365 Security Group
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="fs-method" checked={method === 'manual_csv'} onChange={() => setMethod('manual_csv')} />
            Manual CSV Upload
          </label>
        </div>

        {msConnections.length > 1 && (
          <label>Microsoft 365 connection
            <select style={{ width: '100%' }} value={msConnectionId} onChange={(e) => setMsConnectionId(e.target.value)}>
              {msConnections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        {msConnections.length === 0 && (
          <div className="small" style={{ color: 'var(--bad)' }}>
            Microsoft 365 connection is required for Freshservice. Connect one first (Data Sources → Microsoft 365).
          </div>
        )}

        {method === 'ms_group' ? (
          <>
            <label>Security Group Name
              <input
                style={{ width: '100%' }} value={securityGroupName} onChange={(e) => setSecurityGroupName(e.target.value)}
                placeholder="e.g. Freshservice Agents"
              />
            </label>
            <div>
              <button className="button primary" disabled={submitting || !securityGroupName.trim() || !msConnectionId} onClick={submit}>
                <Plug size={16} /> {submitting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </>
        ) : (
          msConnectionId && (
            <ManualCsvUploadPanel
              connId={null}
              msConnectionId={msConnectionId}
              lastImport={null}
              agentCount={0}
              onImported={onImported}
            />
          )
        )}
      </div>
    </div>
  )
}

// Shown only when the server reported more than one Microsoft 365 security
// group with the exact same display name (never silently pick one). The
// administrator picks the real one; that choice is re-submitted with its
// Graph group id attached.
function GroupPicker({ groups, onPick, onCancel, submitting }) {
  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--bad)', borderRadius: 8 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
        Multiple security groups share this name. Select the correct one:
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {groups.map((g) => (
          <button key={g.id} className="button secondary" style={{ justifyContent: 'flex-start', textAlign: 'left' }} disabled={submitting} onClick={() => onPick(g)}>
            <div>
              <div style={{ fontWeight: 600 }}>{g.displayName}</div>
              {g.description && <div className="small muted">{g.description}</div>}
              <div className="small muted">{g.id}</div>
            </div>
          </button>
        ))}
      </div>
      <button className="button secondary" style={{ marginTop: 8 }} onClick={onCancel} disabled={submitting}>Cancel</button>
    </div>
  )
}

// Freshservice records whose email doesn't match a canonical Microsoft 365
// user are never silently discarded (and never create a canonical user —
// see src/utils/freshserviceNormalizer.js#buildFreshserviceAgentImport) —
// they're kept here for manual investigation. Prefers the just-completed
// import's own result (freshest) and falls back to the connection's last
// persisted import (so this stays visible across a page reload, not just
// in the same browser session). Only rendered fields; never re-used for
// matching (identity is normalized email only, decided at import time).
function UnmatchedUsersSection({ unmatchedUsers }) {
  const [expanded, setExpanded] = useState(false)
  const users = unmatchedUsers || []
  if (!users.length) return null

  return (
    <div style={{ marginTop: 10 }}>
      <button className="button secondary" onClick={() => setExpanded((v) => !v)}>
        {expanded ? '▾' : '▸'} Unmatched Users ({users.length.toLocaleString()})
      </button>
      {expanded && (
        <div className="table" style={{ marginTop: 8, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Freshservice Name</th>
                <th>Freshservice Email</th>
                <th>User Type</th>
                <th>Job Title</th>
                <th>VBU</th>
                <th>Function Unit</th>
                <th>Division</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.email || i}>
                  <td>{u.name || 'N/A'}</td>
                  <td>{u.email}</td>
                  <td>{u.userType || 'N/A'}</td>
                  <td>{u.jobTitle || 'N/A'}</td>
                  <td>{u.vbu || 'N/A'}</td>
                  <td>{u.functionUnit || 'N/A'}</td>
                  <td>{u.division || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small" style={{ marginTop: 6 }}>
        These Freshservice agents have no matching current Microsoft 365 user (matched by normalized email only) — they are excluded from the Freshservice agent count and never create a new canonical user. Review why each one exists in Freshservice but not Microsoft 365.
      </div>
    </div>
  )
}

// Reuses the same CsvImporter file picker/parseCsv every other CSV import
// in this app uses; the preview/validate/import round-trip goes through
// the exact safe-import flow (server's /import-csv route ->
// server/services/freshservice/sync.js#importFreshserviceCsv), so an
// invalid file is rejected with a clear reason and never touches the
// previously successful dataset. The import result shows exactly what the
// spec asks for — every number computed from the uploaded file, never
// hardcoded: CSV rows, Agent rows, unique Agent emails, matched/unmatched
// Microsoft users, and duplicate rows.
//
// Used in TWO places with identical UI: before a Freshservice connection
// exists (connId=null, msConnectionId=the chosen Microsoft 365 connection)
// and after one exists (connId=<real id>, msConnectionId unused). Either
// way, Import CSV is a SINGLE request to the self-provisioning
// /api/freshservice/import-csv route (no separate "create the connection
// first" step) — this is what makes the file picker "immediately visible"
// per the UX fix, and it's also what guarantees the Microsoft 365 Security
// Group method's securityGroupName validation (a completely different route
// branch, POST /api/connections) can never be reached from this flow.
function ManualCsvUploadPanel({ connId, msConnectionId, lastImport, agentCount, onImported }) {
  const [pending, setPending] = useState(null) // { fileName, rows } | null
  const [importing, setImporting] = useState(false)
  const [lastResult, setLastResult] = useState(null) // diagnostics from the most recent import in THIS session

  function handlePicked(rows, meta) {
    const fileName = meta.files[0]?.fileName || 'upload.csv'
    setPending({ fileName, rows })
    setLastResult(null)
  }

  async function confirmImport() {
    setImporting(true)
    try {
      const r = await fetch('/api/freshservice/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: connId || undefined, msConnectionId: msConnectionId || undefined, rows: pending.rows, fileName: pending.fileName })
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error((j.error || 'Import failed') + (j.reason ? `: ${j.reason}` : '') + ' — previous data retained.')
        return
      }
      toast.success(`Freshservice import completed — ${j.recordCount.toLocaleString()} agent(s) matched from ${pending.fileName}.`)
      setLastResult(j.diagnostics || null)
      setPending(null)
      await onImported()
    } finally {
      setImporting(false)
    }
  }

  const columns = pending ? Object.keys(pending.rows[0] || {}) : []
  const previewColumns = columns.slice(0, 6)

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-title">Manual CSV Upload</div>
      <div className="muted small" style={{ marginTop: 2, marginBottom: 10 }}>
        Upload the latest Freshservice agent export to update Freshservice agent assignments. Only rows where User Type is "Agent" are counted; matching is by email against existing Microsoft 365 users.
      </div>

      {!pending ? (
        <>
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Freshservice Agent CSV</div>
          <CsvImporter accept=".csv,.xlsx" label="Choose CSV File" onImport={handlePicked} />
          <div className="muted small" style={{ marginTop: 8 }}>
            Last successful import: {lastImport ? formatRelativeTime(lastImport.importedAt) : 'Never'}
            {lastImport && (
              <> &nbsp;·&nbsp; File: {lastImport.fileName} &nbsp;·&nbsp; Freshservice Agents: {(lastImport.matchedCount ?? agentCount ?? 0).toLocaleString()}
                {lastImport.unmatchedCount > 0 && <> &nbsp;·&nbsp; Unmatched: {lastImport.unmatchedCount.toLocaleString()}</>}
              </>
            )}
          </div>

          {lastResult && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="card-title">Freshservice Import Completed</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, marginTop: 8 }}>
                <div><div className="muted small">CSV rows</div><strong>{lastResult.csvRows.toLocaleString()}</strong></div>
                <div><div className="muted small">Agent rows</div><strong>{lastResult.agentRows.toLocaleString()}</strong></div>
                <div><div className="muted small">Unique Agent emails</div><strong>{lastResult.uniqueAgentEmails.toLocaleString()}</strong></div>
                <div><div className="muted small">Matched Microsoft users</div><strong>{lastResult.matchedCount.toLocaleString()}</strong></div>
                <div><div className="muted small">Unmatched</div><strong>{lastResult.unmatchedCount.toLocaleString()}</strong></div>
                <div><div className="muted small">Duplicates</div><strong>{lastResult.duplicateRows.toLocaleString()}</strong></div>
              </div>
            </div>
          )}

          <UnmatchedUsersSection unmatchedUsers={(lastResult || lastImport)?.unmatchedUsers} />
        </>
      ) : (
        <div className="card" style={{ marginTop: 4 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Selected file — {pending.fileName}</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div className="muted small">Records found</div><strong>{pending.rows.length.toLocaleString()}</strong></div>
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
            <button className="button primary" onClick={confirmImport} disabled={importing}><Check size={14} /> {importing ? 'Importing...' : 'Import CSV'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DataSourcesFreshservice({ navigate, onDisconnect }) {
  const { connections, loading, error, refresh } = useConnections('freshservice')
  const [msConnections, setMsConnections] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [multipleGroups, setMultipleGroups] = useState(null) // {form, groups} | null

  useEffect(() => {
    fetch('/api/connections?source=microsoft').then((r) => r.json()).then((j) => setMsConnections(j.connections || [])).catch(() => {})
  }, [])

  async function submitConnect(form) {
    setSubmitting(true)
    try {
      const r = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'freshservice', ...form })
      })
      const j = await r.json()
      if (!r.ok) {
        if (r.status === 409 && Array.isArray(j.multipleGroups)) {
          setMultipleGroups({ form, groups: j.multipleGroups })
          return
        }
        toast.error(j.error || 'Connection failed')
        // The connection row is created (and immediately tested) server-
        // side BEFORE this response is even sent, so the resulting card
        // (with its real, specific error/status) must still be shown —
        // never leave the Connect form re-rendering as if nothing happened.
        await refresh()
        return
      }
      setMultipleGroups(null)
      if (j.skipped) toast.info('Freshservice connected. Upload a CSV below to import agents.')
      else if ((j.agentCount ?? 0) === 0) toast.info('Connected successfully. No Freshservice agents were found.')
      else toast.success(`Freshservice connected — ${j.agentCount.toLocaleString()} agent(s) found.`)
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function pickGroup(group) {
    await submitConnect({ ...multipleGroups.form, securityGroupId: group.id })
  }

  async function syncConnection(id) {
    setBusyId(id)
    try {
      const r = await fetch(`/api/connections/${id}/sync`, { method: 'POST' })
      const j = await r.json()
      await refresh()
      if (!r.ok) toast.error('Refresh failed: ' + (j.error || 'unknown error') + ' — previous agent data retained.')
      else if (j.skipped) toast.info(j.reason || 'Skipped.')
      else if ((j.agentCount ?? 0) === 0) toast.info('Refreshed. No Freshservice agents were found.')
      else toast.success(`Freshservice refreshed — ${j.agentCount.toLocaleString()} agent(s) found.`)
    } finally {
      setBusyId(null)
    }
  }

  // Disconnecting removes only THIS Freshservice configuration and its
  // current agent/product data — Microsoft 365 itself, its users, and every
  // other Microsoft 365 dataset are completely untouched, regardless of
  // which method was active.
  async function disconnect(conn) {
    const configLabel = conn.sourceMethod === 'manual_csv' ? 'Manual CSV Upload' : (conn.securityGroupName || 'security group')
    if (!confirm(`Disconnect Freshservice? This removes the "${configLabel}" configuration and its agent data. Microsoft 365 itself is not affected.`)) return
    setBusyId(conn.id)
    try {
      await fetch(`/api/connections/${conn.id}`, { method: 'DELETE' })
      if (onDisconnect) onDisconnect(conn.id)
      await refresh()
      toast.info('Freshservice disconnected.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h3>Freshservice</h3>
      <div className="muted small" style={{ marginTop: -8, marginBottom: 12 }}>Agent data · Microsoft 365 Security Group or Manual CSV Upload</div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="muted small">
            Choose exactly one Freshservice source method. Both reuse your existing Microsoft 365 connection — no separate Freshservice credentials are ever required.
          </div>
          {navigate && <button className="button secondary" onClick={() => navigate('/data-sources')}><ArrowLeft size={16} /> Back</button>}
        </div>

        {connections.length === 0 && !loading && (
          multipleGroups ? (
            <GroupPicker groups={multipleGroups.groups} onPick={pickGroup} onCancel={() => setMultipleGroups(null)} submitting={submitting} />
          ) : (
            <ConnectForm
              msConnections={msConnections}
              onSubmit={submitConnect}
              submitting={submitting}
              onImported={refresh}
            />
          )
        )}
      </div>

      {loading ? (
        <div className="muted">Loading...</div>
      ) : connections.length === 0 ? (
        <div className="card">
          <EmptyState icon={CloudOff} title="Freshservice not connected" hint="Choose a source method above — Manual CSV Upload lets you pick a file right away, no Connect step required." />
        </div>
      ) : connections.map((c) => {
        const isManual = c.sourceMethod === 'manual_csv'
        const notYetImported = isManual && c.status !== 'connected' && c.status !== 'error'
        const statusLabel = busyId === c.id ? 'Syncing' : notYetImported ? 'Not Imported' : c.status === 'connected' ? 'Connected' : c.status === 'error' ? 'Needs attention' : 'Pending'
        return (
          <div key={c.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{c.label}</strong>
                <div className="muted small">
                  Method: {isManual ? 'Manual CSV Upload' : 'Microsoft 365 Security Group'}
                  {!isManual && <> &nbsp;·&nbsp; Security Group: {c.securityGroupName || 'N/A'}</>}
                </div>
              </div>
              <StatusBadge status={statusLabel} spin={busyId === c.id} />
            </div>

            <div className="muted small" style={{ marginTop: 8 }}>
              Agents: {(c.agentCount ?? 0).toLocaleString()} &nbsp;·&nbsp;
              Last Successful {isManual ? 'Import' : 'Sync'}: {c.lastSync ? formatRelativeTime(c.lastSync) : 'Never'} &nbsp;·&nbsp;
              Last Attempt: {c.lastAttempt ? formatRelativeTime(c.lastAttempt) : 'N/A'}
            </div>
            {c.status === 'error' && (
              <div className="small" style={{ color: 'var(--bad)', marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{c.lastError || 'Sync failed.'} Showing agent data from the last successful sync{c.lastSync ? ` (${formatRelativeTime(c.lastSync)})` : ''}.</span>
              </div>
            )}

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isManual && (
                <button className="button" onClick={() => syncConnection(c.id)} disabled={busyId === c.id}>
                  <RefreshCw size={14} className={busyId === c.id ? 'spin' : ''} /> {busyId === c.id ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
              <button className="button secondary" onClick={() => disconnect(c)} disabled={busyId === c.id}>
                <Unplug size={14} /> Disconnect
              </button>
            </div>

            {isManual && (
              <ManualCsvUploadPanel
                connId={c.id}
                msConnectionId={null}
                lastImport={c.lastManualImport}
                agentCount={c.agentCount}
                onImported={refresh}
              />
            )}
          </div>
        )
      })}
      {error && <div style={{ color: '#a00' }}>{error}</div>}
    </div>
  )
}
