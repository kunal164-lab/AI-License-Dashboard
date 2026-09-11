import React from 'react'
import { Filter } from 'lucide-react'

export default function KpiCard({ title, value, sub, icon, trend, color = 'blue', onClick }) {
  const clickable = typeof onClick === 'function'
  return (
    <div
      className={`kpi ${clickable ? 'kpi-clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e) } : undefined}
    >
      <div className="kpi-top">
        {icon && <span className={`kpi-icon-badge badge-${color}`}>{icon}</span>}
        <div className="card-title">{title}</div>
        {clickable && <Filter size={12} className="kpi-filter-hint" />}
      </div>
      <div className="kpi-value">{value === null || value === undefined || value === '' ? 'N/A' : value}</div>
      <div className="kpi-bottom">
        {sub && <span className="small muted">{sub}</span>}
        {trend && <span className={`kpi-trend ${trend.direction === 'down' ? 'trend-down' : trend.direction === 'up' ? 'trend-up' : ''}`}>{trend.label}</span>}
      </div>
    </div>
  )
}
