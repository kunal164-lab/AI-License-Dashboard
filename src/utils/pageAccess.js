// Frontend's half of the central page/permission registry (Part 5/6 of the
// auth spec — the backend's canonical copy is server/auth/pages.js, whose
// PAGE_KEYS this file's keys must match exactly). This file only maps a
// route the app can navigate to onto the page key that gates it; it never
// decides access itself — that always comes from /api/auth/me's
// `allowedPages`, fetched once in App.jsx and passed down.
export const ROUTE_TO_PAGE_KEY = {
  '/': 'dashboard',
  '/users': 'users',
  '/products': 'products',
  '/applications': 'applications',
  '/cost': 'cost',
  '/optimization': 'optimization',
  '/data-sources': 'data-sources',
  '/microsoft-365': 'microsoft-365',
  '/freshservice': 'freshservice',
  '/kiro': 'kiro',
  '/claude': 'claude',
  '/admin/access': 'admin-access',
  '/admin/dashboard-views': 'admin-dashboard-views'
}

// Every /data-sources/... sub-page (per-provider connect/manage screens)
// falls under the SAME 'data-sources' page key as the main Data Sources
// page — they're all facets of one page-level permission, not separately
// grantable (Part 12: Data Sources as a whole is the sensitive area).
export function pageKeyForPath(path) {
  if (ROUTE_TO_PAGE_KEY[path]) return ROUTE_TO_PAGE_KEY[path]
  if (path.startsWith('/data-sources/')) return 'data-sources'
  return null
}
