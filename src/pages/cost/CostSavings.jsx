import React, { useState } from 'react'
import { ArrowLeft, PiggyBank, Wallet } from 'lucide-react'
import KpiCard from '../../components/KpiCard'
import EmptyState from '../../components/EmptyState'
import StatusBadge from '../../components/StatusBadge'
import BrandLogo from '../../components/BrandLogo'
import CostEntityTable from './CostEntityTable'
import { formatMoney } from '../../utils/currency'
import { isLicenseActive } from '../../utils/licenseStatus'
import { useCostJson } from './useCostJson'

const DIMENSIONS = [
  { key: 'byProduct', label: 'By Product', apiBase: '/api/cost/products' },
  { key: 'byDepartment', label: 'By Department', apiBase: '/api/cost/departments' },
  { key: 'byVbu', label: 'By VBU', apiBase: '/api/cost/vbus' },
  { key: 'byDomain', label: 'By Domain', apiBase: '/api/cost/domains' }
]

// Potential Savings (Part 19/20) — strongly tied to Optimization: reuses the
// EXACT same unused/low-usage classification already computed centrally
// (usage_status, attached by costEngine's pipeline — see costAnalytics.js),
// never a second definition of "unused." Drill-down reuses the existing
// product/department/vbu/domain detail endpoints rather than a dedicated
// savings-detail endpoint, filtered client-side to the unused/low-usage rows.
export default function CostSavings({ currency = 'USD', onGoToOptimization }) {
  const { data: overview, loading } = useCostJson('/api/cost/overview')
  const [dimension, setDimension] = useState('byProduct')
  const [selected, setSelected] = useState(null)
  const activeDimension = DIMENSIONS.find((d) => d.key === dimension)
  const { data: detail, loading: detailLoading } = useCostJson(selected ? `${activeDimension.apiBase}/${encodeURIComponent(selected)}` : null)
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))

  if (loading) return <div className="muted">Loading potential savings...</div>
  if (!overview) return <EmptyState title="Unable to load potential savings" />

  if (selected) {
    if (detailLoading || !detail) return <div className="muted">Loading savings detail...</div>
    // Scoped to STILL-ACTIVE licenses only — a genuinely unassigned/inactive
    // license already costs nothing and isn't a savings opportunity, it's
    // already gone (matches Optimization.jsx's exact same definition).
    const savingsRows = detail.rows.filter((r) => isLicenseActive(r) && (r.usage_status === 'No Usage' || r.usage_status === 'Low Activity'))
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-button" onClick={() => setSelected(null)} aria-label="Back"><ArrowLeft size={16} /></button>
          <div>
            <h4 style={{ margin: 0 }}>{selected} — Potential Savings Detail</h4>
            <div className="muted small">{money(detail.summary.potentialSavings)}/month · {money(detail.summary.potentialAnnualSavings)}/year</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          {savingsRows.length === 0 ? <EmptyState title="No unused/low-usage licenses here" /> : (
            <div className="table" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr><th>User</th><th>Email</th><th>Department</th><th>License</th><th>Plan</th><th>Monthly Cost</th><th>Usage</th><th>Reason</th><th>Potential Savings</th></tr>
                </thead>
                <tbody>
                  {savingsRows.map((r, i) => (
                    <tr key={r.user_email ? `${r.user_email}-${i}` : i}>
                      <td>{r.user_name || 'N/A'}</td>
                      <td>{r.user_email || 'N/A'}</td>
                      <td>{r.department || 'N/A'}</td>
                      <td>{r.product || 'N/A'}</td>
                      <td>{r.plan || 'N/A'}</td>
                      <td>{money(r.display_cost)}</td>
                      <td><StatusBadge status={r.usage_status} /></td>
                      <td>{r.usage_status === 'No Usage' ? 'No recorded activity' : 'Low activity'}</td>
                      <td>{money(r.display_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  const k = overview.kpis
  const items = overview[dimension] || []

  return (
    <div>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <KpiCard color="purple" icon={<PiggyBank size={17} />} title="Potential Monthly Savings" value={money(k.potentialSavings)} />
        <KpiCard color="purple" icon={<Wallet size={17} />} title="Potential Annual Savings" value={money(k.potentialAnnualSavings)} />
      </div>
      {onGoToOptimization && (
        <div className="muted small" style={{ marginBottom: 10 }}>
          These figures use the same unused/low-usage definitions as Optimization.
          <button className="link-button" style={{ marginLeft: 6 }} onClick={onGoToOptimization}>Open Optimization →</button>
        </div>
      )}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title">Savings Breakdown</div>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)} style={{ width: 200 }}>
            {DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 10 }}>
          <CostEntityTable
            items={[...items].filter((i) => i.potentialSavings > 0).sort((a, b) => b.potentialSavings - a.potentialSavings)}
            nameLabel={activeDimension.label.replace('By ', '')}
            onSelect={(r) => setSelected(r.name)}
            currency={currency}
          />
        </div>
      </div>
    </div>
  )
}
