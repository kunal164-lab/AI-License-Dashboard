import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import KpiCard from '../components/KpiCard'
import ChartCard from '../components/ChartCard'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import ActiveFilterBar from '../components/ActiveFilterBar'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../components/charts/ChartAxisTick'
import { classifyUsers } from '../utils/activityScore'
import { isLicenseActive } from '../utils/licenseStatus'
import { buildOptimizationReportModel } from '../reports/reportBuilder'
import { formatMoney } from '../utils/currency'
import { CircleOff, CircleAlert, AlertTriangle, PiggyBank, Wallet, FileDown, Ban } from 'lucide-react'

// department/vbu are Microsoft 365's authoritative canonical fields by the
// time records reach this page (resolved once in src/App.jsx's allRecords
// memo from the synced Microsoft directory — see src/utils/userModel.js) —
// grouping directly by r.department/r.vbu here is never a per-source raw
// value, never a fallback across providers, and a record with no Microsoft
// directory match is correctly excluded rather than bucketed as "Unknown"
// (matching the same "never fabricate a group" rule server/services/
// costAnalytics.js#aggregateBy already follows).
function groupSpendBy(records, key) {
  const map = new Map()
  for (const r of records) {
    const value = r[key]
    if (!value) continue
    if (!map.has(value)) map.set(value, { name: value, count: 0, spend: 0 })
    const entry = map.get(value)
    entry.count += 1
    entry.spend += (r.display_cost === null || r.display_cost === undefined) ? 0 : Number(r.display_cost)
  }
  return Array.from(map.values()).sort((a, b) => b.spend - a.spend || b.count - a.count)
}

// display_cost is the centralized cost engine's one authoritative figure
// per record (server/services/costEngine.js) — this used to be a locally
// duplicated spendFor(), now removed in favor of the one calculation layer.
function spendFor(u) { return (u.display_cost === null || u.display_cost === undefined) ? 0 : Number(u.display_cost) }

// `data` is already the globally-filtered dataset by the time it reaches
// here, so every KPI/table below is automatically filter-aware for free.
export default function Optimization({ data, allData, globalFilters, setFilter, clearFilter, clearAllFilters, onOpenReport, currency = 'USD' }) {
  const money = (v) => formatMoney(v, currency, { maximumFractionDigits: 2 })
  const groups = classifyUsers(data)
  // LICENSE STATUS vs USAGE STATUS (src/utils/licenseStatus.js): "Unused"/
  // "Low Usage" recommendations only ever apply to licenses that are
  // themselves still active/assigned — a license that's already
  // inactive/unassigned isn't an optimization candidate to "consider
  // removing," it's already gone, so it's tracked separately below instead
  // of inflating the unused/low-usage counts.
  const unused = (groups['No Usage'] || []).filter(isLicenseActive)
  const lowUsage = (groups['Low Activity'] || []).filter(isLicenseActive)
  const inactiveLicenses = data.filter((u) => !isLicenseActive(u))
  const highCostLowUsage = [...unused, ...lowUsage].filter((u) => spendFor(u) > 0)

  const potentialSavings = unused.reduce((s, u) => s + spendFor(u), 0) + lowUsage.reduce((s, u) => s + spendFor(u), 0)

  const recommendations = [
    ...unused.map((u) => ({ ...u, recommendation: 'Consider removal', savings: spendFor(u) })),
    ...lowUsage.map((u) => ({ ...u, recommendation: 'Review / Consider downgrade', savings: spendFor(u) }))
  ].sort((a, b) => b.savings - a.savings)

  // Unused Licenses by Department / Potential Savings by VBU — department
  // and vbu are Microsoft 365's authoritative fields on every record here
  // (see groupSpendBy's comment above); "potential savings" pool matches
  // exactly what feeds the Potential Savings KPI above (unused + low-usage).
  const unusedByDepartment = useMemo(() => groupSpendBy(unused, 'department'), [unused])
  const savingsByVbu = useMemo(() => groupSpendBy([...unused, ...lowUsage], 'vbu'), [unused, lowUsage])

  function exportPdf() {
    onOpenReport({
      title: 'AI License Optimization Report',
      buildModel: buildOptimizationReportModel,
      filePrefix: 'Internal_IT_Optimization_Report'
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Cost &amp; License Optimization</h3>
        <button className="button secondary" onClick={exportPdf}><FileDown size={16} /> Export PDF</button>
      </div>
      <ActiveFilterBar
        filters={globalFilters}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        shownCount={data.length}
        totalCount={(allData || data).length}
        itemLabel="records"
      />

      <div className="card" style={{ background: 'linear-gradient(135deg,#eef4ff,#ffffff)' }}>
        <div className="card-title">Potential Savings</div>
        <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>{potentialSavings ? money(potentialSavings) : 'N/A'}</div>
        <div className="small muted">From unused and low-usage licenses this period</div>
      </div>

      <div className="kpi-row">
        <KpiCard color="red" icon={<CircleOff size={16} />} title="Unused Licenses" value={unused.length} sub="Active license, zero activity" onClick={() => setFilter('usage_status', { type: 'category', values: ['No Usage'] })} />
        <KpiCard color="orange" icon={<CircleAlert size={16} />} title="Low Usage Licenses" value={lowUsage.length} sub="Active license, minimal activity" onClick={() => setFilter('usage_status', { type: 'category', values: ['Low Activity'] })} />
        <KpiCard color="red" icon={<AlertTriangle size={16} />} title="High Cost / Low Usage" value={highCostLowUsage.length} sub="Costing money, rarely used" />
        <KpiCard color="purple" icon={<PiggyBank size={16} />} title="Potential Monthly Savings" value={potentialSavings ? money(potentialSavings) : 'N/A'} />
        <KpiCard color="purple" icon={<Wallet size={16} />} title="Potential Annual Savings" value={potentialSavings ? money(potentialSavings * 12) : 'N/A'} />
        <KpiCard color="teal" icon={<Ban size={16} />} title="Inactive Licenses" value={inactiveLicenses.length} sub="Not currently assigned — already not costing a seat" />
      </div>

      {(unusedByDepartment.length > 0 || savingsByVbu.length > 0) && (
        <div className="charts-2col">
          {unusedByDepartment.length > 0 && (
            <ChartCard title="Unused Licenses by Department" subtitle="Department is Microsoft 365's authoritative value — click a bar to filter">
              <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(unusedByDepartment.length, 15))}>
                <BarChart data={unusedByDepartment.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                  <Tooltip formatter={(value, name) => (name === 'count' ? [value, 'Unused Licenses'] : [money(value), 'Spend'])} />
                  <Bar dataKey="count" fill="#dc2626" name="count" radius={[0, 4, 4, 0]} cursor="pointer"
                    onClick={(d) => d?.name && setFilter('department', { type: 'category', values: [d.name] })} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {savingsByVbu.length > 0 && (
            <ChartCard title="Potential Savings by VBU" subtitle="VBU is Microsoft 365's extensionAttribute3 — click a bar to filter">
              <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(savingsByVbu.length, 15))}>
                <BarChart data={savingsByVbu.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                  <Tooltip formatter={(value) => money(value)} />
                  <Bar dataKey="spend" fill="#7c3aed" name="Potential Savings" radius={[0, 4, 4, 0]} cursor="pointer"
                    onClick={(d) => d?.name && setFilter('vbu', { type: 'category', values: [d.name] })} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Recommendations for IT Review</div>
        <div className="small muted" style={{ marginBottom: 10 }}>These are suggestions only — no licenses are removed automatically.</div>
        {recommendations.length === 0 ? (
          <EmptyState title="No optimization candidates" hint="All licenses show healthy usage." />
        ) : (
          <div className="table table-compact" style={{ boxShadow: 'none', border: 'none', padding: 0 }}>
            <table>
              <thead>
                <tr><th>User</th><th>Product</th><th>Plan</th><th>Usage</th><th>Spend</th><th>Recommendation</th><th>Potential Savings</th></tr>
              </thead>
              <tbody>
                {recommendations.slice(0, 100).map((u) => (
                  <tr key={u._id}>
                    <td>{u.name}</td>
                    <td>{u.product || 'N/A'}</td>
                    <td>{u.plan || u.seat_tier || 'N/A'}</td>
                    <td><StatusBadge status={u.usage_status} /></td>
                    <td>{u.savings ? money(u.savings) : 'N/A'}</td>
                    <td>{u.recommendation}</td>
                    <td>{u.savings ? money(u.savings) : 'N/A'}</td>
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
