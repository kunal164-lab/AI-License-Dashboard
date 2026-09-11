import React, { useMemo, useState } from 'react'
import { Search, Maximize2, Minimize2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { compareValues } from '../utils/tableFilters'

const COMPACT_FALLBACK_COUNT = 7

// storageKey is required to persist column preferences per-table (e.g. "users").
// renderColumnFilter(column, isOpen, toggle), if supplied, renders an optional
// filter trigger/popover next to a column's header — DataTable stays agnostic
// about what that filter UI does; it only provides the mounting point.
export default function DataTable({ columns, data, onRowClick, storageKey, hideSearch, renderColumnFilter, emptyState }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  // Collapsed by default so the table fits the screen; the expand arrow
  // temporarily shows every column (with horizontal scroll) on demand.
  const [showAllColumns, setShowAllColumns] = useState(false)

  // visible columns state (keys) — this is the user's own customized subset,
  // independent of the temporary "show all" expand toggle above.
  const storageId = storageKey ? `datatable_visible_columns:${storageKey}` : null
  const allKeys = columns.map(c=>c.key)
  const essentialKeys = columns.filter(c=>c.essential).map(c=>c.key)
  const defaultKeys = essentialKeys.length ? essentialKeys : allKeys.slice(0, COMPACT_FALLBACK_COUNT)
  const [visibleKeys, setVisibleKeys] = useState(() => {
    try {
      if (storageId) {
        const raw = localStorage.getItem(storageId)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) return parsed
        }
      }
    } catch(e){}
    return defaultKeys
  })

  const searched = hideSearch ? data : data.filter((r) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)
  })

  const sortColumn = columns.find(c => c.key === sortKey)
  const filtered = useMemo(() => {
    if (!sortColumn) return searched
    const dir = sortDir === 'asc' ? 1 : -1
    return [...searched].sort((a, b) => dir * compareValues(a[sortKey], b[sortKey], sortColumn.type))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageData = filtered.slice(page * pageSize, page * pageSize + pageSize)

  function formatCell(v) {
    if (v === null || v === undefined) return 'N/A'
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'N/A'
      return v.toLocaleString()
    }
    if (v === '') return 'N/A'
    return v
  }

  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
  }

  const toggleKey = (k) => {
    setVisibleKeys(vk => vk.includes(k) ? vk.filter(x=>x!==k) : [...vk,k])
  }

  const saveDefaults = () => {
    if (!storageId) return
    try { localStorage.setItem(storageId, JSON.stringify(visibleKeys)) } catch(e){}
    setShowColumnsMenu(false)
  }

  const resetDefaults = () => {
    setVisibleKeys(defaultKeys)
    if (storageId) try { localStorage.removeItem(storageId) } catch(e){}
  }

  const customColumns = columns.filter(c => visibleKeys.includes(c.key))
  const visibleColumns = showAllColumns ? columns : customColumns
  const hiddenCount = columns.length - customColumns.length

  return (
    <div className="table">
      <div className="table-toolbar">
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {!hideSearch && (
            <div className="search-input">
              <Search size={14} />
              <input placeholder="Search users" value={query} onChange={(e)=>{setQuery(e.target.value); setPage(0)}} />
            </div>
          )}
          <button className="button" onClick={()=>setShowColumnsMenu(s=>!s)}>Columns</button>
          {showColumnsMenu && (
            <div style={{position:'absolute',background:'#fff',border:'1px solid #ddd',padding:8,boxShadow:'0 4px 12px rgba(0,0,0,0.08)',zIndex:20}}>
              <div style={{maxHeight:240,overflow:'auto'}}>
                {columns.map(c=> (
                  <label key={c.key} style={{display:'block',fontSize:13,marginBottom:4}}>
                    <input type="checkbox" checked={visibleKeys.includes(c.key)} onChange={()=>toggleKey(c.key)} /> {c.name}
                  </label>
                ))}
              </div>
              <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'flex-end'}}>
                <button className="button" onClick={resetDefaults}>Reset</button>
                <button className="button primary" onClick={saveDefaults}>Save as default</button>
              </div>
            </div>
          )}
          <label className="muted" style={{fontSize:12}}>Rows:</label>
          <select value={pageSize} onChange={(e)=>{ setPageSize(Number(e.target.value)); setPage(0) }}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <div>
            <button onClick={()=>setPage(0)} disabled={page===0}>First</button>
            <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}>Prev</button>
            <span style={{margin:'0 8px'}}>{Math.min(page+1, pageCount)}/{pageCount}</span>
            <button onClick={()=>setPage(p=>Math.min(pageCount-1,p+1))} disabled={page>=pageCount-1}>Next</button>
          </div>
          {!showAllColumns && hiddenCount > 0 && (
            <button className="expand-toggle" onClick={()=>setShowAllColumns(true)} title="Show all columns">
              <Maximize2 size={14} /> Show all columns ({hiddenCount} hidden)
            </button>
          )}
          {showAllColumns && (
            <button className="expand-toggle" onClick={()=>setShowAllColumns(false)} title="Fit to screen">
              <Minimize2 size={14} /> Fit to screen
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 && emptyState ? emptyState : (
      <div style={{overflowX:'auto'}}>
        <table>
          <thead>
            <tr>
              {visibleColumns.map(c=> {
                const sortable = c.type && c.key !== 'actions'
                const SortIcon = sortKey !== c.key ? ArrowUpDown : (sortDir === 'asc' ? ArrowUp : ArrowDown)
                return (
                  <th key={c.key} className={sortable ? 'th-sortable' : ''}>
                    <span className="th-cell-wrap">
                      <span className="th-inner" onClick={sortable ? () => toggleSort(c.key) : undefined}>
                        {c.name}
                        {sortable && <SortIcon className={`th-sort-icon ${sortKey === c.key ? 'active' : ''}`} />}
                      </span>
                      {renderColumnFilter && c.key !== 'actions' && renderColumnFilter(c)}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageData.map((r,idx)=> (
              <tr key={r._id||idx} onClick={()=>onRowClick && onRowClick(r)} style={{cursor:onRowClick?'pointer':'default'}}>
                {visibleColumns.map(c=> <td key={c.key}>{c.render ? c.render(r) : formatCell(r[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
