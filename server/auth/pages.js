// Central page/permission registry (Part 5 of the auth spec — "do NOT
// scatter authorization rules throughout individual React pages... one
// central definition"). Every page key here corresponds to a REAL route or
// a real, existing feature already in this app (src/App.jsx's currentPath
// switch, or a view/tab within one of those routes) — nothing invented.
//
// `route`: the exact src/App.jsx currentPath value this key gates, or null
// when the key gates a FEATURE rather than a distinct URL (e.g. "reports"
// is the Generate Report button/modal available from several pages, not
// its own route; the Microsoft 365 sub-view keys below are tabs INSIDE the
// single '/microsoft-365' route, not separate URLs — Microsoft365.jsx's own
// view selector hides tabs the user lacks; the underlying data endpoint is
// still gated at the coarser 'microsoft-365' key since it's one shared
// payload, see server/auth/authorize.js's REQUIRE_PAGE map).
// `parent`: for sub-view keys, the top-level key whose route they live
// under — used so granting the parent key is enough to reach the route at
// all, while the child keys further narrow which tabs are usable.
// `adminOnly`: true means this key is never grantable to a non-admin
// mapping (it gates the RBAC configuration screen itself).
export const PAGES = [
  { key: 'dashboard', label: 'Overview', route: '/' },
  { key: 'users', label: 'Users', route: '/users' },
  { key: 'products', label: 'Products', route: '/products' },
  { key: 'applications', label: 'Application Inventory', route: '/applications' },
  { key: 'cost', label: 'Cost', route: '/cost' },
  { key: 'optimization', label: 'Optimization', route: '/optimization' },
  { key: 'reports', label: 'Reports (export)', route: null },
  { key: 'data-sources', label: 'Data Sources', route: '/data-sources' },
  { key: 'microsoft-365', label: 'Microsoft 365', route: '/microsoft-365' },
  { key: 'microsoft-365-users', label: 'Microsoft 365 — Users', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-devices', label: 'Microsoft 365 — Devices', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-applications', label: 'Microsoft 365 — Applications', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-licenses', label: 'Microsoft 365 — Licenses', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-departments', label: 'Microsoft 365 — Departments', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-groups', label: 'Microsoft 365 — Groups & Teams', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-signins', label: 'Microsoft 365 — Sign-ins', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'microsoft-365-copilot', label: 'Microsoft 365 — Copilot', route: '/microsoft-365', parent: 'microsoft-365' },
  { key: 'freshservice', label: 'Freshservice', route: '/freshservice' },
  { key: 'kiro', label: 'Kiro', route: '/kiro' },
  { key: 'claude', label: 'Claude', route: '/claude' },
  { key: 'admin-access', label: 'Access Management', route: '/admin/access', adminOnly: true },
  // A genuinely separate route (not a tab within '/admin/access' — see the
  // `parent` doc above: that's only for a key sharing its PARENT's exact
  // route, which this does not), grouped under "Administration" purely as
  // a UI/navigation convenience (a small tab strip on both admin pages).
  { key: 'admin-dashboard-views', label: 'Dashboard Views', route: '/admin/dashboard-views', adminOnly: true }
]

export const PAGE_KEYS = PAGES.map((p) => p.key)
export const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p]))

// Every non-null, non-adminOnly route this app actually serves, mapped back
// to the page key(s) that gate it — used by the frontend's route guard
// (unknown/child routes resolve to their parent's route for the "which
// page key does this URL need" check).
export function pageKeyForRoute(route) {
  const exact = PAGES.find((p) => p.route === route && !p.parent)
  return exact ? exact.key : null
}
