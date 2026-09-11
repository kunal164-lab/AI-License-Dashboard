import React, { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import {
  DollarSign, TrendingUp, Users as UsersIcon, BadgeCheck, CircleAlert, PiggyBank, Wallet
} from 'lucide-react'
import KpiCard from '../../components/KpiCard'
import ChartCard from '../../components/ChartCard'
import EmptyState from '../../components/EmptyState'
import QuickFilterBar from '../../components/QuickFilterBar'
import ActiveFilterBar from '../../components/ActiveFilterBar'
import DataTable from '../../components/DataTable'
import ExportMenu from '../../components/ExportMenu'
import StatusBadge from '../../components/StatusBadge'
import UserDetail from '../../components/UserDetail'
import BrandLogo from '../../components/BrandLogo'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../../components/charts/ChartAxisTick'
import { formatMoney } from '../../utils/currency'
import { describeFilters } from '../../utils/tableFilters'
import { exportCostRows } from './costRowsExport'
import toast from '../../utils/toast'

// Local, page-scoped column registry — flattenForCost's rows (one row per
// person per product) use user_email/user_name/license_status/usage_status
// field names, not the canonical-user-level keys src/utils/columnRegistry.js
// already has, so a small map lives here instead of overloading that
// app-wide registry with cost-row-only fields.
const FILTER_COLUMNS = {
  vbu: { key: 'vbu', name: 'VBU', type: 'category' },
  department: { key: 'department', name: 'Department', type: 'category' },
  provider: { key: 'provider', name: 'Provider', type: 'category' },
  product: { key: 'product', name: 'Product', type: 'category' },
  plan: { key: 'plan', name: 'License / Plan', type: 'category' },
  usage_status: { key: 'usage_status', name: 'Usage Status', type: 'category' },
  license_status: { key: 'license_status', name: 'License Status', type: 'category' },
  domain: { key: 'domain', name: 'Domain', type: 'category' },
  user_email: { key: 'user_email', name: 'User', type: 'category' }
}
// A handful of always-visible quick filters (Part 13 of the spec this
// implements warns against "excessive dropdowns") plus a collapsible "More
// Filters" for the rest — the same QuickFilterBar/ActiveFilterBar pattern
// every other filterable page in this app already uses.
const QUICK_KEYS = ['vbu', 'department', 'provider', 'product']
const MORE_KEYS = ['plan', 'usage_status', 'license_status', 'domain', 'user_email']
const ACTIVE_STATUSES = ['Active', 'Heavily Active']
const LOW_STATUSES = ['Low Activity', 'No Usage']

// filter-object key -> server query-param name, only where they differ.
const QUERY_PARAM_NAME = { usage_status: 'usageStatus', license_status: 'licenseStatus', user_email: 'user' }
function toQueryParams(filters) {
  const params = new URLSearchParams()
  for (const [key, filter] of Object.entries(filters || {})) {
    if (!filter || !filter.values?.length) continue
    params.set(QUERY_PARAM_NAME[key] || key, filter.values.join(','))
  }
  return params
}

// Cost -> By VBU: a full analytics dashboard, not just a table. VBU is
// Microsoft 365's authoritative field on every row already (see
// server/services/costAnalytics.js#flattenForCost / src/utils/userModel.js)
// — this page never derives, guesses, or falls back to another source for
// it; it only filters/groups by whatever the server already resolved.
// `selectedVbu`/`onSelectedVbuChange` are CONTROLLED by Cost.jsx (same
// pattern as CostDimensionView) so switching to another Cost view and back
// preserves the selected VBU, and selecting one here also updates the
// shared global filter state other pages read.
export default function CostByVbu({ currency = 'USD', selectedVbu, onSelectedVbuChange }) {
  const [filters, setFilters] = useState({})
  const [fullRows, setFullRows] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [userDetail, setUserDetail] = useState(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))

  // Full, unfiltered dataset — fetched once. Used ONLY to (a) populate the
  // filter dropdowns' available options (so e.g. Department always lists
  // every real department, not just ones present in the currently narrowed
  // result) and (b) as the "Export Complete Report" row source. KPIs,
  // charts, and the visible table always come from the server-filtered
  // `result` below instead — nothing here is recalculated client-side.
  useEffect(() => {
    fetch('/api/cost/by-vbu').then((r) => r.json()).then((j) => setFullRows(j.rows || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = toQueryParams(filters)
    if (selectedVbu) params.set('vbu', selectedVbu)
    fetch(`/api/cost/by-vbu?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error('Failed to load VBU cost data'); return r.json() })
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false))
  }, [filters, selectedVbu])

  // The full active-filter set (including VBU, which is controlled
  // separately) — used for the ActiveFilterBar chips, filter-dropdown
  // exclusion logic, and every export's "Filters Applied" description.
  const allFilters = useMemo(
    () => (selectedVbu ? { ...filters, vbu: { type: 'category', values: [selectedVbu] } } : filters),
    [filters, selectedVbu]
  )

  function setFilter(key, f) {
    if (key === 'vbu') { onSelectedVbuChange(f?.values?.[0] || null); return }
    setFilters((prev) => ({ ...prev, [key]: f }))
  }
  function clearFilter(key) {
    if (key === 'vbu') { onSelectedVbuChange(null); return }
    setFilters((prev) => { const n = { ...prev }; delete n[key]; return n })
  }
  function clearAllFilters() { setFilters({}); onSelectedVbuChange(null) }
  function setDimensionFilter(key, name) { setFilter(key, { type: 'category', values: [name] }) }

  function openUser(row) {
    const id = row.user_id || row.user_email
    if (!id) return
    setSelectedUserId(id)
    setLoadingUser(true)
    fetch(`/api/cost/users/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => setUserDetail(j.user))
      .finally(() => setLoadingUser(false))
  }

  async function handleExport(scope, format) {
    const rows = scope === 'filtered' ? (result?.rows || []) : fullRows
    if (!rows.length) { toast.info('Nothing to export.'); return }
    try {
      if (format === 'pdf') {
        const { downloadTabularDatasetPdf } = await import('../../reports/pdfReport.js')
        const columns = [
          { key: 'vbu', label: 'VBU' }, { key: 'department', label: 'Department' }, { key: 'user_name', label: 'User' },
          { key: 'provider', label: 'Provider' }, { key: 'product', label: 'Product' }, { key: 'plan', label: 'Plan' },
          { key: 'license_status', label: 'License Status' }, { key: 'usage_status', label: 'Usage Status' },
          { key: 'display_cost', label: 'Monthly Cost' }, { key: 'annual_cost', label: 'Annualized Cost' },
          { key: 'potential_monthly_savings', label: 'Potential Savings' }
        ]
        const filename = await downloadTabularDatasetPdf({
          title: 'Cost by VBU', columns, rows, scope,
          filtersApplied: scope === 'filtered' ? describeFilters(allFilters, FILTER_COLUMNS) : [],
          sources: [{ label: 'Cost Analytics' }], filePrefix: 'Internal_IT_Cost_VBU'
        })
        toast.success(`Downloaded ${filename}`)
        return
      }
      const filename = exportCostRows(rows, format, {
        scope, filters: scope === 'filtered' ? allFilters : {}, sheetName: 'Cost by VBU'
      })
      if (filename) toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
  }

  const columns = useMemo(() => ([
    { key: 'vbu', name: 'VBU', type: 'category', essential: true, render: (r) => r.vbu || 'N/A' },
    { key: 'department', name: 'Department', type: 'category', essential: true, render: (r) => r.department || 'N/A' },
    { key: 'user_name', name: 'User', type: 'text', essential: true, render: (r) => <span className="link-text">{r.user_name || 'N/A'}</span> },
    { key: 'provider', name: 'Provider', type: 'category' },
    {
      key: 'product', name: 'Product', type: 'category', essential: true,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <BrandLogo product={r.product} provider={r.provider} size="xs" />{r.product || 'N/A'}
        </span>
      )
    },
    { key: 'plan', name: 'License / Plan', type: 'category', render: (r) => (Array.isArray(r.plan_conflict) && r.plan_conflict.length ? 'Plan Conflict' : (r.plan || 'N/A')) },
    { key: 'license_status', name: 'License Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.license_status || 'Unknown'} /> },
    { key: 'usage_status', name: 'Usage Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.usage_status || 'Pending'} /> },
    { key: 'display_cost', name: 'Monthly Cost', type: 'number', essential: true, render: (r) => money(r.display_cost) },
    { key: 'annual_cost', name: 'Annualized Cost', type: 'number', render: (r) => money(r.annual_cost) },
    { key: 'potential_monthly_savings', name: 'Potential Savings', type: 'number', render: (r) => (r.potential_monthly_savings ? money(r.potential_monthly_savings) : 'N/A') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [currency])

  if (loading && !result) return <div className="muted">Loading VBU cost data...</div>
  if (!result) return <EmptyState title="Unable to load VBU cost data" hint="Try refreshing the page." />

  const s = result.summary
  const byVbuCost = result.byVbu.map((v) => ({ name: v.name, value: v.monthlyCost }))
  const byVbuLicenses = result.byVbu.map((v) => ({ name: v.name, value: v.licenses }))
  const byVbuSavings = result.byVbu.filter((v) => v.potentialSavings > 0).map((v) => ({ name: v.name, value: v.potentialSavings }))
  const byVbuActiveVsUnused = result.byVbu.map((v) => ({ name: v.name, active: v.activeCost, unused: v.unusedCost, lowUsage: v.lowUsageCost }))
  const byDepartment = result.byDepartment.map((d) => ({ name: d.name, value: d.monthlyCost }))
  const byProduct = result.byProduct.map((p) => ({ name: p.name, value: p.monthlyCost, provider: p.provider }))

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h4 style={{ margin: 0 }}>Cost by VBU</h4>
          <div className="muted small" style={{ marginTop: 4 }}>Analyze license cost, usage, and savings across business verticals.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ExportMenu label="Export Filtered Report" onExport={(fmt) => handleExport('filtered', fmt)} />
          <ExportMenu label="Export Complete Report" onExport={(fmt) => handleExport('complete', fmt)} />
        </div>
      </div>

      <QuickFilterBar
        quickKeys={QUICK_KEYS} moreKeys={MORE_KEYS} allData={fullRows} filters={allFilters}
        onSetFilter={setFilter} onClearFilter={clearFilter} showSearch={false} columnByKey={FILTER_COLUMNS}
      />
      <ActiveFilterBar
        filters={allFilters} onClearFilter={clearFilter} onClearAll={clearAllFilters}
        shownCount={result.rows.length} totalCount={fullRows.length} itemLabel="license records" columnByKey={FILTER_COLUMNS}
      />

      <div className="kpi-row">
        <KpiCard color="blue" icon={<DollarSign size={17} />} title="Total Monthly Cost" value={money(s.monthlyCost)} sub={`${s.licenses.toLocaleString()} licenses`} />
        <KpiCard color="purple" icon={<TrendingUp size={17} />} title="Annualized Cost" value={money(s.annualCost)} />
        <KpiCard color="teal" icon={<UsersIcon size={17} />} title="Licensed Users" value={s.users.toLocaleString()} />
        <KpiCard color="green" icon={<BadgeCheck size={17} />} title="Active License Cost" value={money(s.activeCost)} sub={`${s.activeLicenses.toLocaleString()} active`}
          onClick={() => setFilter('usage_status', { type: 'category', values: ACTIVE_STATUSES })} />
        <KpiCard color="orange" icon={<CircleAlert size={17} />} title="Low-Usage License Cost" value={money(s.lowUsageCost)} sub={`${s.lowUsageLicenses.toLocaleString()} low usage`}
          onClick={() => setFilter('usage_status', { type: 'category', values: ['Low Activity'] })} />
        <KpiCard color="purple" icon={<PiggyBank size={17} />} title="Potential Monthly Savings" value={money(s.potentialSavings)}
          onClick={() => setFilter('usage_status', { type: 'category', values: LOW_STATUSES })} />
        <KpiCard color="purple" icon={<Wallet size={17} />} title="Potential Annual Savings" value={money(s.potentialAnnualSavings)} />
      </div>

      <div className="charts-2col">
        <ChartCard title="Cost by VBU" subtitle="Monthly cost, highest first — click a bar to select that VBU">
          {byVbuCost.length === 0 ? <EmptyState title="No VBU cost data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(byVbuCost.length, { min: 180 })}>
              <BarChart data={byVbuCost} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#0891b2" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="License Count by VBU" subtitle="Assigned licenses/users — click a bar to select that VBU">
          {byVbuLicenses.length === 0 ? <EmptyState title="No VBU license data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(byVbuLicenses.length, { min: 180 })}>
              <BarChart data={byVbuLicenses} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip />
                <Bar dataKey="value" fill="#7c3aed" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Usage Status by VBU" subtitle="Cost tied to real usage vs. low-usage/no-usage licenses">
          {byVbuActiveVsUnused.length === 0 ? <EmptyState title="No VBU cost data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(byVbuActiveVsUnused.length, { min: 180 })}>
              <BarChart data={byVbuActiveVsUnused} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="active" stackId="cost" fill="#059669" name="Active" radius={[0, 0, 0, 0]} cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
                <Bar dataKey="lowUsage" stackId="cost" fill="#d97706" name="Low Usage" cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
                <Bar dataKey="unused" stackId="cost" fill="#dc2626" name="No Usage" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Potential Savings by VBU" subtitle="Unused/low-usage cost, highest first — click a bar to select that VBU">
          {byVbuSavings.length === 0 ? <EmptyState title="No potential savings identified" hint="Every priced license in scope currently shows healthy usage." /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(byVbuSavings.length, { min: 180 })}>
              <BarChart data={byVbuSavings} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#dc2626" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && onSelectedVbuChange(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Department" subtitle={selectedVbu ? `Within ${selectedVbu} — click a bar to filter` : 'All VBUs — click a bar to filter'}>
          {byDepartment.length === 0 ? <EmptyState title="No department data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(byDepartment.length, 15), { min: 180 })}>
              <BarChart data={byDepartment.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#0b5fff" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && setDimensionFilter('department', d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Product" subtitle={selectedVbu ? `Within ${selectedVbu} — click a bar to filter` : 'All VBUs — click a bar to filter'}>
          {byProduct.length === 0 ? <EmptyState title="No product data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(byProduct.length, 15), { min: 180 })}>
              <BarChart data={byProduct.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && setDimensionFilter('product', d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>License Records ({result.rows.length.toLocaleString()})</div>
        <DataTable
          columns={columns} data={result.rows} onRowClick={openUser} storageKey="cost-by-vbu"
          emptyState={<EmptyState title="No license records match the selected filters" hint="Try removing a filter to broaden the results." />}
        />
      </div>

      {selectedUserId && (
        loadingUser || !userDetail ? (
          <div className="modal-overlay" onClick={() => setSelectedUserId(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}><div className="muted">Loading user...</div></div>
          </div>
        ) : (
          <UserDetail user={userDetail} currency={currency} onClose={() => { setSelectedUserId(null); setUserDetail(null) }} />
        )
      )}
    </div>
  )
}
