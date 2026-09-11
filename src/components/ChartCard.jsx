import React from 'react'

export default function ChartCard({ title, subtitle, footer, children }) {
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div className="card-title">{title}</div>
        {subtitle && <div className="small muted">{subtitle}</div>}
      </div>
      <div className="chart-card-body">{children}</div>
      {footer && <div className="chart-card-footer small muted">{footer}</div>}
    </div>
  )
}
