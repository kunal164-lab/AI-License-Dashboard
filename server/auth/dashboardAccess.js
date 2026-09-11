// Filtering used by GET /api/dashboard and GET /api/users/:id/detail to
// keep the shared, cross-provider dataset scoped to what the caller's
// allowedPages actually grants. Before this existed, both routes only sat
// behind the blanket requireAuth (any authenticated user with SOME access
// at all) with no per-page check, so a role scoped to a single page like
// 'kiro' could read the full company-wide dashboard or any other
// provider's per-user detail — the exact cross-page exposure the rest of
// this app's page-scoped RBAC model exists to prevent.

// A caller with any of these page keys is trusted to see the FULL
// cross-provider dataset — Users/Products/Cost/Optimization/Overview/
// Application Inventory/Reports are all deliberately designed to show one
// canonical person's data across every connected vendor at once (that
// consolidation is the whole point of those pages), so granting any one of
// them is an explicit choice to grant that broader view.
export const CROSS_PROVIDER_PAGES = ['dashboard', 'users', 'products', 'applications', 'cost', 'optimization', 'reports']

// Connection source -> the single dedicated page key that alone grants
// visibility into it, for a caller who lacks every CROSS_PROVIDER_PAGES
// key. GitHub has no dedicated page of its own (unlike Kiro/Freshservice/
// Claude/Microsoft 365, each of which does), so it's reachable only
// through one of the cross-provider pages above.
export const PROVIDER_PAGE_KEY = { microsoft: 'microsoft-365', freshservice: 'freshservice', kiro: 'kiro', claude: 'claude' }

// Same idea, keyed by the provider name server/services/userDetail.js's
// PROVIDER_BUILDERS uses for GET /api/users/:id/detail ('copilot' is
// Microsoft Copilot, gated the same as any other Microsoft 365 payload).
export const DETAIL_PROVIDER_PAGE_KEY = { copilot: 'microsoft-365', freshservice: 'freshservice', kiro: 'kiro', claude: 'claude' }

export function hasCrossProviderAccess(access) {
  return CROSS_PROVIDER_PAGES.some((p) => access.allowedPages.includes(p))
}

export function filterConnectionsForAccess(connections, access) {
  if (hasCrossProviderAccess(access)) return connections
  return connections.filter((c) => access.allowedPages.includes(PROVIDER_PAGE_KEY[c.source]))
}

export function canSeeMicrosoftDirectory(access) {
  return hasCrossProviderAccess(access) || access.allowedPages.includes('microsoft-365')
}

export function canAccessDetailProvider(access, provider) {
  if (hasCrossProviderAccess(access)) return true
  const key = DETAIL_PROVIDER_PAGE_KEY[String(provider || '').toLowerCase()]
  return !!key && access.allowedPages.includes(key)
}
