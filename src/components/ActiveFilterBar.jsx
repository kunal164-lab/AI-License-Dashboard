import React from 'react'
import { X } from 'lucide-react'
import { filterLabel } from '../utils/tableFilters'
import { COLUMN_BY_KEY } from '../utils/columnRegistry'

// Shown identically on every page that respects a filter state — whether an
// active filter came from a manual dropdown, a column popover, the search
// box, a KPI click, or a chart click makes no difference here; they're all
// just entries in the same `filters` object.
//
// columnByKey defaults to the app-wide AI-usage-record registry (so the
// Users page needs no changes), but any page with its own column set can
// pass its own map instead.
export default function ActiveFilterBar({ filters, onClearFilter, onClearAll, shownCount, totalCount, itemLabel = 'records', columnByKey = COLUMN_BY_KEY }) {
  const entries = Object.entries(filters || {}).filter(([, f]) => f)

  if (!entries.length) {
    return <div className="small muted" style={{ marginBottom: 12 }}>Showing all {totalCount.toLocaleString()} {itemLabel}</div>
  }

  return (
    <div className="active-filter-row">
      <span className="small muted">Filters:</span>
      {entries.map(([key, filter]) => (
        <span key={key} className="filter-chip">
          {filterLabel(columnByKey[key] || { name: key }, filter)}
          <button onClick={() => onClearFilter(key)}><X /></button>
        </span>
      ))}
      <span className="small muted">Showing {shownCount.toLocaleString()} of {totalCount.toLocaleString()} {itemLabel}</span>
      <button className="link-button" onClick={onClearAll}>Clear All Filters</button>
    </div>
  )
}
