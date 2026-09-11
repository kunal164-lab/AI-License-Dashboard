import React, { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { exportDataset } from '../../utils/datasetExport'
import toast from '../../utils/toast'

// One unified "Export Report ▾" menu for the whole Microsoft 365 page
// (Part 13 of the redesign spec: no per-view export buttons scattered
// around the page) — reuses the exact same CSV/XLSX utility every other
// scoped export in the app already uses (src/utils/datasetExport.js) and
// the PDF engine already built for this page (pdfReport.js), never a
// second export framework.
//
// `currentView`: { key, label, filteredRows, allRows, columns } — the
// view the user is looking at right now; omitted (or its rows empty) when
// on Overview, where "current view" doesn't apply.
// `datasets`: [{ key, label, rows, columns }] — every dataset with real
// data, in report order, used for the "Specific Reports" section.
// `onDatasetPdf(dataset)`, `onCompleteReport()`: async format handlers.
function Row({ label, sub, onCsv, onXlsx, onPdf }) {
  return (
    <div className="m365-export-row">
      <div className="m365-export-row-label">
        {label}
        {sub && <span className="small muted" style={{ marginLeft: 6 }}>{sub}</span>}
      </div>
      <div className="m365-export-row-actions">
        {onCsv && <button className="m365-export-chip" onClick={onCsv}>CSV</button>}
        {onXlsx && <button className="m365-export-chip" onClick={onXlsx}>Excel</button>}
        {onPdf && <button className="m365-export-chip" onClick={onPdf}>PDF</button>}
      </div>
    </div>
  )
}

export default function Microsoft365ExportMenu({ currentView, datasets, onCompleteReport }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // `rows` are always the raw (unflattened) records also used by the
  // on-screen table — `columns` ({key,label} pairs, reusing the same
  // column defs each FilterableDataTable already has) describe how to
  // project them into plain, human-labeled objects for CSV/XLSX. Falls
  // back to the row as-is if no columns are given (e.g. a dataset that's
  // already flat).
  function flatten(rows, columns) {
    if (!columns) return rows
    return rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? 'N/A'])))
  }

  async function runCsvXlsx(rows, columns, format, label) {
    if (!rows || !rows.length) { toast.info('Nothing to export.'); return }
    try {
      const filename = exportDataset(flatten(rows, columns), format, { prefix: `Internal_IT_M365_${label.replace(/[^a-zA-Z0-9]+/g, '_')}`, sheetName: label })
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
    setOpen(false)
  }

  async function runDatasetPdf(dataset, rows, scope) {
    if (!rows || !rows.length) { toast.info('Nothing to export.'); return }
    try {
      const { downloadTabularDatasetPdf } = await import('../../reports/pdfReport.js')
      const filename = await downloadTabularDatasetPdf({
        title: dataset.label, columns: dataset.columns, rows, scope, filtersApplied: dataset.filtersApplied,
        sources: [{ label: 'Microsoft 365' }], filePrefix: `Internal_IT_M365_${dataset.label.replace(/[^a-zA-Z0-9]+/g, '_')}`
      })
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
    setOpen(false)
  }

  async function runCompleteReport() {
    setOpen(false)
    await onCompleteReport()
  }

  const showCurrentView = currentView && currentView.allRows && currentView.allRows.length > 0
  const filteredCount = currentView?.filteredRows?.length
  const allCount = currentView?.allRows?.length
  const isFiltered = showCurrentView && filteredCount !== undefined && filteredCount !== allCount

  return (
    <div className="dedicated-pages" ref={ref}>
      <button className="dedicated-pages-trigger" onClick={() => setOpen((o) => !o)}>
        <Download size={16} />
        Export Report
        <ChevronDown size={14} className={`dedicated-pages-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="m365-export-menu">
          {showCurrentView && (
            <div className="m365-export-section">
              <div className="m365-export-section-title">Current View — {currentView.label}</div>
              <Row
                label="Filtered" sub={isFiltered ? `${filteredCount.toLocaleString()} of ${allCount.toLocaleString()} records` : `${allCount.toLocaleString()} records (no filters active)`}
                onCsv={() => runCsvXlsx(currentView.filteredRows, currentView.columns, 'csv', `${currentView.label}_Filtered`)}
                onXlsx={() => runCsvXlsx(currentView.filteredRows, currentView.columns, 'xlsx', `${currentView.label}_Filtered`)}
                onPdf={currentView.columns ? () => runDatasetPdf({ label: `${currentView.label} (Filtered)`, columns: currentView.columns, filtersApplied: currentView.filtersApplied }, currentView.filteredRows, 'filtered') : undefined}
              />
              <Row
                label="Complete Dataset" sub={`${allCount.toLocaleString()} records — ignores active filters`}
                onCsv={() => runCsvXlsx(currentView.allRows, currentView.columns, 'csv', `${currentView.label}_Complete`)}
                onXlsx={() => runCsvXlsx(currentView.allRows, currentView.columns, 'xlsx', `${currentView.label}_Complete`)}
                onPdf={currentView.columns ? () => runDatasetPdf({ label: `${currentView.label} (Complete)`, columns: currentView.columns }, currentView.allRows, 'complete') : undefined}
              />
            </div>
          )}

          {datasets.length > 0 && (
            <div className="m365-export-section">
              <div className="m365-export-section-title">Specific Reports</div>
              {datasets.map((d) => (
                <Row
                  key={d.key} label={`${d.label} Report`} sub={`${d.rows.length.toLocaleString()} records`}
                  onCsv={() => runCsvXlsx(d.rows, d.columns, 'csv', d.label)}
                  onXlsx={() => runCsvXlsx(d.rows, d.columns, 'xlsx', d.label)}
                  onPdf={() => runDatasetPdf(d, d.rows, 'complete')}
                />
              ))}
            </div>
          )}

          <div className="m365-export-section">
            <div className="m365-export-section-title">Complete</div>
            <Row label="Complete Microsoft 365 Report" sub="Executive PDF summary across every dataset" onPdf={runCompleteReport} />
          </div>
        </div>
      )}
    </div>
  )
}
