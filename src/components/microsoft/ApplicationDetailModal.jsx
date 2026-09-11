import React, { useEffect, useMemo, useState } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import ExportMenu from '../ExportMenu'
import BrandLogo from '../BrandLogo'
import toast from '../../utils/toast'
import { buildApplicationReportModel } from '../../utils/microsoftReportModels'

function fmtDate(v) { if (!v) return 'N/A'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString() }

// Read-only application drill-down: overview, real version breakdown
// (Intune's detectedApps API stores one row per name+version combination —
// "an application" here means every row sharing this display name), and
// the devices it's actually detected on where that linkage has been
// synced or could be fetched on demand (see server/services/microsoft/
// detail.js — device linkage is bounded per request to avoid throttling a
// tenant with thousands of application/version rows).
export default function ApplicationDetailModal({ applicationName, onClose, onBack, onNavigateToDevice, onNavigateToUser }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [linkageLoading, setLinkageLoading] = useState(false)

  // Two-phase load: the summary (versions + whatever device linkage is
  // already cached) returns instantly since it never makes a live Graph
  // call. Only if it reports more linkage is available do we then fetch it
  // in the background — the modal is already fully usable by that point,
  // it just quietly gains more Device Installation Details rows once the
  // second call resolves. This replaces the old single request that used
  // to block the whole modal behind up to 40 sequential Graph calls.
  useEffect(() => {
    setLoading(true); setError(null); setDetail(null); setLinkageLoading(false)
    fetch(`/api/microsoft/applications/${encodeURIComponent(applicationName)}`)
      .then((r) => { if (!r.ok) throw new Error('Failed to load application'); return r.json() })
      .then((summary) => {
        setDetail(summary)
        setLoading(false)
        if (summary?.linkageCoverage?.canFetchMore) {
          setLinkageLoading(true)
          fetch(`/api/microsoft/applications/${encodeURIComponent(applicationName)}/linkage`)
            .then((r) => { if (!r.ok) throw new Error('Failed to load device linkage'); return r.json() })
            .then(setDetail)
            .catch(() => {}) // the summary already rendered fine; a failed background enrichment isn't fatal
            .finally(() => setLinkageLoading(false))
        }
      })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [applicationName])

  async function handleExport(format) {
    if (!detail) return
    const model = buildApplicationReportModel(detail)
    try {
      let filename
      if (format === 'csv') { const { downloadMicrosoftApplicationCsv } = await import('../../reports/csvReport.js'); filename = downloadMicrosoftApplicationCsv(model) }
      else if (format === 'xlsx') { const { downloadMicrosoftApplicationExcel } = await import('../../reports/excelReport.js'); filename = downloadMicrosoftApplicationExcel(model) }
      else { const { downloadMicrosoftApplicationPdf } = await import('../../reports/pdfReport.js'); filename = await downloadMicrosoftApplicationPdf(model) }
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
  }

  const s = detail?.summary
  const coverage = detail?.linkageCoverage

  // Users section: grouped from the same device-linkage rows already
  // fetched for Device Installation Details — no separate data source, no
  // duplicate users (a device with no linked user is simply excluded here,
  // never guessed).
  const userRows = useMemo(() => {
    if (!detail) return []
    const map = new Map()
    for (const d of detail.devices) {
      if (!d.user_principal_name) continue
      const key = d.user_principal_name.toLowerCase()
      if (!map.has(key)) map.set(key, { upn: d.user_principal_name, userMsId: d.user_ms_id || null, department: d.department || null, deviceCount: 0, versions: new Set() })
      const u = map.get(key)
      u.deviceCount += 1
      if (d.application_version) u.versions.add(d.application_version)
    }
    return Array.from(map.values()).map((u) => ({ ...u, versions: Array.from(u.versions) })).sort((a, b) => b.deviceCount - a.deviceCount)
  }, [detail])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onBack && <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>}
            {s && <BrandLogo publisher={s.publishers?.[0]} size="md" />}
            <div>
              <h3 style={{ margin: 0 }}>{applicationName}</h3>
              <div className="muted small" style={{ marginTop: 2 }}>{s ? `${s.totalDeviceCount.toLocaleString()} device installs across ${s.versionCount} version(s)` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {detail && <ExportMenu label="Export Application Details" onExport={handleExport} />}
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        {loading && <div className="muted" style={{ marginTop: 16 }}>Loading application details...</div>}
        {error && <div style={{ marginTop: 16, color: 'var(--bad)' }}>{error}</div>}

        {detail && (
          <>
            <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 16 }}>
              <div className="kpi"><div className="card-title">Total Installs</div><div className="kpi-value">{s.totalDeviceCount.toLocaleString()}</div></div>
              <div className="kpi"><div className="card-title">Unique Devices Linked</div><div className="kpi-value">{s.uniqueLinkedDeviceCount.toLocaleString()}</div></div>
              <div className="kpi"><div className="card-title">Versions Detected</div><div className="kpi-value">{s.versionCount}</div></div>
              <div className="kpi"><div className="card-title">Publisher</div><div className="kpi-value" style={{ fontSize: 15 }}>{s.publishers.join(', ') || 'N/A'}</div></div>
              <div className="kpi"><div className="card-title">Platform</div><div className="kpi-value" style={{ fontSize: 15 }}>{s.platforms.join(', ') || 'N/A'}</div></div>
              <div className="kpi"><div className="card-title">Last Synced</div><div className="kpi-value" style={{ fontSize: 13 }}>{fmtDate(s.lastSyncedAt)}</div></div>
            </div>

            {coverage && coverage.linkedVersions < coverage.totalVersions && (
              <div className="small muted" style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 6 }}>
                {linkageLoading
                  ? `Fetching device linkage for the remaining ${coverage.totalVersions - coverage.linkedVersions} version(s) from Microsoft Graph...`
                  : `Device-level linkage available for ${coverage.linkedVersions} of ${coverage.totalVersions} versions.`}
                {coverage.error ? ` Could not fetch the remaining versions right now: ${coverage.error}` : ''}
                {coverage.truncated ? ' Some versions were skipped to limit Graph API calls in a single request — reopen this application later to continue linking.' : ''}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>Version Breakdown</div>
              <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Version</th><th>Device Count</th><th>Percentage</th></tr></thead>
                  <tbody>
                    {detail.versions.map((v) => (
                      <tr key={v.ms_id}><td>{v.version || 'N/A'}</td><td>{v.deviceCount.toLocaleString()}</td><td>{v.percentage != null ? v.percentage + '%' : 'N/A'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>Device Installation Details ({detail.devices.length})</div>
              {detail.devices.length === 0 ? (
                <div className="muted small">No device-level installation records linked yet for this application.</div>
              ) : (
                <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Device</th><th>Version</th><th>User</th><th>Department</th><th>OS</th><th>Compliance</th><th>Management</th><th>Last Sync</th></tr></thead>
                    <tbody>
                      {detail.devices.map((d, i) => (
                        <tr key={i} className={d.device_name ? 'clickable-row' : ''} onClick={() => d.device_name && onNavigateToDevice(d.device_ms_id)}>
                          <td>{d.device_name ? <span className="link-text">{d.device_name}</span> : 'N/A'}</td>
                          <td>{d.application_version || 'N/A'}</td>
                          <td>{d.user_principal_name || 'N/A'}</td>
                          <td>{d.department || 'N/A'}</td>
                          <td>{d.operating_system || 'N/A'}</td>
                          <td>{d.compliance_state || 'N/A'}</td>
                          <td>{d.management_state || 'N/A'}</td>
                          <td>{fmtDate(d.last_sync_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {userRows.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="card-title" style={{ marginBottom: 8 }}>Users ({userRows.length})</div>
                <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>User</th><th>Department</th><th>Devices</th><th>Version(s)</th></tr></thead>
                    <tbody>
                      {userRows.map((u) => (
                        <tr key={u.upn} className={u.userMsId ? 'clickable-row' : ''} onClick={() => u.userMsId && onNavigateToUser && onNavigateToUser(u.userMsId)}>
                          <td>{u.userMsId ? <span className="link-text">{u.upn}</span> : u.upn}</td>
                          <td>{u.department || 'N/A'}</td>
                          <td>{u.deviceCount}</td>
                          <td>{u.versions.join(', ') || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
