import React from 'react'
import { LayoutDashboard, Users, Package, AppWindow, DollarSign, TrendingDown, Settings, Database, RefreshCw, Palette } from 'lucide-react'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import AppLogo from './AppLogo'
import SidebarDecoration from './SidebarDecoration'
import { resolveLogo } from '../utils/dashboardViewAssets'

const ICONS = {
  '/': LayoutDashboard,
  '/users': Users,
  '/products': Package,
  '/applications': AppWindow,
  '/cost': DollarSign,
  '/optimization': TrendingDown,
  '/admin/access': Settings,
  '/admin/dashboard-views': Palette,
  '/data-sources': Database
}

export default function Sidebar({
  pages, current, onNavigate, lastUpdated, onRefreshAll, refreshingAll, autoRefreshLabel, lastAutoRefreshAt, hasApiSources,
  canWrite, logoKey, sidebarTagline, sidebarDecorationKey, viewDisplayName
}) {
  return (
    <div className="sidebar">
      <SidebarDecoration sidebarDecorationKey={sidebarDecorationKey} />
      {/* justifyContent:'center' is load-bearing — without it a single flex
          child sits at the row's start (left), not centered, regardless of
          how wide the logo itself is. sidebar-logo-wrap is hidden entirely
          (styles.css) at the narrow "icon-only" collapse breakpoint,
          rather than letting max-width:100% silently shrink the approved
          logo asset below its real size — the approved sizing (e.g. the
          160px SSP Worldwide/UK & Ireland treatment) must never be
          resized, only shown or not shown (Responsiveness spec, Logo
          Rule). */}
      <div className="sidebar-logo-wrap" style={{display:'flex',justifyContent:'center',alignItems:'center',marginBottom:14,position:'relative',zIndex:1}}>
        {/* --sidebar-logo-width (a Dashboard View theme override, e.g. SSP
            UK & Ireland's larger official logo) drives the size here —
            AppLogo never sets an explicit height, so aspect ratio is
            always preserved regardless of the override. */}
        <AppLogo logoKey={logoKey} className="sidebar-logo" />
      </div>
      <div className="sidebar-subtitle" style={{position:'relative',zIndex:1}}>Internal IT — License and<br/>Productivity Management</div>
      {/* title + aria-label keep every page reachable and identifiable at
          the narrow "icon-only" breakpoint (styles.css hides .nav-label
          there — a pure CSS/visual collapse, never a change to which pages
          are authorized/rendered; RBAC's own page list is untouched) — a
          mouse user gets a native tooltip, a screen reader still announces
          the real label even though the visible text is hidden. */}
      <div className="nav">
        {pages.map((p) => {
          const Icon = ICONS[p.path]
          return (
            <button key={p.path} className={(p.path === current) ? 'active' : ''} onClick={() => onNavigate(p.path)} title={p.label} aria-label={p.label}>
              {Icon && <span className="nav-icon"><Icon size={18} /></span>}
              <span className="nav-label">{p.label}</span>
            </button>
          )
        })}
      </div>
      <div className="sidebar-footer">
        {/* VBU-aware presentation (Dashboard View spec, generic for every
            resolved view — never hardcoded to one VBU's name): "the user
            must be able to immediately understand which organizational
            dashboard they are viewing... at minimum in the header and the
            sidebar branding area." */}
        {viewDisplayName && (
          <div className="sidebar-vbu-badge">
            <img src={resolveLogo(logoKey)} alt="" />
            <div>
              <div className="sidebar-vbu-badge-name">{viewDisplayName}</div>
              <div className="sidebar-vbu-badge-app">Internal IT Dashboard</div>
            </div>
          </div>
        )}
        {/* Dashboard View branding (VBU-aware-views spec) — opt-in per
            view, e.g. SSP Worldwide's "A Better Tomorrow Together." Every
            other view renders nothing extra here. */}
        {sidebarTagline && <div className="sidebar-tagline">{sidebarTagline}</div>}
        <div className="sidebar-footer-label">Last Data Refresh</div>
        <div className="sidebar-footer-time">{formatRelativeTime(lastUpdated)}</div>
        {/* Refresh All is a write/administrative action — hidden for a Read
            Only user as a UX convenience, but the backend independently
            enforces this on POST /api/sources/refresh-all regardless
            (server/auth/middleware.js#requireWrite) — hiding the button is
            never the real guard (Part 3). */}
        {canWrite && (
          <button className="button primary" onClick={onRefreshAll} disabled={refreshingAll} title="Refresh All" aria-label="Refresh All">
            <RefreshCw size={16} className={refreshingAll ? 'spin' : ''} />
            <span className="nav-label">{refreshingAll ? 'Refreshing...' : 'Refresh All'}</span>
          </button>
        )}
        {/* Gated on hasApiSources: manual CSV/XLSX imports have no live
            endpoint to auto-refresh, so a CSV-only setup must never claim an
            automatic schedule it can't actually run (see App.jsx). The
            timestamp below is deliberately separate from "Last Data Refresh"
            above (which also includes manual CSV imports) — it reflects only
            the sources this specific auto-refresh claim covers, so the two
            lines can never contradict each other the way "every 30 minutes"
            next to a 50-minute-old timestamp did. */}
        {autoRefreshLabel && hasApiSources && (
          <div className="small sidebar-auto-refresh-info" style={{ color: '#7e93aa', marginTop: 8, textAlign: 'center' }}>
            <div>Auto refresh: {autoRefreshLabel}</div>
            <div>Last successful auto refresh: {formatRelativeTime(lastAutoRefreshAt)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
