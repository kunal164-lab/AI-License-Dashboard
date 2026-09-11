import React, { useEffect, useState } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import StatusBadge from '../StatusBadge'
import ExportMenu from '../ExportMenu'
import toast from '../../utils/toast'
import { buildUserReportModel } from '../../utils/microsoftReportModels'
import { licenseStatusLabel } from '../../utils/licenseStatus'

function Field({ label, value }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-word' }}>{value === null || value === undefined || value === '' ? 'N/A' : value}</div>
    </div>
  )
}
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>{children}</div>
    </div>
  )
}
function fmtDate(v) { if (!v) return 'N/A'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString() }

// Read-only user drill-down: profile, licenses, Copilot usage, devices
// (-> Device Detail), applications across those devices (-> Application
// Detail), and recent sign-in activity where available. Only real fields
// from Microsoft Graph / the central database — N/A everywhere else. VBU
// (onPremisesExtensionAttributes.extensionAttribute3) and Manager (a
// separate batched /users/{id}/manager fetch) are both real, synced fields
// — see server/services/microsoft/users.js.
export default function UserDetailModal({ userMsId, onClose, onBack, onNavigateToDevice, onNavigateToApplication }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null); setDetail(null)
    fetch(`/api/microsoft/users/${encodeURIComponent(userMsId)}`)
      .then((r) => { if (!r.ok) throw new Error('Failed to load user'); return r.json() })
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [userMsId])

  async function handleExport(format) {
    if (!detail) return
    const model = buildUserReportModel(detail)
    try {
      let filename
      if (format === 'csv') { const { downloadMicrosoftUserCsv } = await import('../../reports/csvReport.js'); filename = downloadMicrosoftUserCsv(model) }
      else if (format === 'xlsx') { const { downloadMicrosoftUserExcel } = await import('../../reports/excelReport.js'); filename = downloadMicrosoftUserExcel(model) }
      else { const { downloadMicrosoftUserPdf } = await import('../../reports/pdfReport.js'); filename = await downloadMicrosoftUserPdf(model) }
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
  }

  const p = detail?.user

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onBack && <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>}
            <div>
              <h3 style={{ margin: 0 }}>{p?.display_name || 'User'}</h3>
              <div className="muted small" style={{ marginTop: 2 }}>{p?.upn || 'N/A'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {detail && <ExportMenu label="Export User Details" onExport={handleExport} />}
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        {loading && <div className="muted" style={{ marginTop: 16 }}>Loading user details...</div>}
        {error && <div style={{ marginTop: 16, color: 'var(--bad)' }}>{error}</div>}

        {detail && (
          <>
            <Section title="Profile">
              <Field label="Job Title" value={p.job_title} />
              <Field label="Department" value={p.department} />
              <Field label="VBU / Organization" value={p.vbu} />
              <Field label="Manager" value={p.manager_display_name} />
              <Field label="Company" value={p.company_name} />
              <Field label="Office" value={p.office_location} />
              <Field label="Domain" value={p.domain} />
              <Field label="Account Status" value={<StatusBadge status={p.account_enabled ? 'Connected' : 'Needs attention'} />} />
            </Section>

            <Section title="Microsoft 365 Licenses">
              {detail.licenses.length === 0 ? <div className="muted small">No licenses assigned.</div> : (
                detail.licenses.map((l) => <Field key={l.sku_id} label="License" value={l.sku_part_number} />)
              )}
            </Section>

            <Section title="Microsoft 365 Copilot">
              {detail.copilot ? (
                <>
                  <Field label="License" value={licenseStatusLabel(detail.copilot)} />
                  {/* 'Premium' for any recognized Copilot SKU (confirmed
                      business rule — see server/services/microsoft/
                      copilotEntitlement.js) — the real SKU stays visible
                      separately as technical/audit metadata below. */}
                  <Field label="Plan" value={detail.copilot.plan} />
                  <Field label="SKU" value={detail.copilot.sku_part_number} />
                  <Field label="Usage Status" value={detail.copilot.usage_status} />
                  <Field label="Usage (Activity)" value={detail.copilot.activity_count} />
                  <Field label="Last Active" value={detail.copilot.last_activity} />
                  {Array.isArray(detail.copilot.service_plans) && detail.copilot.service_plans.length > 0 && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="small muted">Service Plans</div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>
                        {detail.copilot.service_plans.map((p) => `${p.servicePlanName}${p.capabilityStatus ? ` (${p.capabilityStatus})` : ''}`).join(', ')}
                      </div>
                    </div>
                  )}
                </>
              ) : <Field label="Microsoft 365 Copilot" value="No Copilot license or usage data" />}
            </Section>

            <Section title={`Devices (${detail.devices.length})`}>
              {detail.devices.length === 0 ? <div className="muted small">No devices assigned.</div> : (
                <div className="table" style={{ gridColumn: '1 / -1', border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Device</th><th>OS</th><th>Compliance</th><th>Last Sync</th></tr></thead>
                    <tbody>
                      {detail.devices.map((d) => (
                        <tr key={d.ms_id} className="clickable-row" onClick={() => onNavigateToDevice(d.ms_id)}>
                          <td><span className="link-text">{d.device_name || 'N/A'}</span></td>
                          <td>{d.operating_system || 'N/A'}</td>
                          <td>{d.compliance_state || 'N/A'}</td>
                          <td>{fmtDate(d.last_sync_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={`Applications (${detail.applications.length})`}>
              {detail.applications.length === 0 ? (
                <div className="muted small">{detail.applicationsError ? `Application data unavailable: ${detail.applicationsError}` : 'No application data available for this user\'s devices.'}</div>
              ) : (
                <div className="table" style={{ gridColumn: '1 / -1', border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Application</th><th>Version</th><th>Device(s)</th></tr></thead>
                    <tbody>
                      {detail.applications.map((a) => (
                        <tr key={a.ms_id} className="clickable-row" onClick={() => onNavigateToApplication(a.display_name)}>
                          <td><span className="link-text">{a.display_name || 'N/A'}</span></td>
                          <td>{a.version || 'N/A'}</td>
                          <td>{(a.devices || []).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {detail.signIns.length > 0 && (
              <Section title="Recent Sign-in Activity">
                <div className="table" style={{ gridColumn: '1 / -1', border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Time</th><th>Application</th><th>Status</th></tr></thead>
                    <tbody>
                      {detail.signIns.slice(0, 10).map((s) => (
                        <tr key={s.id}><td>{fmtDate(s.created_at)}</td><td>{s.app_display_name || 'N/A'}</td><td>{s.status || 'N/A'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
