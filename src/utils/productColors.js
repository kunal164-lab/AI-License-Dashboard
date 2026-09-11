// One consistent color + short label per AI product, reused across every
// chart and badge in the app so the same product always looks the same.
const MAP = {
  'Claude Code': { color: '#0b5fff', short: 'Claude Code' },
  'Claude Chat': { color: '#7c3aed', short: 'Claude Chat' },
  'Claude': { color: '#0b5fff', short: 'Claude' },
  'GitHub Copilot': { color: '#059669', short: 'GitHub Copilot' },
  'Kiro': { color: '#f97316', short: 'Kiro' },
  'Microsoft Copilot': { color: '#0891b2', short: 'Microsoft Copilot' },
  'Microsoft 365': { color: '#0891b2', short: 'Microsoft 365' },
  'Other': { color: '#64748b', short: 'Other' }
}
const FALLBACK_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b']

export function colorForProduct(product) {
  if (MAP[product]) return MAP[product].color
  // Stable fallback: hash the name into the fallback palette so an unknown
  // product still gets a consistent (not random-per-render) color.
  const key = String(product || 'Unknown')
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

export function labelForProduct(product) {
  return (MAP[product] && MAP[product].short) || product || 'Unknown'
}

export default { colorForProduct, labelForProduct }
