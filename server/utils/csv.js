// Robust CSV parser (handles quoted fields, commas inside quotes, escaped quotes, newlines)
export function parseCsv(text) {
  if (!text) return []
  const rows = []
  let cur = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"'
        i++
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      row.push(cur)
      cur = ''
      continue
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') { /* skip, handled on \n */ }
      row.push(cur)
      cur = ''
      if (!(row.length === 1 && row[0] === '')) rows.push(row)
      row = []
      continue
    }
    cur += ch
  }
  if (cur !== '' || inQuotes) row.push(cur)
  if (row.length) rows.push(row)
  if (!rows.length) return []

  const headers = rows[0].map((h) => String(h || '').trim())
  const out = []
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    if (cols.length === 1 && String(cols[0] || '').trim() === '') continue
    const obj = {}
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < cols.length ? cols[c] : ''
    }
    out.push(obj)
  }
  return out
}
