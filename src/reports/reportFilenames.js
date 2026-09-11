export function sanitizeSegment(s) {
  return String(s).trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// For single-entity exports (one user, one application) rather than a
// filtered/complete dataset — no filter segments, just the entity's name.
export function buildEntityReportFilename({ prefix, name, ext }) {
  const dateStr = new Date().toISOString().slice(0, 10)
  return `${prefix}_${sanitizeSegment(name)}_${dateStr}.${ext}`
}

// Turns active filter values into short, filesystem-safe filename segments,
// e.g. { department: {values:['Engineering']}, usage_status: {values:['Low Activity']} }
// -> "Engineering_Low-Activity". Capped so filenames stay reasonable when many filters are active.
function filterSegments(filters, maxSegments = 4) {
  const segments = []
  for (const filter of Object.values(filters || {})) {
    if (!filter) continue
    if (filter.type === 'category') segments.push(...filter.values.map(sanitizeSegment))
    else segments.push(sanitizeSegment(filter.query || filter.op || filter.preset || 'filter'))
  }
  return segments.filter(Boolean).slice(0, maxSegments)
}

export function buildReportFilename({ prefix = 'Internal_IT_Usage_Report', scope, filters, ext }) {
  const dateStr = new Date().toISOString().slice(0, 10)
  if (scope !== 'filtered') return `${prefix}_Complete_${dateStr}.${ext}`
  const segments = filterSegments(filters)
  const suffix = segments.length ? segments.join('_') : 'Filtered'
  return `${prefix}_${suffix}_${dateStr}.${ext}`
}
