import React, { useState } from 'react'
import { X, FileText, FileSpreadsheet, FileDown, Download } from 'lucide-react'

export default function ReportModal({ onClose, hasActiveFilters, filteredCount, totalCount, filtersDescription, onGenerate, title = 'Generate Report' }) {
  const [scope, setScope] = useState(hasActiveFilters ? 'filtered' : 'complete')
  const [format, setFormat] = useState('pdf')
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      await onGenerate(scope, format)
      onClose()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ width: 'min(520px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel-header">
          <h4 style={{ margin: 0 }}>{title}</h4>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <label className={`report-scope-option ${scope === 'filtered' ? 'selected' : ''} ${!hasActiveFilters ? 'disabled' : ''}`}>
            <input type="radio" checked={scope === 'filtered'} disabled={!hasActiveFilters} onChange={() => setScope('filtered')} />
            <div>
              <div style={{ fontWeight: 600 }}>Generate Report with Applied Filters</div>
              <div className="small muted">
                {hasActiveFilters
                  ? <>Current Filtered Data — {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} records{filtersDescription.length ? `: ${filtersDescription.join(', ')}` : ''}</>
                  : 'No filters are currently applied.'}
              </div>
            </div>
          </label>
          <label className={`report-scope-option ${scope === 'complete' ? 'selected' : ''}`}>
            <input type="radio" checked={scope === 'complete'} onChange={() => setScope('complete')} />
            <div>
              <div style={{ fontWeight: 600 }}>Generate Complete Report</div>
              <div className="small muted">Complete Dataset — all {totalCount.toLocaleString()} available records, ignoring current filters.</div>
            </div>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Format</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`quick-filter-btn ${format === 'pdf' ? 'active' : ''}`} onClick={() => setFormat('pdf')}><FileText size={14} /> PDF</button>
            <button className={`quick-filter-btn ${format === 'excel' ? 'active' : ''}`} onClick={() => setFormat('excel')}><FileSpreadsheet size={14} /> Excel</button>
            <button className={`quick-filter-btn ${format === 'csv' ? 'active' : ''}`} onClick={() => setFormat('csv')}><FileDown size={14} /> CSV</button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={handleGenerate} disabled={generating}>
            <Download size={16} /> {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
