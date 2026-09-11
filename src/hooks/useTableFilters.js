import { useMemo, useState } from 'react'
import { applyFilters } from '../utils/tableFilters'

// Same shape/behavior as App.jsx's global filter state (setFilter/clearFilter/
// clearAllFilters over one filters object, run through the shared
// utils/tableFilters.js engine), just scoped to a single page/table instead
// of the whole app — for datasets that aren't the AI usage records (e.g. the
// Microsoft 365 page's Users/Devices/Applications/Groups/Sign-ins tables,
// which each need their own independent filter state).
export default function useTableFilters(data) {
  const [filters, setFilters] = useState({})
  const filtered = useMemo(() => applyFilters(data || [], filters), [data, filters])

  function setFilter(key, filterObj) {
    setFilters((prev) => ({ ...prev, [key]: filterObj }))
  }
  function clearFilter(key) {
    setFilters((prev) => { const next = { ...prev }; delete next[key]; return next })
  }
  function clearAllFilters() {
    setFilters({})
  }

  return { filtered, filters, setFilter, clearFilter, clearAllFilters }
}
