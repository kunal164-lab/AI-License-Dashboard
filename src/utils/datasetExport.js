import * as XLSX from 'xlsx'
import { buildReportFilename } from '../reports/reportFilenames'
import { downloadBlob } from '../reports/downloadFile'

// Shared CSV/XLSX export for "export this table's current (possibly
// filtered) rows" actions — the same downloadBlob/filename utilities every
// other scoped export in the app already uses (Freshservice agents,
// Applications inventory, Cost Analytics drill-downs), not a new export
// engine. `rows` should already be plain objects with the exact column
// names/order wanted in the file (map before calling this).
export function exportDataset(rows, format, { prefix, scope = 'complete', filters = {}, sheetName = 'Data' }) {
  const data = rows || []
  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheetName.slice(0, 31) || 'Data')
    const filename = buildReportFilename({ prefix, scope, filters, ext: 'xlsx' })
    downloadBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), filename)
    return filename
  }
  const keys = Object.keys(data[0] || {})
  const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'
  const csv = [keys.join(','), ...data.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
  const filename = buildReportFilename({ prefix, scope, filters, ext: 'csv' })
  downloadBlob(new Blob([csv], { type: 'text/csv' }), filename)
  return filename
}
