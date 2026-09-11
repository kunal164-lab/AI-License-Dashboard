export function parseCsv(text) {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const rows = []
  let i = 0
  // find first non-empty line as header
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length) return []
  const headerLine = lines[i]
  const headers = parseCsvLine(headerLine)
  i++
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const parts = parseCsvLine(line)
    // if parts length < headers, try to join following lines (rare)
    if (parts.length < headers.length) continue
    const obj = {}
    for (let k = 0; k < headers.length; k++) {
      const key = headers[k]
      obj[key] = parts[k] === undefined || parts[k] === '' ? null : parts[k]
    }
    rows.push(obj)
  }
  return rows
}

function parseCsvLine(line) {
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result.map(s => s === null ? null : s.trim())
}
