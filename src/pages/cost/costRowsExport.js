import * as XLSX from 'xlsx'
import { buildEntityReportFilename, buildReportFilename } from '../../reports/reportFilenames'
import { downloadBlob } from '../../reports/downloadFile'
import { neutralizeFormula } from '../../reports/formulaSafety'

// Scoped CSV/XLSX export for a single Cost Analytics drill-down (Part 24 —
// "the user should be able to export the current perspective"). Reuses the
// same downloadBlob/filename utilities every other scoped export in the app
// already uses (Freshservice agents, Applications inventory) — not a new
// reporting engine, just a tabular dump of the rows already loaded for this
// entity. PDF isn't offered here; the page-level "Generate Report" button
// (buildCostReportModel, the shared report engine) covers that.
export function toPlainRows(rows) {
  return rows.map((r) => ({
    User: r.user_name || 'N/A', Email: r.user_email || 'N/A', Department: r.department || 'N/A',
    VBU: r.vbu || 'N/A', Domain: r.domain || 'N/A', Provider: r.provider || 'N/A',
    Product: r.product || 'N/A', Plan: r.plan || 'N/A', 'License Status': r.license_status || 'N/A',
    'Usage Status': r.usage_status || 'N/A',
    'Monthly Cost': r.display_cost ?? 'N/A',
    'Annualized Cost': r.annual_cost ?? (typeof r.display_cost === 'number' ? Math.round(r.display_cost * 12 * 100) / 100 : 'N/A'),
    'Potential Monthly Savings': r.potential_monthly_savings ?? 'N/A',
    Currency: r.display_currency || 'N/A',
    'Cost Type': r.cost_label || 'N/A', Source: r._source || 'N/A'
  }))
}

// `entityName` (original shape, single-entity filename e.g. "VBU_Sales") or
// `scope`+`filters` (the newer filtered/complete-dataset filename shape
// every other page's export menu already uses — see reportFilenames.js) —
// exactly one of the two should be passed.
export function exportCostRows(rows, format, { entityName, sheetName = 'Cost', scope, filters } = {}) {
  // Security-audit fix (CSV/Excel formula injection, CWE-1236) — User/
  // Email/Department/VBU/etc. below are directory-sourced, the same field
  // class src/reports/csvReport.js and excelReport.js already neutralize.
  const data = toPlainRows(rows || []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, neutralizeFormula(v)])))
  function filename(ext) {
    return entityName !== undefined
      ? buildEntityReportFilename({ prefix: 'Internal_IT_Cost', name: entityName, ext })
      : buildReportFilename({ prefix: 'Internal_IT_Cost', scope, filters, ext })
  }
  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheetName.slice(0, 31) || 'Cost')
    const name = filename('xlsx')
    downloadBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), name)
    return name
  }
  // Default to CSV for anything else (matches the app's other scoped
  // exports, which only ever offer csv/xlsx for a single-entity dataset).
  const keys = Object.keys(data[0] || { User: '' })
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"'
  const csv = [keys.join(','), ...data.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
  const name = filename('csv')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), name)
  return name
}
