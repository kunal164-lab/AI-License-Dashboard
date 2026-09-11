import React from 'react'
import CostEntityTable from './CostEntityTable'
import CostEntityDetail from './CostEntityDetail'
import EmptyState from '../../components/EmptyState'
import { useCostJson } from './useCostJson'
import { exportCostRows } from './costRowsExport'
import toast from '../../utils/toast'

// Shared list+drill-down shell for every "Cost by X" dimension (Product,
// Department, VBU, Domain) — all four are the exact same shape server-side
// (costAnalytics.js's aggregateBy for the list, dimensionDetail/productDetail
// for the drill-down), so this is the one component that renders it,
// parameterized per dimension rather than copy-pasted four times.
//
// `selected`/`onSelectedChange` are CONTROLLED by the parent (Cost.jsx) —
// each dimension keeps its own last-selected entity there, so switching
// views and coming back preserves context (Part 27 of the spec: "Cost ->
// By Department -> Internal IT -> Claude" should not force re-picking
// Internal IT after visiting Claude), and a breakdown chart inside one
// dimension's detail can cross-navigate into another dimension's view
// (e.g. clicking a product bar inside a Department detail) via onCrossNavigate.
export default function CostDimensionView({
  apiBase, nameLabel, currency, onOpenUser, buildBreakdowns,
  selected, onSelectedChange, extraListColumns
}) {
  const { data: list, loading: listLoading } = useCostJson(apiBase)
  const { data: detail, loading: detailLoading } = useCostJson(selected ? `${apiBase}/${encodeURIComponent(selected)}` : null)

  if (selected) {
    if (detailLoading || !detail) return <div className="muted">Loading {nameLabel.toLowerCase()} detail...</div>
    return (
      <CostEntityDetail
        title={selected}
        subtitle={nameLabel}
        titleLogo={nameLabel === 'Product' ? { product: selected, provider: detail.summary?.provider } : null}
        detail={detail}
        currency={currency}
        onBack={() => onSelectedChange(null)}
        breakdowns={buildBreakdowns(detail)}
        onOpenUser={onOpenUser}
        onExport={(fmt) => {
          // The scoped export here is a tabular CSV/XLSX dump of this
          // entity's rows only — a branded PDF needs the full report
          // engine, already available via the page-level "Generate Report"
          // button, so a PDF pick is redirected there rather than silently
          // downloading a mislabeled CSV instead of the PDF asked for.
          if (fmt === 'pdf') { toast.info('Use "Generate Report" above for a PDF — this Export downloads CSV/Excel only.'); return }
          const filename = exportCostRows(detail.rows, fmt, { entityName: `${nameLabel}_${selected}`, sheetName: nameLabel })
          if (filename) toast.success(`Downloaded ${filename}`)
        }}
      />
    )
  }

  if (listLoading) return <div className="muted">Loading {nameLabel.toLowerCase()} cost data...</div>
  if (!list || !list.items?.length) return <EmptyState title={`No ${nameLabel.toLowerCase()} cost data available`} hint="Connect a data source or import a usage report to see cost analytics here." />
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 8 }}>Cost by {nameLabel}</div>
      <CostEntityTable
        items={list.items}
        nameLabel={nameLabel}
        extraColumns={extraListColumns}
        onSelect={(r) => onSelectedChange(r.name)}
        currency={currency}
        showLogo={nameLabel === 'Product'}
      />
    </div>
  )
}
