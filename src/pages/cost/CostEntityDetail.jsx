import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import KpiCard from '../../components/KpiCard'
import ExportMenu from '../../components/ExportMenu'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../../components/charts/ChartAxisTick'
import CostEntityTable, { CostRecordRows } from './CostEntityTable'
import BrandLogo from '../../components/BrandLogo'
import { formatMoney } from '../../utils/currency'
import { DollarSign, TrendingUp, BadgeCheck, PiggyBank } from 'lucide-react'

// Shared drill-down shell for every Cost entity detail (Product/Department/
// VBU/Domain) — costAnalytics.js's server-side detail endpoints all return
// the same { summary, rows, byX... } shape, so this is the one place that
// shape is rendered rather than four near-identical detail pages.
// `titleLogo`: { provider, product } — only passed when this detail IS a
// product (Department/VBU/Domain names aren't brands, so their own detail
// view omits it).
export default function CostEntityDetail({
  title, subtitle, titleLogo, detail, currency = 'USD', onBack, breakdowns = [], onExport, onOpenUser
}) {
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))
  const s = detail.summary

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>}
          {titleLogo && <BrandLogo product={titleLogo.product} provider={titleLogo.provider} size="md" />}
          <div>
            <h4 style={{ margin: 0 }}>{title}</h4>
            {subtitle && <div className="muted small" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
        </div>
        {onExport && <ExportMenu label="Export" onExport={onExport} />}
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
        <KpiCard color="blue" icon={<DollarSign size={16} />} title="Monthly Cost" value={money(s.monthlyCost)} />
        <KpiCard color="purple" icon={<TrendingUp size={16} />} title="Annual Cost" value={money(s.annualCost)} />
        <KpiCard color="green" icon={<BadgeCheck size={16} />} title="Active Cost" value={money(s.activeCost)} sub={`${s.activeLicenses} active licenses`} />
        <KpiCard color="purple" icon={<PiggyBank size={16} />} title="Potential Savings" value={money(s.potentialSavings)} sub={s.potentialAnnualSavings ? `${money(s.potentialAnnualSavings)}/year` : null} />
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        {s.users.toLocaleString()} users · {s.licenses.toLocaleString()} licenses · {s.costCoveragePct !== null ? `${s.costCoveragePct}% priced` : 'pricing coverage N/A'}
        {s.missingPricingCount > 0 ? ` · ${s.missingPricingCount} license(s) missing pricing` : ''}
      </div>

      {breakdowns.map((b) => (
        <div key={b.key} style={{ marginTop: 20 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>{b.label}</div>
          {b.chart && b.items.length > 0 && (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(b.items.length, { min: 140 })}>
              <BarChart data={b.items.map((x) => ({ name: x.name, value: x.monthlyCost }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#0b5fff" radius={[0, 4, 4, 0]} cursor={b.onSelect ? 'pointer' : undefined} onClick={(d) => b.onSelect && d?.name && b.onSelect(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div style={{ marginTop: b.chart ? 10 : 0 }}>
            <CostEntityTable items={b.items} nameLabel={b.nameLabel || b.label} onSelect={b.onSelect ? (r) => b.onSelect(r.name) : undefined} currency={currency} showLogo={(b.nameLabel || b.label) === 'Product'} />
          </div>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Records ({detail.rows.length})</div>
        <CostRecordRowsClickable rows={detail.rows} currency={currency} onOpenUser={onOpenUser} />
      </div>
    </div>
  )
}

// Same shape as CostRecordRows, with the user name/email made clickable
// into the shared canonical User Detail view (Part 14 — reuse, not a new
// user-cost model).
function CostRecordRowsClickable({ rows, currency, onOpenUser }) {
  if (!onOpenUser) return <CostRecordRows rows={rows} currency={currency} />
  return (
    <div className="table" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>User</th><th>Email</th><th>Department</th><th>VBU</th><th>Domain</th>
            <th>Product</th><th>Plan</th><th>Usage Status</th><th>Monthly Cost</th><th>Cost Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.user_email ? `${r.user_email}-${r.product}-${i}` : i} className="clickable-row" onClick={() => onOpenUser(r.user_id || r.user_email)}>
              <td><span className="link-text">{r.user_name || 'N/A'}</span></td>
              <td>{r.user_email || 'N/A'}</td>
              <td>{r.department || 'N/A'}</td>
              <td>{r.vbu || 'N/A'}</td>
              <td>{r.domain || 'N/A'}</td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <BrandLogo product={r.product} provider={r.provider} size="xs" />
                  {r.product || 'N/A'}
                </span>
              </td>
              <td>{Array.isArray(r.plan_conflict) && r.plan_conflict.length ? 'Plan Conflict' : (r.plan || 'N/A')}</td>
              <td>{r.usage_status || 'N/A'}</td>
              <td>{r.display_cost === null || r.display_cost === undefined ? 'N/A' : formatMoney(r.display_cost, currency, { maximumFractionDigits: 2 })}</td>
              <td>{r.cost_label || 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
