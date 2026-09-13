import React from 'react'
import KpiCard from '../components/KpiCard'
import ChartCard from '../components/ChartCard'
import QuickFilterBar from '../components/QuickFilterBar'
import ActiveFilterBar from '../components/ActiveFilterBar'
import InsightCard from '../components/InsightCard'
import EmptyState from '../components/EmptyState'
import { colorForProduct } from '../utils/productColors'
import { capabilitiesForProduct } from '../utils/providerRegistry'
import { formatMoney } from '../utils/currency'
import { aggregateTopActivities } from '../utils/activityMetrics'
import { TruncatedAxisTick, horizontalBarChartHeight, CHART_HEIGHT_COMPACT, CHART_HEIGHT_ROOMY } from '../components/charts/ChartAxisTick'
import {
  Users as UsersIcon, IdCard, BadgeCheck, Activity, DollarSign, PiggyBank, CircleOff, Link2,
  Database, ArrowRight, MessageSquare, Code2, FileCode, FolderKanban, Boxes,
  Zap, MessageCircle, Send, Hash, Sparkles, GitBranch
} from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend
} from 'recharts'

const ACTIVE_COLOR = '#059669'
const UNUSED_COLOR = '#dc2626'
const ACTIVE_STATUSES = ['Active', 'Heavily Active']
const LOW_STATUSES = ['Low Activity', 'No Usage']

// Presentation-only icon per activity metric key (src/utils/
// activityMetrics.js owns the data/labels; this is purely which glyph to
// show next to each). Falls back to a generic Activity icon for any key
// not listed here, so a future product's metric never breaks rendering.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "2026-02" -> "Feb 2026" — costAnalytics.js#costTrend's own month keys are
// always plain YYYY-MM strings (real calendar months from kiro_usage_monthly
// / Claude snapshot timestamps), never re-derived here.
function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey).split('-')
  const idx = Number(month) - 1
  return idx >= 0 && idx < 12 ? `${MONTH_ABBR[idx]} ${year}` : monthKey
}

const ACTIVITY_ICONS = {
  chats_messages: MessageSquare, code_sessions: Code2, file_edits: FileCode, projects: FolderKanban, artifacts_created: Boxes,
  kiro_credits_used: Zap, kiro_chat_conversations: MessageCircle, kiro_total_messages: MessageSquare,
  claude_requests: Send, claude_tokens: Hash,
  ms_copilot_prompts: Sparkles, ms_copilot_interactions: Sparkles,
  gh_chat_requests: GitBranch, gh_code_completions: Code2, gh_activity: GitBranch
}

export default function Overview({ data, allData, canonicalUsers, summary, globalFilters, setFilter, clearFilter, clearAllFilters, navigate, connectedCount, csvSources, apiConnections, currency = 'USD', costTrend }) {
  const money = (v) => formatMoney(v, currency)
  if (!allData || allData.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <Database size={40} style={{ color: '#c3cbd9', marginBottom: 12 }} />
        <h3>No usage data connected yet</h3>
        <p className="muted">Connect a data source or import a usage report to start tracking:</p>
        <ul style={{ listStyle: 'none', padding: 0, color: '#555', lineHeight: 1.8 }}>
          <li>License usage</li>
          <li>User activity</li>
          <li>Department costs</li>
          <li>Product usage</li>
          <li>Application usage</li>
          <li>Cost optimization</li>
        </ul>
        <button className="button primary" onClick={() => navigate && navigate('/data-sources')} style={{ marginTop: 12 }}>
          Go to Data Sources <ArrowRight size={16} />
        </button>
      </div>
    )
  }


  // ---- Derived, presentation-only aggregates (calculations.js untouched) ----
  const byProduct = {}
  const byDepartmentUsage = {}
  data.forEach((r) => {
    const prod = r.product || 'Unknown'
    if (!byProduct[prod]) byProduct[prod] = { total: 0, active: 0, activity: 0 }
    byProduct[prod].total += 1
    const activity = Number(r.activity_count) || 0
    if (activity > 0) byProduct[prod].active += 1
    byProduct[prod].activity += activity
    // department is Microsoft-authoritative (src/utils/userModel.js) by the
    // time it reaches this flat record (see src/App.jsx's per-record
    // overwrite) — a genuinely blank Microsoft department is "N/A", never
    // "Unknown"; a record with no Microsoft match at all should already
    // have been excluded upstream by its own provider's normalizer, not
    // bucketed here under either label.
    const dept = r.department || 'N/A'
    byDepartmentUsage[dept] = (byDepartmentUsage[dept] || 0) + activity
  })
  // A capability-less product (Freshservice today — usageTrackingSupported:
  // false, see src/utils/providerRegistry.js#PRODUCT_CAPABILITIES) has no
  // activity_count of any kind — it always coerces to `active: 0`, above,
  // which previously rendered as a real, misleading "0% utilization" bar
  // (implying "we measured usage and nobody used it," which is false: usage
  // was never measured at all). Excluded here entirely rather than shown as
  // 0%/N/A, matching how this same chart already omits a product with zero
  // records — a bar chart has no meaningful way to plot "not applicable."
  const utilizationByProduct = Object.entries(byProduct)
    .filter(([name]) => capabilitiesForProduct(name).usageTrackingSupported)
    .map(([name, v]) => ({ name, value: v.total ? Math.round((v.active / v.total) * 100) : 0 }))
  const usageByDeptData = Object.entries(byDepartmentUsage).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  const spendByDeptData = Object.entries(summary.costByDepartment || {}).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 10)
  const costByProductData = Object.entries(summary.costByProduct || {}).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).filter(d => d.value > 0)
  const licensesByProductData = Object.entries(summary.licensesByProduct || {}).map(([name, value]) => ({ name, value }))

  // CANONICAL users, not flat per-product records (Part 11 of the
  // canonical-identity spec this implements) — a real person with two
  // products no longer appears twice, "Product" shows every product they
  // actually use, and — since a canonical user's `name` is Microsoft-
  // authoritative (userModel.js) with no per-record fallback — a person
  // with no Microsoft match at all simply isn't in `canonicalUsers` (each
  // provider's own normalizer already excludes them), so no blank name can
  // ever reach this table.
  const people = canonicalUsers || []
  const topUsers = [...people].sort((a, b) => (Number(b.activity_count) || 0) - (Number(a.activity_count) || 0)).slice(0, 5)
  const lowUsageUsers = people.filter((u) => u.usage_status === 'No Usage' || u.usage_status === 'Low Activity')
    .sort((a, b) => (Number(a.activity_count) || 0) - (Number(b.activity_count) || 0)).slice(0, 5)

  // Product-aware Top Activities (src/utils/activityMetrics.js) — real,
  // per-product metrics from whichever sources are actually connected,
  // never a single generic "Chats/Messages" bucket regardless of product.
  // Operates on `data` (the already VBU/population-scoped AND currently-
  // filtered dataset, same input every other chart on this page already
  // aggregates over) — never re-derives scope itself.
  const activities = aggregateTopActivities(data).map((a) => ({ ...a, Icon: ACTIVITY_ICONS[a.key] || Activity }))

  // ---- KPI tiles (N/A when data doesn't exist — never fabricated as 0) ----
  // LICENSE STATUS vs USAGE STATUS: "Unused" here means active/assigned
  // licenses with no recorded usage (src/utils/calculations.js) — NOT a
  // license that's inactive/unassigned. Those are two different numbers;
  // see summary.inactiveLicenses if that distinction is ever needed here.
  const unusedLicenses = summary.unusedLicenses || 0
  const spendValue = summary.monthlyCost || summary.totalEstimatedSpend
  const spendLabel = summary.monthlyCost ? 'Total Spend' : 'Estimated Spend'
  const activeVsUnused = summary.totalLicenses ? [
    { name: 'Used', value: summary.usedLicenses || 0 },
    { name: 'Unused', value: unusedLicenses },
    { name: 'Low Usage', value: summary.lowUsageLicenses || 0 },
    { name: 'Inactive', value: summary.inactiveLicenses || 0 }
  ].filter((d) => d.value > 0) : []

  // ---- AI License Health insights — only shown when calculable ----
  // Each meaningful insight carries an onClick that navigates to the page
  // that actually contains the data behind the number, applying the same
  // filter this page would use for the equivalent KPI — reuses the exact
  // existing setFilter/navigate mechanism (no second filter/routing system).
  const insights = []
  if (summary.totalLicenses > 0) {
    insights.push({
      tone: 'good', title: `License utilization is ${summary.licenseUtil}%`, sub: `${summary.usedLicenses} of ${summary.activeLicenses} active licenses in use`,
      onClick: () => { clearAllFilters(); navigate('/users') }
    })
  }
  if (unusedLicenses > 0) {
    insights.push({
      tone: 'warn', title: `${unusedLicenses} license${unusedLicenses === 1 ? '' : 's'} are currently unused`,
      sub: summary.potentialSavings ? `Potential savings: ${money(summary.potentialSavings)} — click to view these licenses` : 'Click to view these licenses',
      onClick: () => { setFilter('usage_status', { type: 'category', values: ['No Usage'] }); navigate('/optimization') }
    })
  }
  const topProductEntry = Object.entries(byProduct).sort((a, b) => b[1].activity - a[1].activity)[0]
  if (topProductEntry && topProductEntry[1].activity > 0) {
    const topProductName = topProductEntry[0]
    insights.push({
      tone: 'info', title: `${topProductName} has the highest activity`, sub: `${topProductEntry[1].activity.toLocaleString()} total activity events`,
      onClick: () => { setFilter('product', { type: 'category', values: [topProductName] }); navigate('/products') }
    })
  }
  if (lowUsageUsers.length > 0) {
    const total = data.filter(r => r.usage_status === 'No Usage' || r.usage_status === 'Low Activity').length
    insights.push({
      tone: 'warn', title: `${total} user${total === 1 ? '' : 's'} have low or no recent activity`, sub: 'Click to review these users',
      onClick: () => { setFilter('usage_status', { type: 'category', values: LOW_STATUSES }); navigate('/users') }
    })
  }
  const erroredSources = [...(apiConnections || []).filter(c => c.status === 'error'), ...Object.values(csvSources || {}).filter(c => c.status === 'error')]
  if ((apiConnections || []).length + Object.keys(csvSources || {}).length > 0) {
    insights.push(erroredSources.length === 0
      ? { tone: 'good', title: 'All connected data sources are up to date' }
      : { tone: 'warn', title: `${erroredSources.length} data source${erroredSources.length === 1 ? '' : 's'} need attention`, sub: 'Click to see status/error details', onClick: () => navigate('/data-sources') })
  }

  return (
    <div>
      <QuickFilterBar
        quickKeys={['product', 'department', 'plan', 'usage_status']}
        moreKeys={['role', 'license_status']}
        allData={allData}
        filters={globalFilters}
        onSetFilter={setFilter}
        onClearFilter={clearFilter}
        showSearch={false}
      />
      <ActiveFilterBar
        filters={globalFilters}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        shownCount={data.length}
        totalCount={allData.length}
        itemLabel="records"
      />

      <div className="kpi-row">
        <KpiCard color="blue" icon={<UsersIcon size={17} />} title="Total Users" value={canonicalUsers ? canonicalUsers.length : 0} sub="Across all connected platforms" onClick={() => navigate('/users')} />
        <KpiCard color="purple" icon={<IdCard size={17} />} title="Total Licenses" value={summary.totalLicenses ?? 'N/A'} sub="Assigned licenses" onClick={() => navigate('/products')} />
        <KpiCard color="green" icon={<BadgeCheck size={17} />} title="Active Licenses" value={summary.activeLicenses ?? 'N/A'} sub="Currently active" onClick={() => { setFilter('usage_status', { type: 'category', values: ACTIVE_STATUSES }); navigate('/users') }} />
        <KpiCard color="orange" icon={<Activity size={17} />} title="License Utilization" value={summary.totalLicenses ? summary.licenseUtil + '%' : 'N/A'} sub={summary.totalLicenses ? `${summary.activeLicenses} of ${summary.totalLicenses} active` : null} onClick={summary.totalLicenses ? () => navigate('/users') : undefined} />
        <KpiCard color="blue" icon={<DollarSign size={17} />} title={spendLabel} value={spendValue ? money(spendValue) : 'N/A'} sub="Monthly" onClick={spendValue ? () => navigate('/cost') : undefined} />
        <KpiCard color="purple" icon={<PiggyBank size={17} />} title="Potential Savings" value={summary.potentialSavings ? money(summary.potentialSavings) : 'N/A'} sub="Unused + low usage" onClick={summary.potentialSavings ? () => navigate('/optimization') : undefined} />
        <KpiCard color="red" icon={<CircleOff size={17} />} title="Unused Licenses" value={summary.totalLicenses ? unusedLicenses : 'N/A'} sub="Not used recently" onClick={() => { setFilter('usage_status', { type: 'category', values: ['No Usage'] }); navigate('/optimization') }} />
        <KpiCard color="teal" icon={<Link2 size={17} />} title="Connected Sources" value={connectedCount ?? 'N/A'} sub="Data sources connected" onClick={() => navigate('/data-sources')} />
      </div>

      {insights.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>License Health</div>
          <div className="insight-row">
            {insights.map((i, idx) => <InsightCard key={idx} tone={i.tone} title={i.title} sub={i.sub} onClick={i.onClick} />)}
          </div>
        </div>
      )}

      {data.length === 0 ? (
        <EmptyState title="No records match the selected filters" hint="Try removing a filter to see results." />
      ) : (
      <div className="charts">
        <ChartCard title="Spend by Product">
          {costByProductData.length === 0 ? <EmptyState title="No cost data available" hint="Cost information will appear when a source provides spend data." /> : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
              <PieChart>
                <Pie data={costByProductData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}
                  onClick={(d) => d?.name && setFilter('product', { type: 'category', values: [d.name] })}>
                  {costByProductData.map((entry, i) => <Cell key={i} fill={colorForProduct(entry.name)} cursor="pointer" />)}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Licenses by Product">
          {licensesByProductData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
              <PieChart>
                <Pie data={licensesByProductData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}
                  onClick={(d) => d?.name && setFilter('product', { type: 'category', values: [d.name] })}>
                  {licensesByProductData.map((entry, i) => <Cell key={i} fill={colorForProduct(entry.name)} cursor="pointer" />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="License Utilization by Product" subtitle="% of licenses active">
          {utilizationByProduct.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_COMPACT}>
              <BarChart data={utilizationByProduct} onClick={(e) => e?.activeLabel && setFilter('product', { type: 'category', values: [e.activeLabel] })}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis unit="%" width={32} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => v + '%'} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor="pointer">
                  {utilizationByProduct.map((entry, i) => <Cell key={i} fill={colorForProduct(entry.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Cost Trend"
          subtitle="Monthly"
          footer={costTrend?.available && costTrend.note ? costTrend.note : undefined}
        >
          {/* Real, server-computed monthly series (server/services/
              costAnalytics.js#costTrend) — reconstructed from Kiro's own
              per-month usage table and Claude's historical MTD snapshots,
              priced at today's configured cost_rule (the same seat-based
              pricing already used for the current month), never a
              fabricated/synthetic value. `available:false` only when
              there is genuinely no historical data AND no current cost at
              all for this VBU scope — see that function's own comment. */}
          {!costTrend?.available || !costTrend.months?.length ? (
            <EmptyState title="Historical cost trend unavailable" hint="Historical monthly cost snapshots are not available yet." />
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_COMPACT}>
              <LineChart data={costTrend.months.map((m) => ({ ...m, label: formatMonthLabel(m.month) }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v) => money(v)} />
                <Line type="monotone" dataKey="total" stroke="#0b5fff" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Active vs Unused Licenses">
          {activeVsUnused.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
              <PieChart>
                <Pie data={activeVsUnused} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}
                  onClick={(d) => d?.name && setFilter('usage_status', { type: 'category', values: d.name === 'Active' ? ACTIVE_STATUSES : ['No Usage'] })}>
                  <Cell fill={ACTIVE_COLOR} cursor="pointer" />
                  <Cell fill={UNUSED_COLOR} cursor="pointer" />
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} (${summary.totalLicenses ? Math.round((v / summary.totalLicenses) * 100) : 0}%)`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Usage by Department" subtitle="Total activity events — top 10, highest first — hover a name for the full value">
          {usageByDeptData.length === 0 ? <EmptyState title="No department data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(usageByDeptData.length)}>
              <BarChart data={usageByDeptData} layout="vertical" margin={{ left: 8, right: 8 }}
                onClick={(e) => e?.activeLabel && setFilter('department', { type: 'category', values: [e.activeLabel] })}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip />
                <Bar dataKey="value" fill="#0b5fff" radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Spend by Department" subtitle="Top 10, highest first — hover a name for the full value">
          {spendByDeptData.length === 0 ? <EmptyState title="No cost data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(spendByDeptData.length)}>
              <BarChart data={spendByDeptData} layout="vertical" margin={{ left: 8, right: 8 }}
                onClick={(e) => e?.activeLabel && setFilter('department', { type: 'category', values: [e.activeLabel] })}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#7c3aed" radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top Users by Usage">
          {topUsers.length === 0 ? <EmptyState /> : (
            <div>
              <div className="table table-compact" style={{ border: 'none', padding: 0, boxShadow: 'none' }}>
                <table>
                  <thead><tr><th>User</th><th>Product</th><th>Usage</th><th>Spend</th></tr></thead>
                  <tbody>
                    {topUsers.map((u) => (
                      <tr key={u._id}>
                        <td>{u.name || 'N/A'}</td>
                        <td>{Array.isArray(u.product) && u.product.length ? u.product.join(', ') : 'N/A'}</td>
                        <td>{(u.activity_count ?? 0).toLocaleString()}</td>
                        <td>{u.totalSpend !== null && u.totalSpend !== undefined ? money(u.totalSpend) : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="view-all-link" onClick={() => navigate('/users')}>View all users <ArrowRight size={14} /></button>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Low / No Usage Users">
          {lowUsageUsers.length === 0 ? <EmptyState title="No low-usage users" hint="Everyone is actively using their license." /> : (
            <div>
              <div className="table table-compact" style={{ border: 'none', padding: 0, boxShadow: 'none' }}>
                <table>
                  <thead><tr><th>User</th><th>Last Active</th><th>Product</th></tr></thead>
                  <tbody>
                    {lowUsageUsers.map((u) => (
                      <tr key={u._id}><td>{u.name || 'N/A'}</td><td>{u.last_activity || 'N/A'}</td><td>{Array.isArray(u.product) && u.product.length ? u.product.join(', ') : 'N/A'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="view-all-link" onClick={() => { setFilter('usage_status', { type: 'category', values: LOW_STATUSES }); navigate('/users') }}>View all low-usage users <ArrowRight size={14} /></button>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Top Activities" subtitle="All platforms">
          {activities.length === 0 ? <EmptyState /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activities.map((a) => (
                <div key={a.label} className="activity-row">
                  <span className="activity-row-label"><a.Icon size={15} /> {a.label}</span>
                  <strong>{a.value.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
      )}

      <div className="info-bar">
        <span>All data is aggregated from connected platforms. Currency: {currency} (configurable on the Cost page).</span>
      </div>
    </div>
  )
}
