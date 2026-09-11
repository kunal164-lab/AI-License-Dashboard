import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Users as UsersIcon, BadgeCheck, Activity, Gauge, MessagesSquare, Coins, DollarSign, Layers, ArrowLeft, X } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import ChartCard from '../components/ChartCard'
import KpiCard from '../components/KpiCard'
import FilterableDataTable from '../components/FilterableDataTable'
import EmptyState from '../components/EmptyState'
import StatusBadge from '../components/StatusBadge'
import BrandLogo from '../components/BrandLogo'
import ProviderUserDetail from '../components/ProviderUserDetail'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../components/charts/ChartAxisTick'
import { buildCanonicalUsers } from '../utils/userModel'
import { mergeSeatGroupRecords } from '../utils/productModel'
import { providerForProduct, capabilityForProduct } from '../utils/providerRegistry'
import { formatMoney } from '../utils/currency'
import { formatRelativeTime } from '../utils/formatRelativeTime'

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

// Claude is a dynamic PRODUCT FAMILY (src/utils/providerRegistry.js's
// prefix-based Claude grouping) — 'Claude Chat'/'Claude Code'/'Claude
// Cowork'/etc all merge into ONE 'Claude' seat per person
// (src/utils/productModel.js#mergeSeatGroupRecords), matching "one Claude
// user, one Claude seat" (Part 6/9 of the spec this implements). This page
// reads the RAW pre-merge records (same `data`/`allData` props every other
// page gets from App.jsx) for the Product/Model breakdowns — which need
// the individual 'Claude Chat'/'Claude Cowork'/etc names, not the merged
// generic 'Claude' — and the MERGED canonical view for the Users table and
// KPIs, exactly like Products.jsx does.
export default function Claude({ data, allData, microsoftDirectory, currency = 'USD', navigate }) {
  const [source, setSource] = useState(null)
  const fmtCurrency = (v) => formatMoney(v, currency, { maximumFractionDigits: 2 })

  useEffect(() => {
    fetch('/api/claude/source').then((r) => r.json()).then(setSource).catch(() => {})
  }, [])

  const isClaudeProduct = (p) => typeof p === 'string' && (p === 'Claude' || p.startsWith('Claude '))

  // Raw, pre-merge Claude-family records — the real product/model names
  // straight from the CSV (src/utils/claudeNormalizer.js), never hardcoded.
  const claudeRawRecords = useMemo(() => (allData || []).filter((r) => isClaudeProduct(r.product)), [allData])

  // Canonical users, built the SAME way Products.jsx does (seat-group merge
  // first, then canonical-user merge) so Chat/Code/Cowork/etc collapse into
  // one Claude seat per person, with Microsoft 365 as the sole source for
  // org-identity fields (buildCanonicalUsers already enforces this).
  const canonicalUsers = useMemo(() => {
    const merged = mergeSeatGroupRecords(allData || [])
    return buildCanonicalUsers(merged, microsoftDirectory)
  }, [allData, microsoftDirectory])

  const claudeUserRows = useMemo(() => {
    return canonicalUsers
      .filter((u) => Array.isArray(u.product) && u.product.some(isClaudeProduct))
      .map((u) => {
        const p = u.products.find((pp) => isClaudeProduct(pp.product))
        const models = Array.isArray(p?.models) ? [...new Set(p.models.map((m) => m.model))] : []
        return {
          _id: u._id,
          email: u.email,
          name: u.name,
          department: u.department,
          vbu: u.vbu,
          manager: u.manager,
          job_title: u.job_title,
          plan: p?.plan || null,
          license_status: p?.license_status || null,
          usage_status: u.usage_status,
          total_requests: p?.total_requests ?? null,
          total_prompt_tokens: p?.total_prompt_tokens ?? null,
          total_completion_tokens: p?.total_completion_tokens ?? null,
          display_cost: p?.display_cost ?? null,
          display_currency: p?.display_currency || currency,
          cost_label: p?.cost_label || null,
          products: Array.isArray(p?.capabilities) ? p.capabilities : [],
          models,
          last_sync: p?._snapshot_imported_at || null,
          _canonical: u
        }
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalUsers, currency])

  const [filteredView, setFilteredView] = useState(null)
  const rowsForKpis = filteredView ?? claudeUserRows

  // Confirms the row's email is a real canonical person before opening the
  // dedicated Claude detail (Part 5 of the spec this implements) — the
  // detail itself is fetched server-side by email via
  // /api/users/:id/detail?provider=claude (server/services/userDetail.js),
  // built on the SAME cost-resolved canonical dataset, never a second
  // identity/pricing computation on the client.
  const canonicalByEmail = useMemo(() => {
    const map = new Map()
    for (const u of canonicalUsers) if (u.email) map.set(u.email, u)
    return map
  }, [canonicalUsers])
  const [selectedUser, setSelectedUser] = useState(null)
  function openRow(row) {
    const canonical = canonicalByEmail.get(row.email)
    if (canonical) setSelectedUser({ email: canonical.email, name: canonical.name })
  }

  const totalUsers = rowsForKpis.length
  const activeUsers = rowsForKpis.filter((r) => r.usage_status === 'Active' || r.usage_status === 'Heavily Active').length
  const noUsage = rowsForKpis.filter((r) => r.usage_status === 'No Usage').length
  const lowUsage = rowsForKpis.filter((r) => r.usage_status === 'Low Activity').length
  const totalRequests = rowsForKpis.reduce((s, r) => s + (Number(r.total_requests) || 0), 0)
  const totalPromptTokens = rowsForKpis.reduce((s, r) => s + (Number(r.total_prompt_tokens) || 0), 0)
  const totalCompletionTokens = rowsForKpis.reduce((s, r) => s + (Number(r.total_completion_tokens) || 0), 0)
  const totalSpendValues = rowsForKpis.map((r) => r.display_cost).filter((v) => v !== null && v !== undefined)
  const totalSpend = totalSpendValues.length ? totalSpendValues.reduce((s, v) => s + Number(v), 0) : null
  const planDist = useMemo(() => distribution(rowsForKpis.map((r) => ({ plan: r.plan || 'N/A' })), 'plan'), [rowsForKpis])
  const usageStatusDist = useMemo(() => distribution(rowsForKpis, 'usage_status'), [rowsForKpis])

  // Product/model breakdowns — from the RAW pre-merge records, so each
  // real product/model name from the CSV stays distinct (Part 9/10),
  // rather than collapsed into the merged 'Claude' seat name.
  const productBreakdown = useMemo(() => {
    const map = new Map()
    for (const r of claudeRawRecords) {
      const key = r.product
      if (!map.has(key)) map.set(key, { product: key, users: new Set(), requests: 0, promptTokens: 0, completionTokens: 0, spend: 0 })
      const g = map.get(key)
      if (r.email) g.users.add(r.email)
      g.requests += Number(r.total_requests) || 0
      g.promptTokens += Number(r.total_prompt_tokens) || 0
      g.completionTokens += Number(r.total_completion_tokens) || 0
      g.spend += Number(r.display_cost) || 0
    }
    return Array.from(map.values()).map((g) => ({ ...g, users: g.users.size })).sort((a, b) => b.requests - a.requests)
  }, [claudeRawRecords])

  const modelBreakdown = useMemo(() => {
    const map = new Map()
    for (const r of claudeRawRecords) {
      for (const m of (r.models || [])) {
        const key = m.model
        if (!map.has(key)) map.set(key, { model: key, users: new Set(), requests: 0, promptTokens: 0, completionTokens: 0, spend: 0 })
        const g = map.get(key)
        if (r.email) g.users.add(r.email)
        g.requests += Number(m.total_requests) || 0
        g.promptTokens += Number(m.total_prompt_tokens) || 0
        g.completionTokens += Number(m.total_completion_tokens) || 0
        g.spend += Number(m.total_net_spend_usd) || 0
      }
    }
    return Array.from(map.values()).map((g) => ({ ...g, users: g.users.size })).sort((a, b) => b.requests - a.requests)
  }, [claudeRawRecords])

  const [expandedProduct, setExpandedProduct] = useState(null)
  // Product/Capability -> users using that capability (Part 6/13 drilldown)
  // — drives the Users table's own `products` column filter without
  // lifting its filter state out of FilterableDataTable's local
  // useTableFilters (same externalFilter/externalFilterToken mechanism
  // already used elsewhere in this app, e.g. Microsoft365.jsx's KPI drills).
  const [productsFilter, setProductsFilter] = useState(null)
  const [productsFilterToken, setProductsFilterToken] = useState(0)
  const usersTableRef = useRef(null)
  function viewUsersForProduct(rawProduct) {
    const capability = capabilityForProduct(rawProduct) || rawProduct
    setProductsFilter({ key: 'products', value: { type: 'category', values: [capability] } })
    setProductsFilterToken((t) => t + 1)
    usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const columns = useMemo(() => ([
    { key: 'name', name: 'User', type: 'text', essential: true, render: (r) => <LinkCell onClick={() => openRow(r)}>{r.name}</LinkCell> },
    { key: 'email', name: 'Email', type: 'text', essential: true },
    { key: 'department', name: 'Department', type: 'category', essential: true },
    { key: 'vbu', name: 'VBU', type: 'category' },
    { key: 'manager', name: 'Manager', type: 'category' },
    { key: 'job_title', name: 'Job Title', type: 'category' },
    { key: 'plan', name: 'Claude Plan', type: 'category', essential: true },
    { key: 'license_status', name: 'License Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.license_status || 'Unknown'} /> },
    { key: 'usage_status', name: 'Usage Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.usage_status} /> },
    { key: 'total_requests', name: 'Requests', type: 'number', essential: true },
    { key: 'total_prompt_tokens', name: 'Prompt Tokens', type: 'number' },
    { key: 'total_completion_tokens', name: 'Completion Tokens', type: 'number' },
    { key: 'display_cost', name: 'Spend', type: 'number', essential: true, render: (r) => (r.display_cost === null ? 'N/A' : fmtCurrency(r.display_cost)) },
    { key: 'products', name: 'Products', type: 'category', render: (r) => (r.products.length ? r.products.join(', ') : 'N/A') },
    { key: 'models', name: 'Models', type: 'category', render: (r) => (r.models.length ? r.models.join(', ') : 'N/A') },
    { key: 'last_sync', name: 'Last Sync', type: 'date', render: (r) => (r.last_sync ? formatRelativeTime(r.last_sync) : 'N/A') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [canonicalByEmail, currency])

  const hasData = claudeUserRows.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          {navigate && <button className="button secondary" onClick={() => navigate('/products')} style={{ marginBottom: 8 }}><ArrowLeft size={16} /> Back to Products</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandLogo product="Claude" size="md" />
            <h3 style={{ margin: 0 }}>Claude</h3>
            <span className="badge" style={{ background: 'var(--accent-soft, #eef2ff)', color: 'var(--accent, #4338ca)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>MTD</span>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Claude Usage — Month-to-Date. Always the latest successful MTD snapshot, never summed with a previous one.
            {source?.lastSuccessfulSync && <> Last successful sync: {formatRelativeTime(source.lastSuccessfulSync)}.</>}
          </div>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title="No Claude usage has been imported yet"
          hint="Connect the automatic OneDrive/SharePoint source or import a Claude MTD CSV from Data Sources → Claude to see usage here."
        />
      ) : (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <KpiCard color="blue" icon={<UsersIcon size={16} />} title="Total Claude Users" value={totalUsers} onClick={() => usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            <KpiCard color="green" icon={<BadgeCheck size={16} />} title="Active Users" value={activeUsers} onClick={() => { setProductsFilter({ key: 'usage_status', value: { type: 'category', values: ['Active', 'Heavily Active'] } }); setProductsFilterToken((t) => t + 1); usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
            <KpiCard color="red" icon={<Activity size={16} />} title="No Usage" value={noUsage} onClick={() => { setProductsFilter({ key: 'usage_status', value: { type: 'category', values: ['No Usage'] } }); setProductsFilterToken((t) => t + 1); usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
            <KpiCard color="orange" icon={<Gauge size={16} />} title="Low Usage" value={lowUsage} onClick={() => { setProductsFilter({ key: 'usage_status', value: { type: 'category', values: ['Low Activity'] } }); setProductsFilterToken((t) => t + 1); usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
            <KpiCard color="purple" icon={<MessagesSquare size={16} />} title="Total Requests" value={totalRequests.toLocaleString()} />
            <KpiCard color="teal" icon={<Coins size={16} />} title="Prompt Tokens" value={totalPromptTokens.toLocaleString()} />
            <KpiCard color="teal" icon={<Coins size={16} />} title="Completion Tokens" value={totalCompletionTokens.toLocaleString()} />
            <KpiCard color="green" icon={<DollarSign size={16} />} title="Total Spend" value={totalSpend === null ? 'N/A' : fmtCurrency(totalSpend)} />
            <KpiCard color="orange" icon={<Layers size={16} />} title="Plans / Seat Tiers" value={planDist.length} />
          </div>

          <div className="charts">
            {planDist.length > 0 && (
              <ChartCard title="Claude Plans" subtitle="From the CSV's seat_tier column — never inferred from cost or usage">
                <ResponsiveContainer width="100%" height={220}>
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
              <ChartCard title="Users by Usage Status">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={usageStatusDist} dataKey="value" nameKey="name" outerRadius={80} label>
                      {usageStatusDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {productBreakdown.length > 0 && (
              <ChartCard title="Requests by Product" subtitle="Highest first — hover a name for the full value">
                <ResponsiveContainer width="100%" height={horizontalBarChartHeight(productBreakdown.length)}>
                  <BarChart data={productBreakdown.map((p) => ({ name: p.product, value: p.requests }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={<TruncatedAxisTick />} interval={0} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0b5fff" name="Requests" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">Products ({productBreakdown.length})</div>
            <div className="muted small" style={{ marginTop: 2, marginBottom: 8 }}>Product names come directly from the CSV — click one for its model breakdown.</div>
            <div className="product-grid">
              {productBreakdown.map((p) => (
                <div
                  key={p.product}
                  className="product-card"
                  style={{ cursor: 'pointer', borderColor: expandedProduct === p.product ? '#0b5fff' : undefined }}
                  onClick={() => setExpandedProduct(expandedProduct === p.product ? null : p.product)}
                >
                  <div className="product-card-header">
                    <BrandLogo product={p.product} size="sm" />
                    <span className="product-card-name">{p.product}</span>
                  </div>
                  <div className="product-card-metrics">
                    <div><div className="product-metric-label">Users</div><div className="product-metric-value">{p.users}</div></div>
                    <div><div className="product-metric-label">Requests</div><div className="product-metric-value">{p.requests.toLocaleString()}</div></div>
                    <div><div className="product-metric-label">Spend</div><div className="product-metric-value">{p.spend ? fmtCurrency(p.spend) : 'N/A'}</div></div>
                  </div>
                </div>
              ))}
            </div>
            {expandedProduct && (() => {
              const p = productBreakdown.find((x) => x.product === expandedProduct)
              const models = modelBreakdown.filter((m) => claudeRawRecords.some((r) => r.product === expandedProduct && (r.models || []).some((mm) => mm.model === m.model)))
              if (!p) return null
              return (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border, #eee)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0 }}>{p.product} — Detail</h4>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="button secondary" onClick={() => viewUsersForProduct(p.product)}>View Users</button>
                      <button className="icon-button" onClick={() => setExpandedProduct(null)} aria-label="Close"><X size={16} /></button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, marginTop: 8 }}>
                    <div><div className="muted small">Users</div><strong>{p.users}</strong></div>
                    <div><div className="muted small">Requests</div><strong>{p.requests.toLocaleString()}</strong></div>
                    <div><div className="muted small">Prompt Tokens</div><strong>{p.promptTokens.toLocaleString()}</strong></div>
                    <div><div className="muted small">Completion Tokens</div><strong>{p.completionTokens.toLocaleString()}</strong></div>
                    <div><div className="muted small">Spend</div><strong>{p.spend ? fmtCurrency(p.spend) : 'N/A'}</strong></div>
                  </div>
                  {models.length > 0 && (
                    <div className="table" style={{ marginTop: 12, border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                      <table>
                        <thead><tr><th>Model</th><th>Users</th><th>Requests</th><th>Prompt Tokens</th><th>Completion Tokens</th><th>Spend</th></tr></thead>
                        <tbody>
                          {models.map((m) => (
                            <tr key={m.model}>
                              <td>{m.model}</td><td>{m.users}</td><td>{m.requests.toLocaleString()}</td>
                              <td>{m.promptTokens.toLocaleString()}</td><td>{m.completionTokens.toLocaleString()}</td>
                              <td>{m.spend ? fmtCurrency(m.spend) : 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          <div className="card" ref={usersTableRef}>
            <div className="card-title">Claude Users ({claudeUserRows.length})</div>
            <FilterableDataTable
              columns={columns} data={claudeUserRows} storageKey="claude-users" itemLabel="users"
              quickKeys={['plan', 'department', 'vbu', 'products', 'models', 'usage_status']}
              searchFields={['name', 'email']}
              externalFilter={productsFilter} externalFilterToken={productsFilterToken}
              emptyTitle="No Claude users match the selected filters" emptyHint="Try removing a filter to broaden the results."
              onFilteredChange={setFilteredView}
            />
          </div>
        </>
      )}

      {selectedUser && (
        <ProviderUserDetail
          userId={selectedUser.email}
          userName={selectedUser.name}
          provider="claude"
          currency={currency}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  )
}
