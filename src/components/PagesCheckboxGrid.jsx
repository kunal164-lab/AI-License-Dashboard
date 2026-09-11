import React from 'react'

// Shared by both RoleForm (src/pages/AdminAccess.jsx) and the Dashboard
// Views admin form (src/pages/AdminDashboardViews.jsx) — one flat grid of
// top-level pages, plus the Microsoft 365 sub-tabs revealed only once the
// parent 'microsoft-365' page itself is checked (pages.js: a sub-key means
// nothing without its parent). adminOnly pages (currently 'admin-access'
// and 'admin-dashboard-views') are hidden unless canWrite is also true —
// the backend independently enforces the RBAC version of this rule
// (server/auth/adminRoutes.js#validAllowedPages); a Dashboard View's own
// page list has no such write-gated meaning (a view can list an adminOnly
// key, it just grants nothing on its own — RBAC still decides, see
// server/services/dashboardViews.js#effectivePages), so callers that don't
// have a canWrite concept can simply omit that prop (defaults to true, i.e.
// show every page).
export default function PagesCheckboxGrid({ pages, allowedPages, canWrite = true, onToggle }) {
  const topLevelPages = pages.filter((p) => !p.parent && (!p.adminOnly || canWrite))
  const msSubPages = pages.filter((p) => p.parent === 'microsoft-365')
  return (
    <>
      <div className="checkbox-grid">
        {topLevelPages.map((p) => (
          <label key={p.key} className="checkbox-row">
            <input type="checkbox" checked={allowedPages.has(p.key)} onChange={() => onToggle(p.key)} />
            {p.label}
          </label>
        ))}
      </div>
      {allowedPages.has('microsoft-365') && msSubPages.length > 0 && (
        <>
          <div className="small muted" style={{ fontWeight: 600, marginTop: 12, marginBottom: 2 }}>Microsoft 365 — Tabs</div>
          <div className="checkbox-grid checkbox-grid-sub">
            {msSubPages.map((p) => (
              <label key={p.key} className="checkbox-row">
                <input type="checkbox" checked={allowedPages.has(p.key)} onChange={() => onToggle(p.key)} />
                {p.label.replace('Microsoft 365 — ', '')}
              </label>
            ))}
          </div>
        </>
      )}
    </>
  )
}
