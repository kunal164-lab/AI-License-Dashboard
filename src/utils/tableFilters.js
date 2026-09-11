// Pure, framework-free filtering/sorting engine shared by the Users page's
// Excel-like filter bar, its per-column header popovers, and DataTable's
// sorting. Kept separate (and dependency-free) so it's directly reusable by
// a future Reports/export feature: allUsers -> applyFilters -> reportData.

export function displayValue(v) {
  return (v === null || v === undefined || v === '') ? 'N/A' : String(v)
}

// filter shapes:
//   category: { type:'category', values: string[] }        — matches against displayValue()
//   number:   { type:'number', op, value, value2? }         — op: gt|gte|lt|lte|eq|between
//   date:     { type:'date', preset, days? }                 — preset: today|7|30|90|moreThan
//   text:     { type:'text', query }                         — case-insensitive contains
export function matchesColumnFilter(row, key, filter) {
  if (!filter) return true
  if (filter.type === 'search') return matchesSearch(row, filter)
  const raw = row[key]
  // A canonical user's product/provider/plan/license_status are arrays
  // (one person can have several) — match if ANY element satisfies the
  // filter, reusing the exact same scalar logic per element rather than a
  // second filtering system for multi-valued columns.
  if (Array.isArray(raw)) {
    if (!raw.length) return filter.type === 'category' ? !filter.values || !filter.values.length : false
    return raw.some((v) => matchesColumnFilter({ [key]: v }, key, filter))
  }
  if (filter.type === 'category') {
    if (!filter.values || !filter.values.length) return true
    return filter.values.includes(displayValue(raw))
  }
  if (filter.type === 'number') {
    const n = raw === null || raw === undefined || raw === '' ? null : Number(raw)
    if (n === null || Number.isNaN(n)) return false
    switch (filter.op) {
      case 'gt': return n > filter.value
      case 'gte': return n >= filter.value
      case 'lt': return n < filter.value
      case 'lte': return n <= filter.value
      case 'eq': return n === filter.value
      case 'between': return filter.value2 !== null && filter.value2 !== undefined && n >= filter.value && n <= filter.value2
      default: return true
    }
  }
  if (filter.type === 'date') {
    if (!raw) return false
    const t = new Date(raw).getTime()
    if (Number.isNaN(t)) return false
    const days = (Date.now() - t) / 86400000
    if (filter.preset === 'today') return days <= 1
    if (filter.preset === '7') return days <= 7
    if (filter.preset === '30') return days <= 30
    if (filter.preset === '90') return days <= 90
    if (filter.preset === 'moreThan') return days >= (filter.days || 0)
    return true
  }
  if (filter.type === 'text') {
    if (!filter.query) return true
    return String(raw ?? '').toLowerCase().includes(filter.query.toLowerCase())
  }
  return true
}

// 'search' is the one filter type that isn't scoped to a single column — it
// matches across several fields at once (e.g. name/email/product) and is
// stored under a dedicated key (conventionally '__search') so the global
// free-text search box is just another entry in the same filter object as
// every column filter, KPI click, and chart click.
function matchesSearch(row, filter) {
  if (!filter || filter.type !== 'search' || !filter.query) return true
  const q = filter.query.toLowerCase()
  return (filter.fields || []).some((f) => String(row[f] ?? '').toLowerCase().includes(q))
}

// excludeKey lets a column's own popover compute "available values" against
// every OTHER active filter (real Excel-style cascading filter lists).
export function passesFilters(row, filters, excludeKey) {
  return Object.entries(filters).every(([k, f]) => (k === excludeKey ? true : matchesColumnFilter(row, k, f)))
}

export function applyFilters(rows, filters) {
  return rows.filter((r) => passesFilters(r, filters))
}

export function uniqueValuesFor(rows, key, filters, excludeKey) {
  const base = filters ? rows.filter((r) => passesFilters(r, filters, excludeKey)) : rows
  const values = new Set()
  for (const r of base) {
    const raw = r[key]
    if (Array.isArray(raw)) {
      if (!raw.length) values.add(displayValue(null))
      else raw.forEach((v) => values.add(displayValue(v)))
    } else {
      values.add(displayValue(raw))
    }
  }
  return Array.from(values).sort()
}

// Type-aware comparator for sorting — empty/N/A values always sort last
// regardless of direction, and numbers/dates never fall back to string sort.
export function compareValues(a, b, type) {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (type === 'number') {
    const an = Number(a), bn = Number(b)
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0
    if (Number.isNaN(an)) return 1
    if (Number.isNaN(bn)) return -1
    return an - bn
  }
  if (type === 'date') {
    const at = new Date(a).getTime(), bt = new Date(b).getTime()
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return 1
    if (Number.isNaN(bt)) return -1
    return at - bt
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
}

export function filterLabel(column, filter) {
  if (filter.type === 'search') return `Search: "${filter.query}"`
  if (filter.type === 'category') return `${column.name}: ${filter.values.join(', ')}`
  if (filter.type === 'number') {
    const opLabel = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', between: 'between' }[filter.op] || filter.op
    return filter.op === 'between' ? `${column.name}: ${filter.value}–${filter.value2}` : `${column.name} ${opLabel} ${filter.value}`
  }
  if (filter.type === 'date') {
    const presetLabels = { today: 'Today', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', moreThan: `More than ${filter.days} days ago` }
    return `${column.name}: ${presetLabels[filter.preset] || filter.preset}`
  }
  return `${column.name}: "${filter.query}"`
}

// Human-readable summary of every active filter, keyed against a column
// registry — used identically by the active-filter chips and the report
// engine's "Filters Applied" section, so they can never drift apart.
export function describeFilters(filters, columnByKey) {
  return Object.entries(filters || {})
    .filter(([, f]) => f)
    .map(([key, f]) => filterLabel((columnByKey && columnByKey[key]) || { name: key }, f))
}
