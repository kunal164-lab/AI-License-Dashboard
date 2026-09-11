import React, { useState } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import ColumnFilterPopover from './ColumnFilterPopover'
import { uniqueValuesFor } from '../utils/tableFilters'
import { COLUMN_BY_KEY } from '../utils/columnRegistry'

const SEARCH_KEY = '__search'
const DEFAULT_SEARCH_FIELDS = ['name', 'email', 'product', 'department']

// Reusable "quick filter" row: an optional search box, one button per quick
// filter column (each opening the same Excel-style popover used by table
// headers), and a "More Filters" toggle for secondary columns. Every entry
// point — including search — reads/writes the SAME global filter object
// passed in as `filters`, via `onSetFilter`/`onClearFilter`. There is
// exactly one filtering engine (utils/tableFilters.js) behind all of it.
//
// columnByKey defaults to the app-wide AI-usage-record registry (so the
// Users page needs no changes), but any page with its own column set (e.g.
// Microsoft 365's users/devices/groups tables) can pass its own map instead.
export default function QuickFilterBar({ quickKeys, moreKeys = [], allData, filters, onSetFilter, onClearFilter, showSearch = true, searchFields = DEFAULT_SEARCH_FIELDS, columnByKey = COLUMN_BY_KEY }) {
  const [openKey, setOpenKey] = useState(null)
  const [showMore, setShowMore] = useState(false)
  const searchValue = filters[SEARCH_KEY]?.query || ''

  function renderButton(key) {
    const column = columnByKey[key]
    if (!column) return null
    const filter = filters[key]
    const count = filter?.type === 'category' ? filter.values.length : (filter ? 1 : 0)
    return (
      <div key={key} style={{ position: 'relative' }}>
        <button className={`quick-filter-btn ${count ? 'active' : ''}`} onClick={() => setOpenKey(openKey === key ? null : key)}>
          {column.name}{count ? ` (${count})` : ''} <ChevronDown size={14} />
        </button>
        {openKey === key && (
          <ColumnFilterPopover
            column={column}
            currentFilter={filter}
            availableValues={column.type === 'category' ? uniqueValuesFor(allData, key, filters, key) : []}
            onApply={(f) => onSetFilter(key, f)}
            onClear={() => onClearFilter(key)}
            onClose={() => setOpenKey(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="quick-filter-bar">
      {showSearch && (
        <div className="search-input" style={{ minWidth: 220 }}>
          <Search size={14} />
          <input
            placeholder="Search..."
            value={searchValue}
            onChange={(e) => {
              const query = e.target.value
              if (query) onSetFilter(SEARCH_KEY, { type: 'search', query, fields: searchFields })
              else onClearFilter(SEARCH_KEY)
            }}
          />
        </div>
      )}
      {quickKeys.map(renderButton)}
      {moreKeys.length > 0 && (
        <button className="quick-filter-btn" onClick={() => setShowMore((s) => !s)}>More Filters <ChevronDown size={14} /></button>
      )}
      {showMore && moreKeys.map(renderButton)}
    </div>
  )
}
