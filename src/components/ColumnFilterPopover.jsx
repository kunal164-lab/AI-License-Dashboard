import React, { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

const NUMBER_OPS = [
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'eq', label: 'Equals' },
  { value: 'between', label: 'Between' }
]

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'moreThan', label: 'More than X days ago' }
]

// One popover component for every column type (category / number / date /
// text). Renders inline via CSS positioning from the trigger button; the
// caller controls open/close so only one popover is ever open at once.
export default function ColumnFilterPopover({ column, currentFilter, availableValues, onApply, onClear, onClose }) {
  const ref = useRef(null)
  const [valueQuery, setValueQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set(currentFilter?.type === 'category' ? currentFilter.values : []))
  const [op, setOp] = useState(currentFilter?.type === 'number' ? currentFilter.op : 'gt')
  const [numValue, setNumValue] = useState(currentFilter?.type === 'number' ? currentFilter.value ?? '' : '')
  const [numValue2, setNumValue2] = useState(currentFilter?.type === 'number' ? currentFilter.value2 ?? '' : '')
  const [preset, setPreset] = useState(currentFilter?.type === 'date' ? currentFilter.preset : '30')
  const [presetDays, setPresetDays] = useState(currentFilter?.type === 'date' ? currentFilter.days ?? '' : '')
  const [textQuery, setTextQuery] = useState(currentFilter?.type === 'text' ? currentFilter.query : '')

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [onClose])

  const filteredValues = (availableValues || []).filter((v) => v.toLowerCase().includes(valueQuery.toLowerCase()))

  function toggleValue(v) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v); else next.add(v)
      return next
    })
  }

  function apply() {
    if (column.type === 'category') {
      if (selected.size === 0) onClear()
      else onApply({ type: 'category', values: Array.from(selected) })
    } else if (column.type === 'number') {
      const v1 = numValue === '' ? null : Number(numValue)
      if (v1 === null || Number.isNaN(v1)) { onClear(); return }
      const v2 = op === 'between' ? (numValue2 === '' ? null : Number(numValue2)) : null
      onApply({ type: 'number', op, value: v1, value2: v2 })
    } else if (column.type === 'date') {
      if (preset === 'moreThan') {
        const d = presetDays === '' ? null : Number(presetDays)
        if (d === null || Number.isNaN(d)) { onClear(); return }
        onApply({ type: 'date', preset, days: d })
      } else {
        onApply({ type: 'date', preset })
      }
    } else {
      if (!textQuery) { onClear(); return }
      onApply({ type: 'text', query: textQuery })
    }
  }

  return (
    <div className="column-filter-popover" ref={ref} onClick={(e) => e.stopPropagation()}>
      {column.type === 'category' && (
        <>
          <div className="search-input" style={{ marginBottom: 8 }}>
            <Search size={13} />
            <input placeholder="Search values..." value={valueQuery} onChange={(e) => setValueQuery(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button className="link-button" onClick={() => setSelected(new Set(filteredValues))}>Select All</button>
            <button className="link-button" onClick={() => setSelected(new Set())}>Clear All</button>
          </div>
          <div className="column-filter-values">
            {filteredValues.length === 0 && <div className="muted small">No matching values</div>}
            {filteredValues.map((v) => (
              <label key={v} className="column-filter-checkbox">
                <input type="checkbox" checked={selected.has(v)} onChange={() => toggleValue(v)} /> {v}
              </label>
            ))}
          </div>
        </>
      )}

      {column.type === 'number' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            {NUMBER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="number" placeholder="Value" value={numValue} onChange={(e) => setNumValue(e.target.value)} autoFocus />
          {op === 'between' && <input type="number" placeholder="And value" value={numValue2} onChange={(e) => setNumValue2(e.target.value)} />}
        </div>
      )}

      {column.type === 'date' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DATE_PRESETS.map((p) => (
            <label key={p.value} className="column-filter-checkbox">
              <input type="radio" name={`date-${column.key}`} checked={preset === p.value} onChange={() => setPreset(p.value)} /> {p.label}
            </label>
          ))}
          {preset === 'moreThan' && (
            <input type="number" placeholder="Days" value={presetDays} onChange={(e) => setPresetDays(e.target.value)} style={{ marginLeft: 22, width: 100 }} />
          )}
        </div>
      )}

      {column.type === 'text' && (
        <input placeholder={`Filter ${column.name}...`} value={textQuery} onChange={(e) => setTextQuery(e.target.value)} autoFocus />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        <button className="button secondary" onClick={() => { onClear(); onClose() }}>Clear</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={() => { apply(); onClose() }}>Apply</button>
        </div>
      </div>
    </div>
  )
}
