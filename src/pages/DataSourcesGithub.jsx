import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus, Plug } from 'lucide-react'
import useConnections from '../hooks/useConnections'
import ConnectionCard from '../components/ConnectionCard'
import toast from '../utils/toast'

// Production-readiness fix: vite.config.js now fails the production build
// outright if VITE_SERVER_BASE_URL is unset, so this fallback only ever
// runs in dev. It's kept dev-only (rather than defaulting to localhost
// unconditionally) so a build that somehow bypasses that guard still can't
// silently ship a bundle pointing every user's browser at localhost — an
// empty string here resolves the popup URL below relative to the current
// origin, which is exactly right for production (frontend and API are
// same-origin, server/index.js serves both).
const SERVER_BASE = (import.meta.env.VITE_SERVER_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')).replace(/\/$/, '')

export default function DataSourcesGithub({ navigate, onImportCopilot, onDisconnect }) {
  const { connections, loading, error, refresh } = useConnections('github')
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [org, setOrg] = useState('')
  const [enterprise, setEnterprise] = useState('')
  const [reportUrl, setReportUrl] = useState('')
  const pollRef = useRef(null)
  const watchdogRef = useRef(null)

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (watchdogRef.current) clearInterval(watchdogRef.current)
  }, [])

  function connect() {
    if (!org && !enterprise) { toast.error('Provide an organization or enterprise slug'); return }
    const params = new URLSearchParams({ label: label || org || enterprise, org, enterprise, reportUrl })
    const w = window.open(`${SERVER_BASE}/auth/github?${params.toString()}`, 'github_oauth', 'width=900,height=700')

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(refresh, 1500)

    if (watchdogRef.current) clearInterval(watchdogRef.current)
    const stopAt = Date.now() + 120000
    watchdogRef.current = setInterval(() => {
      if ((w && w.closed) || Date.now() > stopAt) {
        clearInterval(pollRef.current); pollRef.current = null
        clearInterval(watchdogRef.current); watchdogRef.current = null
        refresh()
        setShowForm(false); setLabel(''); setOrg(''); setEnterprise(''); setReportUrl('')
      }
    }, 1000)
  }

  async function syncConnection(id) {
    const r = await fetch(`/api/connections/${id}/sync`, { method: 'POST' })
    const j = await r.json()
    if (j.records && onImportCopilot) {
      try { onImportCopilot(id, j.records) } catch (e) { console.error('Import copilot failed', e) }
    }
    await refresh()
    if (!r.ok) toast.error('Sync failed: ' + (j.error || 'unknown error'))
    else toast.success(`Synced ${j.records ? j.records.length.toLocaleString() : 0} records.`)
  }

  async function disconnectConnection(id) {
    await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    if (onDisconnect) onDisconnect(id)
    await refresh()
    toast.info('GitHub account disconnected.')
  }

  return (
    <div>
      <h3>GitHub Copilot</h3>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted small">{connections.length} account{connections.length === 1 ? '' : 's'} connected</div>
          <div>
            <button className="button secondary" onClick={() => navigate('/data-sources')} style={{ marginRight: 8 }}><ArrowLeft size={16} /> Back</button>
            <button className="button primary" onClick={() => setShowForm((s) => !s)}><Plus size={16} /> Add GitHub Account</button>
          </div>
        </div>

        {showForm && (
          <div style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
            <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
              <label>Label (optional)<input style={{ width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme Corp" /></label>
              <label>Organization slug<input style={{ width: '100%' }} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="e.g. acme-inc" /></label>
              <label>— or Enterprise slug<input style={{ width: '100%' }} value={enterprise} onChange={(e) => setEnterprise(e.target.value)} placeholder="e.g. acme-enterprise" /></label>
              <label>Custom report URL (optional override)<input style={{ width: '100%' }} value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} placeholder="CSV export URL, if not using the Copilot seats API" /></label>
              <div><button className="button primary" onClick={connect}><Plug size={16} /> Authorize with GitHub</button></div>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="muted">Loading...</div>
      ) : connections.length === 0 ? (
        <div className="card muted">No GitHub accounts connected yet.</div>
      ) : connections.map((c) => (
        <ConnectionCard
          key={c.id}
          connection={c}
          onSync={syncConnection}
          onDisconnect={disconnectConnection}
          extra={
            <div className="muted small">
              {c.org ? `Org: ${c.org}` : c.enterprise ? `Enterprise: ${c.enterprise}` : ''}
              {c.login ? ` · Authorized as ${c.login}` : ''}
            </div>
          }
        />
      ))}
      {error && <div style={{ color: '#a00' }}>{error}</div>}
    </div>
  )
}
