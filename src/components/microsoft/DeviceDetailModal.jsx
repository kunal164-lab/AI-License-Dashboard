import React, { useEffect, useState } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import StatusBadge from '../StatusBadge'

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

// Read-only device drill-down: device info, its assigned user (-> User
// Detail), and applications installed on it (live via Graph beta — see
// server/services/microsoft/devices.js for why v1.0 can't provide this).
export default function DeviceDetailModal({ deviceMsId, onClose, onBack, onNavigateToUser, onNavigateToApplication }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null); setDetail(null)
    fetch(`/api/microsoft/devices/${encodeURIComponent(deviceMsId)}`)
      .then((r) => { if (!r.ok) throw new Error('Failed to load device'); return r.json() })
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [deviceMsId])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onBack && <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>}
            <div>
              <h3 style={{ margin: 0 }}>{detail?.device?.device_name || 'Device'}</h3>
              <div className="muted small" style={{ marginTop: 2 }}>{detail?.device?.user_principal_name || 'N/A'}</div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {loading && <div className="muted" style={{ marginTop: 16 }}>Loading device details...</div>}
        {error && <div style={{ marginTop: 16, color: 'var(--bad)' }}>{error}</div>}

        {detail && (
          <>
            <Section title="Device Information">
              <Field label="Operating System" value={detail.device.operating_system} />
              <Field label="OS Version" value={detail.device.os_version} />
              <Field label="Manufacturer" value={detail.device.manufacturer} />
              <Field label="Model" value={detail.device.model} />
              <Field label="Serial Number" value={detail.device.serial_number} />
              <Field label="Ownership" value={detail.device.owner_type} />
              <Field label="Compliance State" value={<StatusBadge status={detail.device.compliance_state === 'compliant' ? 'Active' : 'Needs attention'} />} />
              <Field label="Management State" value={detail.device.management_state} />
              <Field label="Management Agent" value={detail.device.management_agent} />
              <Field label="Enrolled" value={fmtDate(detail.device.enrolled_at)} />
              <Field label="Last Sync" value={fmtDate(detail.device.last_sync_at)} />
              <Field label="Storage (Free / Total)" value={detail.device.total_storage_bytes ? `${(detail.device.free_storage_bytes / 1e9).toFixed(1)} / ${(detail.device.total_storage_bytes / 1e9).toFixed(1)} GB` : 'N/A'} />
            </Section>

            <Section title="Assigned User">
              {detail.user ? (
                <>
                  <Field label="Name" value={<button className="link-text" onClick={() => onNavigateToUser(detail.user.ms_id)}>{detail.user.display_name}</button>} />
                  <Field label="Email / UPN" value={detail.user.upn} />
                  <Field label="Department" value={detail.user.department} />
                </>
              ) : <Field label="Assigned User" value="N/A" />}
            </Section>

            <Section title={`Applications (${detail.applications.length})`}>
              {detail.applications.length === 0 ? (
                <div className="muted small">{detail.applicationsError ? `Application data unavailable: ${detail.applicationsError}` : 'No applications detected on this device.'}</div>
              ) : (
                <div className="table" style={{ gridColumn: '1 / -1', border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Application</th><th>Version</th><th>Publisher</th></tr></thead>
                    <tbody>
                      {detail.applications.map((a) => (
                        <tr key={a.ms_id} className="clickable-row" onClick={() => onNavigateToApplication(a.display_name)}>
                          <td><span className="link-text">{a.display_name || 'N/A'}</span></td>
                          <td>{a.version || 'N/A'}</td>
                          <td>{a.publisher || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
