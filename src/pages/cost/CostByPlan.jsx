import React, { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import BrandLogo from '../../components/BrandLogo'
import CostEntityTable, { CostRecordRows } from './CostEntityTable'
import { useCostJson } from './useCostJson'

// Cost by License/Plan (Part 16) — reuses the product detail endpoint for
// drill-down rather than adding a dedicated plans/:id endpoint (its rows
// are already a subset of that product's rows filtered by plan — no new
// server aggregation needed for what is, structurally, the same data).
export default function CostByPlan({ currency = 'USD' }) {
  const { data, loading } = useCostJson('/api/cost/plans')
  const [selected, setSelected] = useState(null) // { product, plan }
  const { data: productDetail, loading: detailLoading } = useCostJson(selected ? `/api/cost/products/${encodeURIComponent(selected.product)}` : null)

  if (selected) {
    if (detailLoading || !productDetail) return <div className="muted">Loading plan detail...</div>
    const planRows = productDetail.rows.filter((r) => (r.plan || null) === selected.plan)
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-button" onClick={() => setSelected(null)} aria-label="Back"><ArrowLeft size={16} /></button>
          <BrandLogo product={selected.product} size="md" />
          <div>
            <h4 style={{ margin: 0 }}>{selected.product} — {selected.plan || 'Unknown Plan'}</h4>
            <div className="muted small">License / Plan detail</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Users on this plan ({planRows.length})</div>
          <CostRecordRows rows={planRows} currency={currency} showProduct={false} />
        </div>
      </div>
    )
  }

  if (loading) return <div className="muted">Loading license/plan cost data...</div>
  if (!data || !data.items?.length) return <EmptyState title="No license/plan cost data available" />

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 8 }}>Cost by License / Plan</div>
      <div className="muted small" style={{ marginBottom: 10 }}>Only plans that exist in real, currently-synced data are listed.</div>
      <CostEntityTable
        items={data.items.map((p) => ({ ...p, name: p.plan || 'Unassigned / Unknown' }))}
        nameLabel="Plan"
        extraColumns={[{ key: 'provider', label: 'Provider' }, { key: 'product', label: 'Product' }]}
        onSelect={(r) => setSelected({ product: r.product, plan: r.plan || null })}
        currency={currency}
        showLogo
      />
    </div>
  )
}
