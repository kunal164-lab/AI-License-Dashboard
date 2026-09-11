import React from 'react'
import { ArrowRight } from 'lucide-react'
import StatusBadge from '../../components/StatusBadge'
import BrandLogo from '../../components/BrandLogo'
import { formatMoney } from '../../utils/currency'

// Shared list table for every "Cost by X" aggregated view (Product,
// Department, VBU, Domain, Plan) — they all come from the same
// costAnalytics.js#aggregateBy shape server-side, so this is the one place
// that shape is rendered, instead of nine near-identical tables.
// `showLogo`: only meaningful for product/plan views (Department/VBU/
// Domain names aren't brands) — resolves via r.product (Plan view) or
// r.name (Product view), with r.provider alongside.
export default function CostEntityTable({ items, nameLabel = 'Name', extraColumns = [], onSelect, currency = 'USD', showLogo = false }) {
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))
  if (!items || !items.length) return <div className="muted small" style={{ padding: 12 }}>No data available for this view yet.</div>
  return (
    <div className="table" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>{nameLabel}</th>
            {extraColumns.map((c) => <th key={c.key}>{c.label}</th>)}
            <th>Users</th><th>Licenses</th><th>Active</th><th>No Usage</th>
            <th>Monthly Cost</th><th>Annual Cost</th><th>Potential Savings</th><th>Coverage</th>
            {onSelect && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.name} className={onSelect ? 'clickable-row' : undefined} onClick={onSelect ? () => onSelect(r) : undefined}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {showLogo && <BrandLogo product={r.product || r.name} provider={r.provider} size="xs" />}
                  <span className={onSelect ? 'link-text' : undefined}>{r.name}</span>
                </span>
              </td>
              {extraColumns.map((c) => <td key={c.key}>{c.render ? c.render(r) : (r[c.key] ?? 'N/A')}</td>)}
              <td>{r.users.toLocaleString()}</td>
              <td>{r.licenses.toLocaleString()}</td>
              <td>{r.activeLicenses.toLocaleString()}</td>
              <td>{r.unusedLicenses.toLocaleString()}</td>
              <td>{money(r.monthlyCost)}</td>
              <td>{money(r.annualCost)}</td>
              <td>{r.potentialSavings ? money(r.potentialSavings) : 'N/A'}</td>
              <td>{r.costCoveragePct !== null && r.costCoveragePct !== undefined ? `${r.costCoveragePct}%` : 'N/A'}</td>
              {onSelect && <td style={{ textAlign: 'right' }}><ArrowRight size={14} className="kpi-filter-hint" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Small shared row-line table for the underlying (user, product) records
// behind any aggregated group — used by every entity detail view's "rows"
// table and by the Savings drill-down (Part 20 of the spec).
export function CostRecordRows({ rows, currency = 'USD', showProduct = true, showDepartment = true }) {
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))
  if (!rows || !rows.length) return <div className="muted small" style={{ padding: 12 }}>No records.</div>
  return (
    <div className="table" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>User</th><th>Email</th>
            {showDepartment && <><th>Department</th><th>VBU</th><th>Domain</th></>}
            {showProduct && <th>Product</th>}
            <th>Plan</th><th>Usage Status</th><th>Monthly Cost</th><th>Cost Type</th><th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.user_email ? `${r.user_email}-${r.product}-${i}` : i}>
              <td>{r.user_name || 'N/A'}</td>
              <td>{r.user_email || 'N/A'}</td>
              {showDepartment && <><td>{r.department || 'N/A'}</td><td>{r.vbu || 'N/A'}</td><td>{r.domain || 'N/A'}</td></>}
              {showProduct && (
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <BrandLogo product={r.product} provider={r.provider} size="xs" />
                    {r.product || 'N/A'}
                  </span>
                </td>
              )}
              <td>
                {Array.isArray(r.plan_conflict) && r.plan_conflict.length
                  ? <span style={{ color: 'var(--bad)' }} title={`Conflicting plan values: ${r.plan_conflict.join(' vs ')}`}>Plan Conflict</span>
                  : (r.plan || 'N/A')}
              </td>
              <td><StatusBadge status={r.usage_status || 'Pending'} /></td>
              <td>{money(r.display_cost)}</td>
              <td>{r.cost_label || 'N/A'}</td>
              <td>{r._source || r.source || 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
