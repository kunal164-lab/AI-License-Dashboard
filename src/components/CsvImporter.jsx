import React from 'react'
import * as XLSX from 'xlsx'
import { Upload } from 'lucide-react'
import { parseCsv } from '../utils/csvParser'
import toast from '../utils/toast'

// Reads one or more CSV/XLSX files and hands back a single combined array of
// parsed row objects (never raw text) plus per-file metadata, so callers can
// treat "one file" and "many files selected at once" identically.
function readOneFile(f) {
  return new Promise((resolve, reject) => {
    const name = f.name.toLowerCase()
    if (name.endsWith('.csv')) {
      const reader = new FileReader()
      reader.onload = () => resolve({ fileName: f.name, sourceType: 'csv', rows: parseCsv(reader.result || '') })
      reader.onerror = () => reject(new Error('Failed to read ' + f.name))
      reader.readAsText(f)
      return
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
          resolve({ fileName: f.name, sourceType: 'xlsx', rows: parseCsv(csv) })
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read ' + f.name))
      reader.readAsArrayBuffer(f)
      return
    }
    reject(new Error('Unsupported file type: ' + f.name))
  })
}

export default function CsvImporter({ onImport, accept = '.csv,.xlsx,.xls', label = 'Import CSV / XLSX', multiple = false }) {
  async function handleFiles(e) {
    const fileList = Array.from(e.target.files || [])
    if (!fileList.length) return
    try {
      const results = await Promise.all(fileList.map(readOneFile))
      const rows = results.flatMap((r) => r.rows)
      onImport(rows, { files: results.map((r) => ({ fileName: r.fileName, sourceType: r.sourceType, recordCount: r.rows.length })) })
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Failed to read one or more files.')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="import-area">
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Upload size={14} /> {label}</label>
      <input type="file" accept={accept} multiple={multiple} onChange={handleFiles} />
    </div>
  )
}
