import React from 'react'
import { RefreshCw, FileBarChart } from 'lucide-react'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import UserProfileMenu from './UserProfileMenu'
import HeaderGraphic from './HeaderGraphic'
import HeaderDecoration from './HeaderDecoration'

export default function Header({
  connectedCount, lastUpdated, summary, userCount, onExport, onRefreshAll, refreshingAll, canWrite = true,
  user, role, vbu, canAccessAdmin, onOpenAdmin, onSignOut, headerGraphicKey, headerDecorationKey,
  viewDisplayName, onSwitchDashboardView
}) {
  return (
    <div className="header">
      <HeaderDecoration headerDecorationKey={headerDecorationKey} />
      <div className="header-title-block">
        <h2>Internal IT Dashboard</h2>
        <div className="small muted">
          Internal IT — License and Productivity Management
          {/* VBU-aware presentation (Dashboard View spec) — generic for
              every resolved view, never hardcoded to one VBU's name. */}
          {viewDisplayName && <> &nbsp;|&nbsp; <strong style={{ color: 'var(--header-accent)' }}>{viewDisplayName}</strong></>}
        </div>
        <div className="small muted" style={{marginTop:4}}>Records: {summary.records ? summary.records.length : 0} &nbsp;·&nbsp; Users: {userCount ?? 0}</div>
      </div>
      <HeaderGraphic headerGraphicKey={headerGraphicKey} />
      <div className="header-right">
        <div className="header-status-pill">
          <div className="status-line">
            <span className={`status-dot ${connectedCount > 0 ? '' : 'dot-warn'}`}></span>
            Data Sources: {connectedCount} Connected
          </div>
          <div className="small muted">Last Updated: {formatRelativeTime(lastUpdated)}</div>
        </div>
        {canWrite && (
          <button className="button header-refresh-btn" onClick={onRefreshAll} disabled={refreshingAll}>
            <RefreshCw size={16} className={refreshingAll ? 'spin' : ''} />
            {refreshingAll ? 'Refreshing...' : 'Refresh All Sources'}
          </button>
        )}
        <button className="button secondary" onClick={onExport}>
          <FileBarChart size={16} />
          Generate Report
        </button>
        <UserProfileMenu
          user={user} role={role} vbu={vbu} canAccessAdmin={canAccessAdmin} onOpenAdmin={onOpenAdmin}
          onSignOut={onSignOut} onSwitchDashboardView={onSwitchDashboardView}
        />
      </div>
    </div>
  )
}
