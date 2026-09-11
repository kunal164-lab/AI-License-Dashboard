import React, { useState } from 'react'
import { ArrowLeft, Unplug, FileCheck2 } from 'lucide-react'
import CsvImporter from '../components/CsvImporter'
import ImportPreview from '../components/ImportPreview'
import StatusBadge from '../components/StatusBadge'
import { normalizeData } from '../utils/dataNormalizer'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import toast from '../utils/toast'

// Shared multi-file CSV/XLSX import screen for any manual (non-API) source —
// used for both Claude and generic "Other" imports.
export default function DataSourcesFileImport({ provider, navigate, csvSources, editId, onImport, onDisconnect }) {
  const existing = editId ? csvSources[editId] : null
  const [accountLabel, setAccountLabel] = useState(existing?.label || `${provider} Report`)
  const [fileMeta, setFileMeta] = useState([])
  const [rows, setRows] = useState(null)
  const [importing, setImporting] = useState(false)

  function handleFilesSelected(parsedRows, meta) {
    setFileMeta(meta.files || [])
    setRows(normalizeData(parsedRows))
  }

  function cancelPreview() {
    setRows(null)
    setFileMeta([])
  }

  function confirmImport() {
    setImporting(true)
    try {
      // When replacing an existing report, pass its backend connection id so
      // the server updates it in place; when adding a new one, omit the id
      // entirely and let the backend generate it.
      onImport({ id: editId || undefined, provider, sourceType: fileMeta[0]?.sourceType || 'csv', rows, label: accountLabel || provider })
      navigate('/data-sources')
    } finally {
      setImporting(false)
    }
  }

  function disconnect() {
    if (!editId) return
    if (!confirm(`Disconnect "${existing?.label || provider}"?`)) return
    onDisconnect(editId)
    navigate('/data-sources')
    toast.info(`${existing?.label || provider} disconnected.`)
  }

  return (
    <div>
      <h3>{provider} {editId ? '— Replace Report' : 'Import'}</h3>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>Status:</strong> <StatusBadge status={existing ? 'Connected' : 'Not Connected'} /></div>
            {existing && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Last Imported: {formatRelativeTime(existing.lastSync)} &nbsp;·&nbsp; Records: {existing.recordCount}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" onClick={() => navigate('/data-sources')}><ArrowLeft size={16} /> Back</button>
            {existing && <button className="danger" onClick={disconnect}><Unplug size={16} /> Disconnect</button>}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Account Name</label>
          <input style={{ width: 320 }} value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder={`e.g. SSP ${provider} Account`} />
        </div>

        <div style={{ marginTop: 16 }}>
          <CsvImporter
            multiple
            label={editId ? `Select Replacement Reports (CSV/XLSX)` : `Select ${provider} Reports (CSV/XLSX)`}
            onImport={handleFilesSelected}
          />
        </div>

        {fileMeta.length > 0 && (
          <div style={{ marginTop: 10 }} className="small">
            <div>Files selected: {fileMeta.length}</div>
            {fileMeta.map((f, i) => (
              <div key={i} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <FileCheck2 size={14} /> {f.fileName}
              </div>
            ))}
          </div>
        )}
      </div>

      {rows && (
        <ImportPreview files={fileMeta} rows={rows} importing={importing} onCancel={cancelPreview} onConfirm={confirmImport} />
      )}
    </div>
  )
}
