import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, Plug, RefreshCw, Unplug, Settings, CheckCircle2, AlertTriangle, Clock, XCircle, Info, Timer } from 'lucide-react'
import useConnections from '../hooks/useConnections'
import toast from '../utils/toast'

// Icon + tone for a capability's current sync status — mirrors the
// StatusBadge conventions used everywhere else in the app. Statuses come
// from the backend's buildCapabilityStatus(): not_implemented, ready
// (enabled, never synced), synced, no_data (synced fine, 0 rows),
// permission_missing, throttled, error. "Synced" only ever appears after a
// real successful Graph sync — never assumed.
function statusMeta(status, implemented) {
  if (!implemented) return { Icon: Clock, tone: 'muted', text: 'Not yet implemented' }
  if (status === 'synced') return { Icon: CheckCircle2, tone: 'good', text: 'Synced' }
  if (status === 'no_data') return { Icon: Info, tone: 'muted', text: 'No data returned' }
  if (status === 'permission_missing') return { Icon: AlertTriangle, tone: 'bad', text: 'Permission required' }
  if (status === 'throttled') return { Icon: Timer, tone: 'warn', text: 'Throttled — retry on next sync' }
  if (status === 'error') return { Icon: XCircle, tone: 'bad', text: 'Sync failed' }
  return { Icon: Clock, tone: 'muted', text: 'Ready' }
}

function CapabilityCheckboxList({ registry, selected, onToggle }) {
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      {registry.map((cap) => (
        <label key={cap.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, opacity: cap.implemented ? 1 : 0.55 }}>
          <input
            type="checkbox"
            checked={selected.includes(cap.key)}
            disabled={!cap.implemented}
            onChange={() => onToggle(cap.key)}
            style={{ marginTop: 3 }}
          />
          <span>
            <div style={{ fontWeight: 600 }}>{cap.label}{!cap.implemented && <span className="muted small"> (coming soon)</span>}</div>
            <div className="muted small">{cap.description}</div>
            <div className="muted small">Required permission(s): {cap.permissions.join(', ')}</div>
          </span>
        </label>
      ))}
    </div>
  )
}

function CapabilityStatusRow({ status }) {
  const { Icon, tone, text } = statusMeta(status.status, status.implemented)
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted)'
  const isError = status.status === 'error' || status.status === 'permission_missing' || status.status === 'throttled'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 4 }}>
      <Icon size={14} color={color} />
      <span style={{ minWidth: 170 }}>{status.label}</span>
      <span style={{ color }}>{text}</span>
      {status.recordCount != null && (status.status === 'synced' || status.status === 'no_data') && <span className="muted">· {status.recordCount.toLocaleString()} records</span>}
      {status.error && isError && <span className="muted" title={status.error}> — {status.error.length > 70 ? status.error.slice(0, 70) + '…' : status.error}</span>}
    </div>
  )
}

export default function DataSourcesMicrosoft({ navigate, onImportMicrosoft, onDisconnect }) {
  const { connections, loading, error, refresh } = useConnections('microsoft')
  const [registry, setRegistry] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [period, setPeriod] = useState('D7')
  const [signInsDays, setSignInsDays] = useState(30)
  const [selectedCapabilities, setSelectedCapabilities] = useState(['copilot'])
  const [submitting, setSubmitting] = useState(false)
  const [configuringId, setConfiguringId] = useState(null)
  const [configCapabilities, setConfigCapabilities] = useState([])
  const [configSignInsDays, setConfigSignInsDays] = useState(30)
  const [savingConfig, setSavingConfig] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    fetch('/api/microsoft/capabilities').then((r) => r.json()).then((j) => setRegistry(j.capabilities || [])).catch(() => {})
  }, [])

  const implementedKeys = useMemo(() => registry.filter((c) => c.implemented).map((c) => c.key), [registry])

  function toggleCapability(list, setList, key) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
  }

  async function addConnection() {
    if (!tenantId || !clientId || !clientSecret) { toast.error('Tenant ID, Client ID and Client Secret are required'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'microsoft', authType: 'client_credentials', label: label || 'Microsoft 365',
          tenantId, clientId, clientSecret, period, capabilities: selectedCapabilities, signInsDays
        })
      })
      const j = await r.json()
      if (!r.ok) { toast.error('Connection failed: ' + (j.error || 'unknown error')) }
      else toast.success(`Microsoft 365 connected — ${(j.capabilityResults?.copilot?.count || 0).toLocaleString()} Copilot records.`)
      if (j.records && onImportMicrosoft && j.connection) onImportMicrosoft(j.connection.id, j.records)
      await refresh()
      if (r.ok) { setShowForm(false); setLabel(''); setTenantId(''); setClientId(''); setClientSecret(''); setSelectedCapabilities(['copilot']) }
    } finally {
      setSubmitting(false)
    }
  }

  function startConfigure(conn) {
    setConfiguringId(conn.id)
    setConfigCapabilities(conn.capabilities || ['copilot'])
    setConfigSignInsDays(conn.signInsDays || 30)
  }

  async function saveConfigure(id) {
    setSavingConfig(true)
    try {
      const r = await fetch(`/api/connections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: configCapabilities, signInsDays: configSignInsDays })
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error('Failed to update capabilities: ' + (j.error || 'unknown error')); return }
      toast.success('Capabilities updated — syncing now.')
      setConfiguringId(null)
      await syncConnection(id)
    } finally {
      setSavingConfig(false)
    }
  }

  async function syncConnection(id) {
    setBusyId(id)
    try {
      const r = await fetch(`/api/connections/${id}/sync`, { method: 'POST' })
      const j = await r.json()
      if (j.records && onImportMicrosoft) onImportMicrosoft(id, j.records)
      await refresh()
      if (!r.ok) toast.error('Sync failed: ' + (j.error || 'unknown error'))
      else toast.success('Microsoft 365 sync complete.')
    } finally {
      setBusyId(null)
    }
  }

  async function disconnectConnection(id) {
    if (!confirm('Disconnect this Microsoft 365 connection?')) return
    await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    if (onDisconnect) onDisconnect(id)
    await refresh()
    toast.info('Microsoft 365 tenant disconnected.')
  }

  return (
    <div>
      <h3>Microsoft 365</h3>
      <div className="muted small" style={{ marginTop: -8, marginBottom: 12 }}>Microsoft Graph</div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted small">{connections.length} tenant{connections.length === 1 ? '' : 's'} connected</div>
          <div>
            {navigate && <button className="button secondary" onClick={() => navigate('/data-sources')} style={{ marginRight: 8 }}><ArrowLeft size={16} /> Back</button>}
            <button className="button primary" onClick={() => setShowForm((s) => !s)}><Plus size={16} /> Add Microsoft 365 Tenant</button>
          </div>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Requires an Azure AD app registration with application permissions granted per capability below (admin consent required for each).
        </div>

        {showForm && (
          <div style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
            <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
              <label>Label (optional)<input style={{ width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme Corp Tenant" /></label>
              <label>Tenant ID<input style={{ width: '100%' }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="GUID or contoso.onmicrosoft.com" /></label>
              <label>Client ID (Application ID)<input style={{ width: '100%' }} value={clientId} onChange={(e) => setClientId(e.target.value)} /></label>
              <label>Client Secret<input style={{ width: '100%' }} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} /></label>
              <label>Copilot Report Period
                <select style={{ width: '100%' }} value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="D7">Last 7 days</option>
                  <option value="D30">Last 30 days</option>
                  <option value="D90">Last 90 days</option>
                  <option value="D180">Last 180 days</option>
                  <option value="ALL">All time</option>
                </select>
              </label>
              <label>Sign-in Activity Period (days)
                <input
                  type="number" min={1} max={90} style={{ width: '100%' }}
                  value={signInsDays} onChange={(e) => setSignInsDays(Number(e.target.value) || 30)}
                />
                <div className="muted small">Only used if "Sign-in / Activity Data" is selected below. Capped at 90 days; each sync after the first only fetches new sign-ins.</div>
              </label>

              <div style={{ marginTop: 4 }}>
                <strong>Select the Microsoft 365 data this connection is allowed to synchronize.</strong>
                <CapabilityCheckboxList registry={registry} selected={selectedCapabilities} onToggle={(k) => toggleCapability(selectedCapabilities, setSelectedCapabilities, k)} />
              </div>

              <div><button className="button primary" onClick={addConnection} disabled={submitting}><Plug size={16} /> {submitting ? 'Connecting...' : 'Connect'}</button></div>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="muted">Loading...</div>
      ) : connections.length === 0 ? (
        <div className="card muted">No Microsoft 365 tenants connected yet.</div>
      ) : connections.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{c.label}</strong>
              <div className="muted small">{c.tenantId ? `Tenant: ${c.tenantId}` : ''}{c.period ? ` · Copilot period: ${c.period}` : ''}</div>
            </div>
            <span style={{ color: c.status === 'connected' ? 'var(--good)' : c.status === 'error' ? 'var(--bad)' : 'var(--muted)', fontWeight: 600, fontSize: 13 }}>
              {busyId === c.id ? 'Syncing…' : c.status === 'connected' ? 'Connected' : c.status === 'error' ? 'Needs attention' : 'Pending'}
            </span>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', fontSize: 11 }}>Capabilities</div>
            {(c.capabilityStatus || []).map((s) => <CapabilityStatusRow key={s.key} status={s} />)}
          </div>

          {configuringId === c.id ? (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
              <strong>Select the Microsoft 365 data this connection is allowed to synchronize.</strong>
              <CapabilityCheckboxList registry={registry} selected={configCapabilities} onToggle={(k) => toggleCapability(configCapabilities, setConfigCapabilities, k)} />
              {configCapabilities.includes('signins') && (
                <label style={{ display: 'block', marginTop: 8, maxWidth: 260 }}>Sign-in Activity Period (days)
                  <input
                    type="number" min={1} max={90} style={{ width: '100%' }}
                    value={configSignInsDays} onChange={(e) => setConfigSignInsDays(Number(e.target.value) || 30)}
                  />
                </label>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button className="button primary" onClick={() => saveConfigure(c.id)} disabled={savingConfig}>{savingConfig ? 'Saving...' : 'Save & Sync'}</button>
                <button className="button secondary" onClick={() => setConfiguringId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="button" onClick={() => syncConnection(c.id)} disabled={busyId === c.id}>
                <RefreshCw size={14} className={busyId === c.id ? 'spin' : ''} /> {busyId === c.id ? 'Syncing...' : 'Sync Now'}
              </button>
              <button className="button secondary" onClick={() => startConfigure(c)}><Settings size={14} /> Configure</button>
              <button className="danger" onClick={() => disconnectConnection(c.id)}><Unplug size={14} /> Disconnect</button>
            </div>
          )}
        </div>
      ))}
      {error && <div style={{ color: '#a00' }}>{error}</div>}
      {navigate && (
        <div className="muted small" style={{ marginTop: 12 }}>
          To configure Microsoft 365 Copilot (or any other product's) pricing, use{' '}
          <button className="link-button" onClick={() => navigate('/cost')}>Cost</button> in the main menu.
        </div>
      )}
    </div>
  )
}
