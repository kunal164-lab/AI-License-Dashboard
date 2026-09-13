import React, { useEffect, useMemo, useState } from 'react'
import { Users as UsersIcon, Zap, MessageSquare, MessagesSquare, Layers, Monitor, ArrowLeft } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import ChartCard from '../components/ChartCard'
import KpiCard from '../components/KpiCard'
import FilterableDataTable from '../components/FilterableDataTable'
import EmptyState from '../components/EmptyState'
import StatusBadge from '../components/StatusBadge'
import BrandLogo from '../components/BrandLogo'
import ProviderUserDetail from '../components/ProviderUserDetail'
import { TruncatedAxisTick, horizontalBarChartHeight, CHART_HEIGHT_ROOMY } from '../components/charts/ChartAxisTick'
import { buildCanonicalUsers } from '../utils/userModel'
import { activityStatusFor } from '../utils/activityScore'

const PIE_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b']

function LinkCell({ onClick, children }) {
  return <button className="link-text" onClick={onClick}>{children || 'N/A'}</button>
}

function distribution(rows, key, limit = 15) {
  const map = new Map()
  for (const r of rows) {
    const v = r[key]
    if (v === null || v === undefined || v === '') continue
    map.set(v, (map.get(v) || 0) + 1)
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, limit)
}

// `usage` (from /api/kiro/data) is the FULL monthly history — one row per
// user per month, never collapsed — the source this page's own table and
// charts read from. The generic canonical pipeline (`data`/`allData`, same
// props Products.jsx receives) only ever carries the LATEST month per user
// (see kiroNormalizer.js#selectLatestPerUser) since it must show one
// current Kiro license per person, not N monthly snapshots — so it is used
// here ONLY to resolve a clicked row to that person's full cross-product
// canonical profile for the existing global UserDetail modal, never to
// drive this page's own KPIs/table.
export default function Kiro({ data, allData, microsoftDirectory, currency = 'USD', navigate }) {
  const [usage, setUsage] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filteredView, setFilteredView] = useState(null)

  useEffect(() => {
    fetch('/api/kiro/data')
      .then((r) => { if (!r.ok) throw new Error('Failed to load Kiro usage data'); return r.json() })
      .then((j) => setUsage(j.usage || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Each monthly row gets its own Usage Status via the SAME shared
  // classification (src/utils/activityScore.js) every other product uses —
  // no Kiro-specific thresholds. Client types are joined for display (e.g.
  // "KIRO_IDE + PLUGIN") — never one table row per client type, matching
  // the "no duplicate licenses for multiple client types" requirement.
  const rows = useMemo(() => usage.map((u) => ({
    ...u,
    name: null,
    usage_status: activityStatusFor({ activity_count: (u.chat_conversations || 0) + (u.total_messages || 0), chats: u.chat_conversations, messages: u.total_messages }),
    client_type_label: Array.isArray(u.client_types) && u.client_types.length ? u.client_types.join(' + ') : 'N/A'
  })), [usage])

  const rowsForKpis = filteredView ?? rows

  // Confirms the row's email is a real canonical person before opening the
  // dedicated Kiro detail — fetched server-side by email via
  // /api/users/:id/detail?provider=kiro (server/services/userDetail.js),
  // built on the same cost-resolved canonical dataset, never a second
  // identity/pricing computation on the client.
  const canonicalByEmail = useMemo(() => {
    const map = new Map()
    for (const u of buildCanonicalUsers(allData || [], microsoftDirectory)) if (u.email) map.set(u.email, u)
    return map
  }, [allData, microsoftDirectory])
  const [selectedUser, setSelectedUser] = useState(null)
  function openRow(row) {
    const canonical = canonicalByEmail.get(row.email)
    if (canonical) setSelectedUser({ email: canonical.email, name: canonical.name })
  }

  const uniqueUsers = useMemo(() => new Set(rowsForKpis.map((r) => r.email)).size, [rowsForKpis])
  const totalCredits = useMemo(() => rowsForKpis.reduce((s, r) => s + (Number(r.credits_used) || 0), 0), [rowsForKpis])
  const totalMessages = useMemo(() => rowsForKpis.reduce((s, r) => s + (Number(r.total_messages) || 0), 0), [rowsForKpis])
  const totalChats = useMemo(() => rowsForKpis.reduce((s, r) => s + (Number(r.chat_conversations) || 0), 0), [rowsForKpis])
  const planDist = useMemo(() => distribution(rowsForKpis, 'plan'), [rowsForKpis])
  const clientTypeCounts = useMemo(() => {
    const map = new Map()
    for (const r of rowsForKpis) for (const ct of (r.client_types || [])) map.set(ct, (map.get(ct) || 0) + 1)
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [rowsForKpis])
  const usageStatusDist = useMemo(() => distribution(rowsForKpis, 'usage_status'), [rowsForKpis])

  const columns = useMemo(() => ([
    { key: 'email', name: 'Email', type: 'text', essential: true, render: (r) => <LinkCell onClick={() => openRow(r)}>{r.email}</LinkCell> },
    { key: 'month', name: 'Month', type: 'category', essential: true },
    { key: 'plan', name: 'Plan', type: 'category', essential: true },
    { key: 'credits_used', name: 'Credits Used', type: 'number', essential: true },
    { key: 'chat_conversations', name: 'Chat Conversations', type: 'number' },
    { key: 'total_messages', name: 'Total Messages', type: 'number' },
    { key: 'client_type_label', name: 'Client Type', type: 'category', essential: true },
    { key: 'usage_status', name: 'Usage Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.usage_status} /> },
    { key: 'last_activity', name: 'Last Activity', type: 'date', essential: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [canonicalByEmail])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          {navigate && <button className="button secondary" onClick={() => navigate('/products')} style={{ marginBottom: 8 }}><ArrowLeft size={16} /> Back to Products</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandLogo product="Kiro" size="md" />
            <h3 style={{ margin: 0 }}>Kiro</h3>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Monthly usage imported from Kiro usage CSVs, aggregated per user per month. Click a row to see the full person profile.
          </div>
        </div>
      </div>

      {error && <div style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="muted">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No Kiro usage has been imported yet"
          hint="Import a Kiro usage CSV from Data Sources → Kiro to see usage here."
        />
      ) : (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <KpiCard color="blue" icon={<UsersIcon size={16} />} title="Kiro Users" value={uniqueUsers} />
            <KpiCard color="purple" icon={<Zap size={16} />} title="Total Credits Used" value={totalCredits.toLocaleString()} />
            <KpiCard color="teal" icon={<MessagesSquare size={16} />} title="Total Messages" value={totalMessages.toLocaleString()} />
            <KpiCard color="green" icon={<MessageSquare size={16} />} title="Chat Conversations" value={totalChats.toLocaleString()} />
            <KpiCard color="orange" icon={<Layers size={16} />} title="Plans / Tiers" value={planDist.length} />
            <KpiCard color="red" icon={<Monitor size={16} />} title="Client Types Used" value={clientTypeCounts.length} />
          </div>

          <div className="charts">
            {planDist.length > 0 && (
              <ChartCard title="Users by Plan / Tier">
                <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
                  <PieChart>
                    <Pie data={planDist} dataKey="value" nameKey="name" outerRadius={80} label>
                      {planDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {usageStatusDist.length > 0 && (
              <ChartCard title="Monthly Records by Usage Status">
                <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
                  <PieChart>
                    <Pie data={usageStatusDist} dataKey="value" nameKey="name" outerRadius={80} label>
                      {usageStatusDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {clientTypeCounts.length > 0 && (
              <ChartCard title="Usage by Client Type" subtitle="Monthly records mentioning each client type">
                <ResponsiveContainer width="100%" height={horizontalBarChartHeight(clientTypeCounts.length)}>
                  <BarChart data={clientTypeCounts} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0b5fff" name="Records" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          <div className="card">
            <div className="card-title">Monthly Usage ({rows.length})</div>
            <FilterableDataTable
              columns={columns} data={rows} storageKey="kiro-usage" itemLabel="monthly records"
              quickKeys={['month', 'plan', 'usage_status', 'client_type_label']}
              searchFields={['email']}
              emptyTitle="No monthly records match the selected filters" emptyHint="Try removing a filter to broaden the results."
              onFilteredChange={setFilteredView}
            />
          </div>
        </>
      )}

      {selectedUser && (
        <ProviderUserDetail
          userId={selectedUser.email}
          userName={selectedUser.name}
          provider="kiro"
          currency={currency}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  )
}
