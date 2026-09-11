import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import {
  DollarSign, TrendingUp, BadgeCheck, CircleAlert, PiggyBank, Wallet, PieChart as PieChartIcon, AlertTriangle
} from 'lucide-react'
import KpiCard from '../../components/KpiCard'
import ChartCard from '../../components/ChartCard'
import EmptyState from '../../components/EmptyState'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../../components/charts/ChartAxisTick'
import { colorForProduct } from '../../utils/productColors'
import { formatMoney } from '../../utils/currency'
import { useCostJson } from './useCostJson'

const PIE_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b']

// Landing view for Cost Analytics (Part 3 of the spec) — the executive
// summary + KPI/chart layer every other view's detail drill-down builds on.
// Every figure here comes straight from GET /api/cost/overview
// (server/services/costAnalytics.js) — nothing is recalculated client-side.
export default function CostOverview({ currency = 'USD', onOpenProduct, onOpenDepartment, onOpenVbu, onOpenMissingPricing }) {
  const { data, loading, error } = useCostJson('/api/cost/overview')
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))

  if (loading) return <div className="muted">Loading cost overview...</div>
  if (error || !data) return <EmptyState title="Unable to load cost overview" hint={error || 'Try refreshing the page.'} />

  const k = data.kpis
  const costByUsageStatus = [
    { name: 'Active', value: k.activeCost },
    { name: 'Low Usage', value: k.lowUsageCost },
    { name: 'No Usage', value: k.unusedCost }
  ].filter((d) => d.value > 0)

  return (
    <div>
      <div className="kpi-row">
        <KpiCard color="blue" icon={<DollarSign size={17} />} title="Total Monthly Cost" value={money(k.monthlyCost)} sub={`${k.licenses.toLocaleString()} licenses`} />
        <KpiCard color="purple" icon={<TrendingUp size={17} />} title="Annualized Cost" value={money(k.annualCost)} />
        <KpiCard color="green" icon={<BadgeCheck size={17} />} title="Active License Cost" value={money(k.activeCost)} sub={`${k.activeLicenses.toLocaleString()} active`} />
        <KpiCard color="orange" icon={<CircleAlert size={17} />} title="Low-Usage License Cost" value={money(k.lowUsageCost)} sub={`${k.lowUsageLicenses.toLocaleString()} low usage`} />
        <KpiCard color="purple" icon={<PiggyBank size={17} />} title="Potential Monthly Savings" value={money(k.potentialSavings)} />
        <KpiCard color="purple" icon={<Wallet size={17} />} title="Potential Annual Savings" value={money(k.potentialAnnualSavings)} />
        <KpiCard color="teal" icon={<PieChartIcon size={17} />} title="Cost Coverage" value={k.costCoveragePct !== null ? `${k.costCoveragePct}%` : 'N/A'} sub={`${k.licenses - k.missingPricingCount} of ${k.licenses} priced`} />
        <KpiCard color="red" icon={<AlertTriangle size={17} />} title="Missing Pricing" value={k.missingPricingCount} sub="licenses with no cost rule" onClick={onOpenMissingPricing} />
      </div>

      <div className="card" style={{ background: 'linear-gradient(135deg,#eef4ff,#ffffff)', marginTop: 4 }}>
        <div className="card-title">Current Cost vs. Potential Savings</div>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 10 }}>
          <div>
            <div className="small muted">Current Monthly License Cost</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{money(k.monthlyCost)}</div>
          </div>
          <div>
            <div className="small muted">Potential Monthly Savings</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--good)' }}>{money(k.potentialSavings)}</div>
          </div>
          <div>
            <div className="small muted">Potential Annual Savings</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--good)' }}>{money(k.potentialAnnualSavings)}</div>
          </div>
        </div>
      </div>

      <div className="charts">
        <ChartCard title="Cost by Product" subtitle="Top 10, highest first — hover a name for the full value">
          {data.byProduct.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(data.byProduct.length, 10))}>
              <BarChart data={data.byProduct.slice(0, 10).map((p) => ({ name: p.name, value: p.monthlyCost }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor={onOpenProduct ? 'pointer' : undefined} onClick={(d) => onOpenProduct && d?.name && onOpenProduct(d.name)}>
                  {data.byProduct.slice(0, 10).map((p, i) => <Cell key={i} fill={colorForProduct(p.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Department" subtitle="Top 10, highest first — hover a name for the full value">
          {data.byDepartment.length === 0 ? <EmptyState title="No department data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(data.byDepartment.length, 10))}>
              <BarChart data={data.byDepartment.slice(0, 10).map((p) => ({ name: p.name, value: p.monthlyCost }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#7c3aed" radius={[0, 4, 4, 0]} cursor={onOpenDepartment ? 'pointer' : undefined} onClick={(d) => onOpenDepartment && d?.name && onOpenDepartment(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Usage Status" subtitle="Active vs. Low Usage vs. No Usage — current-license cost only">
          {costByUsageStatus.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={costByUsageStatus} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>
                  <Cell fill="#059669" /><Cell fill="#d97706" /><Cell fill="#dc2626" />
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by Provider">
          {data.byProvider.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.byProvider.map((p) => ({ name: p.name, value: p.monthlyCost }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>
                  {data.byProvider.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost by VBU" subtitle="Top 10, highest first — hover a name for the full value">
          {data.byVbu.length === 0 ? <EmptyState title="No VBU data available" /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(data.byVbu.length, 10))}>
              <BarChart data={data.byVbu.slice(0, 10).map((p) => ({ name: p.name, value: p.monthlyCost }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#0891b2" radius={[0, 4, 4, 0]} cursor={onOpenVbu ? 'pointer' : undefined} onClick={(d) => onOpenVbu && d?.name && onOpenVbu(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Potential Savings by Product" subtitle="Where unused/low-usage cost is concentrated">
          {data.potentialSavingsByProduct.length === 0 ? <EmptyState title="No potential savings identified" hint="Every priced license currently shows healthy usage." /> : (
            <ResponsiveContainer width="100%" height={horizontalBarChartHeight(data.potentialSavingsByProduct.length, { min: 180 })}>
              <BarChart data={data.potentialSavingsByProduct} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#dc2626" radius={[0, 4, 4, 0]} cursor={onOpenProduct ? 'pointer' : undefined} onClick={(d) => onOpenProduct && d?.name && onOpenProduct(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Cost Trend" subtitle="Monthly">
          <EmptyState title="No historical cost trend yet" hint={data.trend.message} />
        </ChartCard>
      </div>
    </div>
  )
}
