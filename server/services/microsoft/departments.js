// Pure aggregation over already-synced Users & Directory rows — no Graph
// call, no dedicated table (see db/index.js's schema comment). Department
// names are whatever Microsoft actually returned; nothing here invents one.
export function aggregateDepartments(users) {
  const map = new Map()
  for (const u of users) {
    const dept = u.department || 'Unknown'
    if (!map.has(dept)) map.set(dept, { department: dept, totalUsers: 0, activeUsers: 0 })
    const entry = map.get(dept)
    entry.totalUsers++
    if (u.account_enabled) entry.activeUsers++
  }
  return Array.from(map.values()).sort((a, b) => b.totalUsers - a.totalUsers)
}

export function aggregateDomains(users) {
  const map = new Map()
  for (const u of users) {
    const domain = u.domain || 'Unknown'
    if (!map.has(domain)) map.set(domain, { domain, totalUsers: 0, activeUsers: 0 })
    const entry = map.get(domain)
    entry.totalUsers++
    if (u.account_enabled) entry.activeUsers++
  }
  return Array.from(map.values()).sort((a, b) => b.totalUsers - a.totalUsers)
}
