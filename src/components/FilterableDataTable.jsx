import React, { useState, useMemo, useEffect } from 'react'
import { Filter } from 'lucide-react'
import DataTable from './DataTable'
import QuickFilterBar from './QuickFilterBar'
import ActiveFilterBar from './ActiveFilterBar'
import ColumnFilterPopover from './ColumnFilterPopover'
import EmptyState from './EmptyState'
import useTableFilters from '../hooks/useTableFilters'
import { uniqueValuesFor } from '../utils/tableFilters'

// The same Excel-style filtering the Users page uses (quick-filter pills,
// active-filter chips, per-column header popovers, all backed by the one
// shared utils/tableFilters.js engine) — packaged so any table on any page
// can get it with one component instead of hand-assembling
// QuickFilterBar + ActiveFilterBar + DataTable + popover wiring each time.
// Its filter state is local to this table (not the app-wide globalFilters),
// which is what a page with several independent datasets — like Microsoft
// 365's users/devices/applications/groups/sign-ins — needs.
export default function FilterableDataTable({
  columns, data, quickKeys = [], storageKey, itemLabel = 'records',
  emptyTitle = 'No records match the selected filters', emptyHint,
  showSearch = true, searchFields, onFilteredChange, onFiltersChange,
  externalFilter, externalFilterToken, tableRef
}) {
  const { filtered, filters, setFilter, clearFilter, clearAllFilters } = useTableFilters(data)
  const [openColumnKey, setOpenColumnKey] = useState(null)
  const columnByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns])

  useEffect(() => { if (onFilteredChange) onFilteredChange(filtered) }, [filtered]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (onFiltersChange) onFiltersChange(filters) }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lets a KPI card elsewhere on the page drive this table's filter (e.g.
  // "Non-Compliant Devices" -> the Devices table's compliance_state filter)
  // without lifting this table's whole filter state out of its own local
  // useTableFilters — only fires when externalFilterToken actually changes,
  // so it never fights with the admin's own in-table filter clicks.
  useEffect(() => {
    if (externalFilter && externalFilterToken) setFilter(externalFilter.key, externalFilter.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFilterToken])

  function renderColumnHeaderFilter(column) {
    if (!column.type) return null
    const filter = filters[column.key]
    return (
      <span style={{ position: 'relative' }}>
        <button
          className={`th-filter-btn ${filter ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpenColumnKey(openColumnKey === column.key ? null : column.key) }}
          title={`Filter ${column.name}`}
        >
          <Filter />
        </button>
        {openColumnKey === column.key && (
          <ColumnFilterPopover
            column={column}
            currentFilter={filter}
            availableValues={column.type === 'category' ? uniqueValuesFor(data, column.key, filters, column.key) : []}
            onApply={(f) => setFilter(column.key, f)}
            onClear={() => clearFilter(column.key)}
            onClose={() => setOpenColumnKey(null)}
          />
        )}
      </span>
    )
  }

  return (
    <div ref={tableRef}>
      {(quickKeys.length > 0 || showSearch) && (
        <QuickFilterBar
          quickKeys={quickKeys}
          allData={data}
          filters={filters}
          onSetFilter={setFilter}
          onClearFilter={clearFilter}
          showSearch={showSearch}
          searchFields={searchFields}
          columnByKey={columnByKey}
        />
      )}
      <ActiveFilterBar
        filters={filters}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        shownCount={filtered.length}
        totalCount={data.length}
        itemLabel={itemLabel}
        columnByKey={columnByKey}
      />
      <DataTable
        columns={columns}
        data={filtered}
        storageKey={storageKey}
        hideSearch
        renderColumnFilter={renderColumnHeaderFilter}
        emptyState={<EmptyState title={emptyTitle} hint={emptyHint} />}
      />
    </div>
  )
}
