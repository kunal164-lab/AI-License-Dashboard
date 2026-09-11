import React, { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import UserDetail from '../components/UserDetail'
import StatusBadge from '../components/StatusBadge'
import KpiCard from '../components/KpiCard'
import QuickFilterBar from '../components/QuickFilterBar'
import ActiveFilterBar from '../components/ActiveFilterBar'
import ColumnFilterPopover from '../components/ColumnFilterPopover'
import EmptyState from '../components/EmptyState'
import BrandLogo from '../components/BrandLogo'
import {
  Users as UsersIcon, BadgeCheck, CircleAlert, DollarSign, Activity, Gauge, Filter
} from 'lucide-react'
import { uniqueValuesFor } from '../utils/tableFilters'
import { COLUMN_BY_KEY } from '../utils/columnRegistry'
import { formatMoney } from '../utils/currency'

const QUICK_FILTER_KEYS = ['product', 'provider', 'department', 'plan', 'usage_status']
const MORE_FILTER_KEYS = ['role', 'license_status', 'vbu', 'source', 'job_title', 'manager', 'company', 'office', 'domain', 'account_status']
const LOW_STATUSES = ['Low Activity', 'No Usage']

// Each row here is now a CANONICAL user (src/utils/userModel.js) — one row
// per real person, with product/provider/plan/license_status as arrays
// (a person can have several) rather than a single flattened value. Only
// these columns are rendered on the Users table itself; per-product
// numeric/usage fields (chats, ms_* Copilot activity, etc.) don't have one
// meaningful value per multi-product person, so they live in the
// per-product breakdown inside the user detail modal instead (see
// UserDetail.jsx's "Products & Licenses" section).
const VISIBLE_COLUMN_KEYS = [
  'name', 'email', 'job_title', 'department', 'vbu', 'manager', 'product', 'provider', 'plan',
  'license_status', 'role', 'source', 'totalLicenses', 'activity_count',
  'totalSpend', 'last_activity', 'usage_status'
]

function fmtInt(v) {
  if (v === null || v === undefined) return 'N/A'
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^0-9\-]/g, ''), 10)
  if (Number.isNaN(n)) return 'N/A'
  return n.toLocaleString()
}

// data is already the globally-filtered dataset (App.jsx applies every
// active filter before handing records to any page) — Users just renders it
// and provides the UI to add/remove filters, all against the shared
// globalFilters/setFilter/clearFilter/clearAllFilters from App.jsx.
export default function Users({ data, allData, globalFilters, setFilter, clearFilter, clearAllFilters, navigate, currency = 'USD' }) {
  const [selected, setSelected] = useState(null)
  const [openColumnKey, setOpenColumnKey] = useState(null)
  const fmtCurrency = (v) => formatMoney(v, currency, { maximumFractionDigits: 2 })

  function joinArray(v) {
    if (!Array.isArray(v)) return v
    if (!v.length) return 'N/A'
    return v.join(', ')
  }

  const RENDERERS = useMemo(() => ({
    product: (r) => (!Array.isArray(r.product) || !r.product.length ? 'N/A' : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {r.product.map((p) => (
          <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <BrandLogo product={p} size="xs" bordered={false} />
            {p}
          </span>
        ))}
      </div>
    )),
    provider: (r) => joinArray(r.provider),
    plan: (r) => joinArray(r.plan),
    license_status: (r) => joinArray(r.license_status),
    source: (r) => joinArray(r.source),
    totalLicenses: (r) => fmtInt(r.totalLicenses),
    activity_count: (r) => fmtInt(r.activity_count),
    totalSpend: (r) => fmtCurrency(r.totalSpend),
    usage_status: (r) => (<StatusBadge status={r.usage_status} />)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currency])

  // License Status and Usage Status are deliberately BOTH essential/visible
  // by default — they answer different questions (is the license assigned?
  // vs. is it being used?) and showing only one risks the exact
  // license/usage conflation this table must avoid (src/utils/licenseStatus.js).
  const ESSENTIAL_KEYS = new Set(['name', 'email', 'department', 'product', 'provider', 'totalLicenses', 'license_status', 'last_activity', 'usage_status'])

  const columns = useMemo(() => ([
    ...VISIBLE_COLUMN_KEYS.map((key) => COLUMN_BY_KEY[key]).filter(Boolean)
      .map((c) => ({ ...c, essential: ESSENTIAL_KEYS.has(c.key), render: RENDERERS[c.key] })),
    { key: 'actions', name: 'Actions', essential: true, render: (r) => (<button className="button secondary" onClick={() => setSelected(r)}>Details</button>) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [RENDERERS])

  const allUsers = allData || []
  const filteredUsers = data || []

  // ---- Summary KPIs — always derived from the CURRENT filtered set ----
  // LICENSE STATUS vs USAGE STATUS (src/utils/licenseStatus.js): "Active
  // Users" means currently holds an active/assigned license — NOT how much
  // they use it. A user whose license is active but whose usage is Low
  // Activity/No Usage still counts as an Active User here; "Low / No
  // Usage" below is a separate, usage-based signal that can (and often
  // does) overlap with Active Users, not a complementary partition of it.
  // A canonical user's license_status is an array (one entry per product;
  // see src/utils/userModel.js) — "active" means at least one is.
  const totalUsers = filteredUsers.length
  const activeUsers = filteredUsers.filter((r) => Array.isArray(r.license_status) ? r.license_status.includes('Active') : r.license_status === 'Active').length
  const lowUsageUsers = filteredUsers.filter((r) => r.usage_status === 'Low Activity' || r.usage_status === 'No Usage').length
  const totalSpend = filteredUsers.reduce((s, r) => s + (parseFloat(r.totalSpend) || 0), 0)
  const usageValues = filteredUsers.map((r) => Number(r.activity_count)).filter((n) => Number.isFinite(n))
  const avgUsage = usageValues.length ? Math.round(usageValues.reduce((a, b) => a + b, 0) / usageValues.length) : null
  const utilizationPct = totalUsers ? Math.round((activeUsers / totalUsers) * 100) : null

  const hasFilters = Object.keys(globalFilters || {}).length > 0

  function renderColumnHeaderFilter(column) {
    if (!column.type) return null
    const filter = globalFilters[column.key]
    return (
      <span style={{ position: 'relative' }}>
        <button
          className={`th-filter-btn ${filter ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpenColumnKey(openColumnKey === column.key ? null : column.key) }}
          title={`Filter ${column.name}`}
        >
          <Filter />
        </button>
        {openColumnKey === column.key && (
          <ColumnFilterPopover
            column={column}
            currentFilter={filter}
            availableValues={column.type === 'category' ? uniqueValuesFor(allUsers, column.key, globalFilters, column.key) : []}
            onApply={(f) => setFilter(column.key, f)}
            onClear={() => clearFilter(column.key)}
            onClose={() => setOpenColumnKey(null)}
          />
        )}
      </span>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Users</h3>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KpiCard color="blue" icon={<UsersIcon size={16} />} title="Total Users" value={totalUsers} onClick={hasFilters ? clearAllFilters : undefined} />
        <KpiCard color="green" icon={<BadgeCheck size={16} />} title="Active Users" value={activeUsers} onClick={() => setFilter('license_status', { type: 'category', values: ['Active'] })} />
        <KpiCard color="red" icon={<CircleAlert size={16} />} title="Low / No Usage" value={lowUsageUsers} onClick={() => setFilter('usage_status', { type: 'category', values: LOW_STATUSES })} />
        <KpiCard color="purple" icon={<DollarSign size={16} />} title="Total Spend" value={totalSpend ? fmtCurrency(totalSpend) : 'N/A'} />
        <KpiCard color="orange" icon={<Activity size={16} />} title="Average Usage" value={avgUsage ?? 'N/A'} />
        <KpiCard color="teal" icon={<Gauge size={16} />} title="Utilization" value={utilizationPct !== null ? utilizationPct + '%' : 'N/A'} />
      </div>

      <QuickFilterBar
        quickKeys={QUICK_FILTER_KEYS}
        moreKeys={MORE_FILTER_KEYS}
        allData={allUsers}
        filters={globalFilters}
        onSetFilter={setFilter}
        onClearFilter={clearFilter}
      />
      <ActiveFilterBar
        filters={globalFilters}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        shownCount={totalUsers}
        totalCount={allUsers.length}
        itemLabel="users"
      />

      <DataTable
        columns={columns}
        data={filteredUsers}
        onRowClick={(r) => setSelected(r)}
        storageKey="users"
        hideSearch
        renderColumnFilter={renderColumnHeaderFilter}
        emptyState={<EmptyState title="No users match the selected filters." hint="Try removing a filter to broaden the results." />}
      />
      {filteredUsers.length === 0 && hasFilters && (
        <div style={{ textAlign: 'center', marginTop: -12, marginBottom: 12 }}>
          <button className="button secondary" onClick={clearAllFilters}>Clear Filters</button>
        </div>
      )}
      {selected && (
        <UserDetail
          user={selected}
          currency={currency}
          onClose={() => setSelected(null)}
          onOpenProduct={(productName) => {
            setSelected(null)
            setFilter('product', { type: 'category', values: [productName] })
            if (navigate) navigate('/products')
          }}
        />
      )}
    </div>
  )
}
