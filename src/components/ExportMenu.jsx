import React, { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'

// Small "Export ▾" button + format popover, reusing the same colorful
// trigger/popover styling as the Products page's "Dedicated Product Pages"
// menu so every dropdown-style control in the app looks the same.
export default function ExportMenu({ onExport, label = 'Export', disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function pick(format) {
    setOpen(false)
    onExport(format)
  }

  return (
    <div className="dedicated-pages" ref={ref}>
      <button className="dedicated-pages-trigger" onClick={() => setOpen((o) => !o)} disabled={disabled}>
        <Download size={16} />
        {label}
        <ChevronDown size={14} className={`dedicated-pages-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="dedicated-pages-menu">
          <button className="dedicated-pages-menu-item" onClick={() => pick('csv')}>CSV</button>
          <button className="dedicated-pages-menu-item" onClick={() => pick('xlsx')}>Excel (XLSX)</button>
          <button className="dedicated-pages-menu-item" onClick={() => pick('pdf')}>PDF</button>
        </div>
      )}
    </div>
  )
}
