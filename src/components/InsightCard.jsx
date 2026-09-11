import React from 'react'
import { CheckCircle2, AlertTriangle, TrendingUp, Info, ChevronRight } from 'lucide-react'

const ICONS = { good: CheckCircle2, warn: AlertTriangle, info: TrendingUp, neutral: Info }

// Same clickable pattern as KpiCard (kpi-clickable) — a meaningful insight
// (e.g. "246 licenses are unused") becomes a real drill-down entry point
// rather than static text, reusing the app's existing hover/focus language
// instead of inventing a new one.
export default function InsightCard({ tone = 'info', title, sub, onClick }) {
  const Icon = ICONS[tone] || ICONS.neutral
  const clickable = typeof onClick === 'function'
  return (
    <div
      className={`insight-card insight-${tone} ${clickable ? 'insight-clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${title} — view details` : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } : undefined}
    >
      <span className="insight-icon"><Icon size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="insight-title">{title}</div>
        {sub && <div className="insight-sub">{sub}</div>}
      </div>
      {clickable && <ChevronRight size={14} className="insight-nav-hint" />}
    </div>
  )
}
