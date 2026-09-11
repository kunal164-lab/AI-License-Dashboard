import React from 'react'
import { X, Check } from 'lucide-react'

export default function ImportPreview({ files, rows, onCancel, onConfirm, importing }) {
  const products = Array.from(new Set((rows || []).map((r) => r.product).filter(Boolean)))
  const users = new Set((rows || []).map((r) => r.email || r._id)).size
  const estimatedCost = (rows || []).reduce((s, r) => s + (parseFloat(r.estimated_spend || 0) || 0) + (parseFloat(r.monthly_license_cost || 0) || 0), 0)

  return (
    <div className="card">
      <h4>Import Preview</h4>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 8 }}>
        <div><div className="muted small">Files</div><strong>{files.length}</strong></div>
        <div><div className="muted small">Records found</div><strong>{(rows || []).length.toLocaleString()}</strong></div>
        <div><div className="muted small">Users detected</div><strong>{users.toLocaleString()}</strong></div>
        <div><div className="muted small">Estimated Cost</div><strong>${estimatedCost.toFixed(2)}</strong></div>
      </div>
      {products.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted small">Products</div>
          <div>{products.join(', ')}</div>
        </div>
      )}
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="button secondary" onClick={onCancel}><X size={16} /> Cancel</button>
        <button className="button primary" onClick={onConfirm} disabled={importing}><Check size={16} /> {importing ? 'Importing...' : 'Import & Merge'}</button>
      </div>
    </div>
  )
}
