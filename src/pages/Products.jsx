import React, { useMemo, useRef, useState, useEffect } from 'react'
import ChartCard from '../components/ChartCard'
import { CHART_HEIGHT_COMPACT, CHART_HEIGHT_ROOMY } from '../components/charts/ChartAxisTick'
import EmptyState from '../components/EmptyState'
import ActiveFilterBar from '../components/ActiveFilterBar'
import UserDetail from '../components/UserDetail'
import ProviderUserDetail from '../components/ProviderUserDetail'
import StatusBadge from '../components/StatusBadge'
import BrandLogo from '../components/BrandLogo'
import { colorForProduct } from '../utils/productColors'
import { providerForProduct, capabilitiesForProduct } from '../utils/providerRegistry'
import { buildCanonicalUsers } from '../utils/userModel'
import { formatMoney } from '../utils/currency'
import { isLicenseActive } from '../utils/licenseStatus'
import { X, Package, ArrowRight, Filter as FilterIcon, LayoutGrid, ChevronDown } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'

// Some products (Microsoft 365 today; e.g. Kiro could get one later) have a
// dedicated, deeper page beyond the generic product card below. Listed here
// so adding a new one is a one-line change, not new page-routing logic.
// Maps a product's canonical name to the provider key server/services/
// userDetail.js's /api/users/:id/detail?provider=X understands — drives
// "click a user in this product's detail table -> dedicated provider
// detail" (Part 13). A product not listed here (a future provider not yet
// wired into that service) falls back to the existing generic UserDetail
// rather than a broken request.
const PROVIDER_DETAIL_KEY = {
  'Microsoft Copilot': 'copilot',
  'Kiro': 'kiro',
  'Claude': 'claude',
  'Freshservice': 'freshservice',
  'GitHub Copilot': 'github'
}

const DEDICATED_PRODUCT_PAGES = [
  { key: 'microsoft-365', label: 'Microsoft 365', path: '/microsoft-365' },
  { key: 'freshservice', label: 'Freshservice', path: '/freshservice' },
  { key: 'kiro', label: 'Kiro', path: '/kiro' },
  { key: 'claude', label: 'Claude', path: '/claude' }
]

function DedicatedProductMenu({ pages, navigate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!pages.length) return null

  return (
    <div className="dedicated-pages" ref={ref}>
      <button className="dedicated-pages-trigger" onClick={() => setOpen((o) => !o)}>
        <LayoutGrid size={16} />
        Dedicated Product Pages
        <ChevronDown size={14} className={`dedicated-pages-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="dedicated-pages-menu">
          {pages.map((p) => (
            <button key={p.key} className="dedicated-pages-menu-item" onClick={() => { setOpen(false); navigate(p.path) }}>
              <BrandLogo product={p.label} size="xs" bordered={false} />
              {p.label}
              <ArrowRight size={14} className="dedicated-pages-menu-arrow" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Products({ data, allData, globalFilters, setFilter, clearFilter, clearAllFilters, navigate, currency = 'USD', microsoftDirectory }) {
  const [expanded, setExpanded] = useState(null)
  const [expandedProvider, setExpandedProvider] = useState(null)
  const money = (v) => formatMoney(v, currency)

  const products = useMemo(() => {
    const names = Array.from(new Set((data || []).map((d) => d.product))).filter(Boolean)
    return names.map((name) => {
      const list = data.filter((d) => d.product === name)
      // LICENSE STATUS vs USAGE STATUS (src/utils/licenseStatus.js):
      // "Assigned"/"Not Assigned" reflect whether the license itself is
      // currently active — never derived from activity. "In Use"/
      // "Unused"/"Low Usage" are usage-based and only ever computed among
      // the assigned licenses, so an assigned-but-unused seat is never
      // miscounted as "not assigned."
      const assignedList = list.filter(isLicenseActive)
      const used = assignedList.filter((l) => l.usage_status === 'Active' || l.usage_status === 'Heavily Active')
      const unused = assignedList.filter((l) => l.usage_status === 'No Usage')
      const lowUsage = assignedList.filter((l) => l.usage_status === 'Low Activity')
      // display_cost is the centralized cost engine's one authoritative
      // figure per record (server/services/costEngine.js) — already
      // resolved through the source-provided/actual/configured/reference
      // priority and converted to the app's display currency, so nothing
      // here re-derives cost from raw fields.
      const spend = list.reduce((s, r) => s + (parseFloat(r.display_cost) || 0), 0)
      const capabilities = capabilitiesForProduct(name)
      // A product with no usage dataset at all (Freshservice today) must
      // never show a computed 0% utilization or a savings figure derived
      // from "usage" that was never measured — see src/utils/
      // activityScore.js#activityStatusFor, which already classifies every
      // one of its records 'Not Tracked' rather than 'No Usage'/'Low
      // Activity', so `unused`/`lowUsage` above are correctly always empty
      // for it; `utilization` is set to null here (rendered "N/A", never
      // "0%") for the same reason.
      const potentialSavings = capabilities.optimizationEligible
        ? [...unused, ...lowUsage].reduce((s, r) => s + (parseFloat(r.display_cost) || 0), 0)
        : 0
      const utilization = capabilities.usageTrackingSupported
        ? (assignedList.length ? Math.round((used.length / assignedList.length) * 100) : 0)
        : null
      const plans = {}
      list.forEach((r) => { const p = r.plan || 'Unknown'; plans[p] = (plans[p] || 0) + 1 })
      return {
        name, provider: providerForProduct(name), capabilities,
        users: new Set(list.map((l) => l.email || l._id)).size,
        licenses: list.length, assigned: assignedList.length, notAssigned: list.length - assignedList.length,
        active: used.length, unused: unused.length, lowUsage: lowUsage.length,
        utilization, spend, potentialSavings, plans, list
      }
    })
  }, [data])

  const providers = useMemo(() => {
    const names = Array.from(new Set(products.map((p) => p.provider)))
    return names.map((name) => {
      const productList = products.filter((p) => p.provider === name)
      const providerRecords = (data || []).filter((r) => providerForProduct(r.product) === name)
      const uniqueUsers = buildCanonicalUsers(providerRecords, microsoftDirectory).length
      const totalLicenses = productList.reduce((s, p) => s + p.licenses, 0)
      const assignedLicenses = productList.reduce((s, p) => s + p.assigned, 0)
      const activeLicenses = productList.reduce((s, p) => s + p.active, 0)
      const spend = productList.reduce((s, p) => s + (p.spend || 0), 0)
      const potentialSavings = productList.reduce((s, p) => s + (p.potentialSavings || 0), 0)
      // Same "never show a fake 0% for a provider with no usage-tracked
      // products at all" rule as the per-product utilization above —
      // relevant today for Freshworks/Freshservice, a 1:1 provider/product.
      const anyUsageTracked = productList.some((p) => p.capabilities.usageTrackingSupported)
      const utilization = !anyUsageTracked ? null : (assignedLicenses ? Math.round((activeLicenses / assignedLicenses) * 100) : 0)
      return { name, products: productList, uniqueUsers, totalLicenses, assignedLicenses, activeLicenses, utilization, spend, potentialSavings }
    })
  }, [products, data, microsoftDirectory])

  const utilizationData = products.filter((p) => p.utilization !== null).map((p) => ({ name: p.name, value: p.utilization }))
  const spendData = products.filter((p) => p.spend > 0).map((p) => ({ name: p.name, value: Math.round(p.spend) }))

  // Full canonical-user lookup (by email, falling back to _id) so clicking a
  // person anywhere on this page opens their COMPLETE cross-product
  // profile — not just the one product that got them onto this list.
  const canonicalByKey = useMemo(() => {
    const map = new Map()
    for (const u of buildCanonicalUsers(data || [], microsoftDirectory)) map.set(u.email || u._id, u)
    return map
  }, [data, microsoftDirectory])
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedProviderUser, setSelectedProviderUser] = useState(null)
  function openUser(record) {
    const key = (record.email && String(record.email).trim().toLowerCase()) || record._id
    const canonical = canonicalByKey.get(key)
    if (canonical) setSelectedUser(canonical)
  }
  // From a specific product's own expanded detail table (Part 13) — opens
  // the dedicated provider detail (license/usage/why-this-status/
  // potential savings, server/services/userDetail.js) when this product is
  // wired into that service; otherwise falls back to the generic profile.
  function openUserForProduct(record, productName) {
    const provider = PROVIDER_DETAIL_KEY[productName]
    if (provider && record.email) setSelectedProviderUser({ email: record.email, name: record.name, provider })
    else openUser(record)
  }

  if (!allData || !allData.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <Package size={40} style={{ color: '#c3cbd9', marginBottom: 12 }} />
        <h3>No products to analyze yet</h3>
        <p className="muted">Connect an AI provider or import a usage report to see product-level analytics.</p>
        <button className="button primary" onClick={() => navigate && navigate('/data-sources')}>Go to Data Sources <ArrowRight size={16} /></button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Products</h3>
        {navigate && <DedicatedProductMenu pages={DEDICATED_PRODUCT_PAGES} navigate={navigate} />}
      </div>
      <ActiveFilterBar
        filters={globalFilters}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        shownCount={data.length}
        totalCount={allData.length}
        itemLabel="records"
      />

      {products.length === 0 ? (
        <EmptyState title="No records match the selected filters" hint="Try removing a filter to see product-level analytics." />
      ) : (
      <>
      {providers.length > 1 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Providers</div>
          <div className="product-grid">
            {providers.map((p) => (
              <div
                key={p.name}
                className="product-card"
                style={{ cursor: 'pointer', borderColor: expandedProvider === p.name ? colorForProduct(p.name) : undefined }}
                onClick={() => setExpandedProvider(expandedProvider === p.name ? null : p.name)}
                title="Click to see provider-level KPIs"
              >
                <div className="product-card-header">
                  <BrandLogo provider={p.name} size="sm" />
                  <span className="product-card-name">{p.name}</span>
                </div>
                <div className="product-card-metrics">
                  <div><div className="product-metric-label">Products</div><div className="product-metric-value">{p.products.length}</div></div>
                  <div><div className="product-metric-label">Users</div><div className="product-metric-value">{p.uniqueUsers}</div></div>
                  <div><div className="product-metric-label">Licenses</div><div className="product-metric-value">{p.totalLicenses}</div></div>
                  <div><div className="product-metric-label">Utilization</div><div className="product-metric-value">{p.utilization === null ? 'N/A' : `${p.utilization}%`}</div></div>
                  <div><div className="product-metric-label">Spend</div><div className="product-metric-value">{p.spend ? money(p.spend) : 'N/A'}</div></div>
                </div>
              </div>
            ))}
          </div>
          {expandedProvider && (() => {
            const p = providers.find((x) => x.name === expandedProvider)
            if (!p) return null
            return (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border, #eee)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>{p.name} — Provider Overview</h4>
                  <button className="icon-button" onClick={() => setExpandedProvider(null)} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Unique users are counted once across every product below — not summed per product.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {p.products.map((prod) => (
                    <button key={prod.name} className="button secondary" onClick={() => { setExpanded(prod.name); setFilter('product', { type: 'category', values: [prod.name] }) }}>
                      {prod.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
      <div className="product-grid">
        {products.map((p) => (
          <div
            key={p.name}
            className="product-card"
            style={{ cursor: 'pointer', borderColor: expanded === p.name ? colorForProduct(p.name) : undefined }}
            onClick={() => { setExpanded(expanded === p.name ? null : p.name); setFilter('product', { type: 'category', values: [p.name] }) }}
            title="Click to filter the dashboard to this product"
          >
            <div className="product-card-header">
              <BrandLogo product={p.name} provider={p.provider} size="sm" />
              <div style={{ minWidth: 0 }}>
                <span className="product-card-name">{p.name}</span>
                <div className="muted" style={{ fontSize: 11 }}>{p.provider}</div>
              </div>
              <FilterIcon size={12} className="kpi-filter-hint" />
            </div>
            <div className="product-card-metrics">
              <div><div className="product-metric-label">Users</div><div className="product-metric-value">{p.users}</div></div>
              <div><div className="product-metric-label">Licenses</div><div className="product-metric-value">{p.licenses}</div></div>
              <div><div className="product-metric-label">Utilization</div><div className="product-metric-value">{p.utilization === null ? 'N/A' : `${p.utilization}%`}</div></div>
              <div><div className="product-metric-label">Spend</div><div className="product-metric-value">{p.spend ? money(p.spend) : 'N/A'}</div></div>
              <div><div className="product-metric-label">Potential Savings</div><div className="product-metric-value">{p.capabilities.optimizationEligible ? (p.potentialSavings ? money(p.potentialSavings) : 'N/A') : 'Not Eligible'}</div></div>
            </div>
          </div>
        ))}
      </div>

      {expanded && (() => {
        const p = products.find((x) => x.name === expanded)
        if (!p) return null
        // Dynamic product architecture (Part 8): only show SKU/service-plan/
        // cost-type columns for products whose records actually carry that
        // data (Microsoft Copilot today) — never assumed for every product.
        const hasSku = p.list.some((u) => u.sku_part_number)
        const hasServicePlans = p.list.some((u) => Array.isArray(u.service_plans) && u.service_plans.length)
        // Products merged from multiple capability sources into one license
        // (e.g. Claude Chat + Claude Code -> one Claude seat — see
        // src/utils/productModel.js) carry a `capabilities` array; shown
        // here so the one-license/one-product model doesn't hide that the
        // seat's usage still comes from distinct capability reports.
        const hasCapabilities = p.list.some((u) => Array.isArray(u.capabilities) && u.capabilities.length > 1)
        const costTypeSample = p.list.find((u) => u.cost_type)?.cost_type
        const costLabelSample = p.list.find((u) => u.cost_label)?.cost_label
        return (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BrandLogo product={p.name} provider={p.provider} size="md" />
                <div>
                  <h4 style={{ margin: 0 }}>{p.name} — Detail</h4>
                  <div className="muted small" style={{ marginTop: 2 }}>Provider: {p.provider}</div>
                </div>
              </div>
              <button className="icon-button" onClick={() => setExpanded(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="product-card-metrics" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <div><div className="product-metric-label">Total Licenses</div><div className="product-metric-value">{p.licenses}</div></div>
              <div><div className="product-metric-label">Assigned (License Active)</div><div className="product-metric-value">{p.assigned}</div></div>
              {p.notAssigned > 0 && <div><div className="product-metric-label">Not Assigned</div><div className="product-metric-value">{p.notAssigned}</div></div>}
              {p.capabilities.usageTrackingSupported ? (
                <>
                  <div><div className="product-metric-label">In Use</div><div className="product-metric-value">{p.active}</div></div>
                  <div><div className="product-metric-label">Unused (Active, No Usage)</div><div className="product-metric-value">{p.unused}</div></div>
                  <div><div className="product-metric-label">Low Usage</div><div className="product-metric-value">{p.lowUsage}</div></div>
                  <div><div className="product-metric-label">Utilization</div><div className="product-metric-value">{p.assigned ? p.utilization + '%' : 'N/A'}</div></div>
                </>
              ) : (
                <>
                  <div><div className="product-metric-label">Usage Tracking</div><div className="product-metric-value">No</div></div>
                  <div><div className="product-metric-label">Optimization</div><div className="product-metric-value">Not Eligible</div></div>
                </>
              )}
              <div><div className="product-metric-label">Total Users</div><div className="product-metric-value">{p.users}</div></div>
              <div><div className="product-metric-label">Cost Tracking</div><div className="product-metric-value">{p.capabilities.costTrackingSupported ? 'Yes' : 'No'}</div></div>
              <div><div className="product-metric-label">Cost</div><div className="product-metric-value">{p.spend ? money(p.spend) : 'N/A'}</div></div>
              {costTypeSample && (
                <div><div className="product-metric-label">Cost Type</div><div className="product-metric-value" style={{ fontSize: 13 }}>{costLabelSample || costTypeSample}</div></div>
              )}
              <div><div className="product-metric-label">Potential Savings</div><div className="product-metric-value">{p.potentialSavings ? money(p.potentialSavings) : 'N/A'}</div></div>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              "Assigned" reflects license status (currently active/assigned) — not usage. "In Use"/"Unused"/"Low Usage" reflect activity among assigned licenses only.
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ marginBottom: 6 }}>Users ({p.list.length})</div>
              {p.list.length === 0 ? <EmptyState /> : (
                <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>User</th><th>Email</th><th>Department</th><th>VBU</th><th>License / Plan</th>
                        {hasSku && <th>SKU</th>}
                        {hasServicePlans && <th>Service Plans</th>}
                        {hasCapabilities && <th>Capabilities</th>}
                        <th>License Status</th><th>Usage Status</th><th>Last Active</th><th>Usage</th><th>Cost</th><th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.list.map((u) => {
                        const servicePlanNames = Array.isArray(u.service_plans) ? u.service_plans.map((sp) => sp.servicePlanName).filter(Boolean) : []
                        return (
                          <tr key={u._id} className="clickable-row" onClick={() => openUserForProduct(u, p.name)}>
                            <td><span className="link-text">{u.name || 'N/A'}</span></td>
                            <td>{u.email || 'N/A'}</td>
                            <td>{u.department || 'N/A'}</td>
                            <td>{u.vbu || 'N/A'}</td>
                            <td>
                              {Array.isArray(u.plan_conflict) && u.plan_conflict.length
                                ? <span style={{ color: 'var(--bad)' }} title={`Conflicting plan values across capability sources: ${u.plan_conflict.join(' vs ')}`}>Plan Conflict</span>
                                : (u.plan || 'N/A')}
                            </td>
                            {hasSku && <td>{u.sku_part_number || 'N/A'}</td>}
                            {hasServicePlans && (
                              <td title={servicePlanNames.join(', ')}>
                                {servicePlanNames.length ? `${servicePlanNames.length} plan${servicePlanNames.length === 1 ? '' : 's'}` : 'N/A'}
                              </td>
                            )}
                            {hasCapabilities && <td>{Array.isArray(u.capabilities) ? u.capabilities.join(' + ') : 'N/A'}</td>}
                            <td><StatusBadge status={u.license_status || 'Unknown'} /></td>
                            <td><StatusBadge status={u.usage_status || 'Pending'} /></td>
                            <td>{u.last_activity || 'N/A'}</td>
                            <td>{u.activity_count ?? 'N/A'}</td>
                            <td>{u.display_cost !== undefined && u.display_cost !== null ? money(u.display_cost) : 'N/A'}</td>
                            <td>{u.source || u._source || 'N/A'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ marginBottom: 6 }}>Plans</div>
              {Object.entries(p.plans).map(([plan, count]) => (
                <div key={plan} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span className="muted">{plan}</span><strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="charts">
        <ChartCard title="License Utilization by Product">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT_COMPACT}>
            <BarChart data={utilizationData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis unit="%" width={36} />
              <Tooltip formatter={(v) => v + '%'} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {utilizationData.map((entry, i) => <Cell key={i} fill={colorForProduct(entry.name)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Spend by Product">
          {spendData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
              <PieChart>
                <Pie data={spendData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                  {spendData.map((entry, i) => <Cell key={i} fill={colorForProduct(entry.name)} />)}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
      </>
      )}
      {selectedUser && (
        <UserDetail
          user={selectedUser}
          currency={currency}
          onClose={() => setSelectedUser(null)}
          onOpenProduct={(productName) => {
            setSelectedUser(null)
            setExpanded(productName)
            setFilter('product', { type: 'category', values: [productName] })
          }}
        />
      )}
      {selectedProviderUser && (
        <ProviderUserDetail
          userId={selectedProviderUser.email}
          userName={selectedProviderUser.name}
          provider={selectedProviderUser.provider}
          currency={currency}
          onClose={() => setSelectedProviderUser(null)}
        />
      )}
    </div>
  )
}
