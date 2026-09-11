import React, { useMemo, useState } from 'react'
import DataTable from '../../components/DataTable'
import QuickFilterBar from '../../components/QuickFilterBar'
import ActiveFilterBar from '../../components/ActiveFilterBar'
import EmptyState from '../../components/EmptyState'
import StatusBadge from '../../components/StatusBadge'
import UserDetail from '../../components/UserDetail'
import { formatMoney } from '../../utils/currency'
import { useCostJson } from './useCostJson'

const QUICK_KEYS = ['department', 'vbu', 'domain', 'usage_status']

// Excel-style Cost by User table (Part 13 of the spec) — search/sort/filter/
// pagination via the same DataTable every other page uses. Clicking a user
// fetches their full canonical profile (GET /api/cost/users/:id, which is
// literally the same buildCanonicalUsers() object Users.jsx uses) and opens
// it in the SAME UserDetail component Users/Products already use — no
// second "user cost" model.
export default function CostByUser({ currency = 'USD' }) {
  const { data, loading } = useCostJson('/api/cost/users')
  const [filters, setFilters] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [userDetail, setUserDetail] = useState(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const money = (v) => (v === null || v === undefined ? 'N/A' : formatMoney(v, currency, { maximumFractionDigits: 2 }))

  const items = data?.items || []
  const filtered = useMemo(() => {
    return items.filter((u) => {
      for (const key of Object.keys(filters)) {
        const f = filters[key]
        if (!f || !f.values?.length) continue
        const val = key === 'products' ? u.products : u[key]
        if (Array.isArray(val)) { if (!val.some((v) => f.values.includes(v))) return false }
        else if (!f.values.includes(val)) return false
      }
      return true
    })
  }, [items, filters])

  function setFilter(key, f) { setFilters((prev) => ({ ...prev, [key]: f })) }
  function clearFilter(key) { setFilters((prev) => { const n = { ...prev }; delete n[key]; return n }) }
  function clearAllFilters() { setFilters({}) }

  function openUser(row) {
    setSelectedId(row.id)
    setLoadingUser(true)
    fetch(`/api/cost/users/${encodeURIComponent(row.id)}`)
      .then((r) => r.json())
      .then((j) => setUserDetail(j.user))
      .finally(() => setLoadingUser(false))
  }

  const columns = useMemo(() => ([
    { key: 'name', name: 'User', type: 'text', essential: true, render: (r) => <span className="link-text">{r.name}</span> },
    { key: 'email', name: 'Email', type: 'text', essential: true },
    { key: 'department', name: 'Department', type: 'category', essential: true, render: (r) => r.department || 'N/A' },
    { key: 'vbu', name: 'VBU', type: 'category', render: (r) => r.vbu || 'N/A' },
    { key: 'domain', name: 'Domain', type: 'category', render: (r) => r.domain || 'N/A' },
    { key: 'products', name: 'Products', type: 'category', essential: true, render: (r) => (r.products || []).join(', ') || 'N/A' },
    { key: 'licenses', name: 'Licenses', type: 'number', essential: true },
    { key: 'activeLicenses', name: 'Active', type: 'number' },
    { key: 'unusedLicenses', name: 'No Usage', type: 'number' },
    { key: 'monthlyCost', name: 'Monthly Cost', type: 'number', essential: true, render: (r) => money(r.monthlyCost) },
    { key: 'annualCost', name: 'Annual Cost', type: 'number', render: (r) => money(r.annualCost) },
    { key: 'potentialSavings', name: 'Potential Savings', type: 'number', render: (r) => (r.potentialSavings ? money(r.potentialSavings) : 'N/A') },
    { key: 'usage_status', name: 'Usage Status', type: 'category', essential: true, render: (r) => <StatusBadge status={r.usage_status} /> }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [currency])

  if (loading) return <div className="muted">Loading user cost data...</div>
  if (!items.length) return <EmptyState title="No user cost data available" />

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 8 }}>Cost by User</div>
      <QuickFilterBar quickKeys={QUICK_KEYS} moreKeys={[]} allData={items} filters={filters} onSetFilter={setFilter} onClearFilter={clearFilter} />
      <ActiveFilterBar filters={filters} onClearFilter={clearFilter} onClearAll={clearAllFilters} shownCount={filtered.length} totalCount={items.length} itemLabel="users" />
      <DataTable columns={columns} data={filtered} onRowClick={openUser} storageKey="cost-by-user"
        emptyState={<EmptyState title="No users match the selected filters" />} />

      {selectedId && (
        loadingUser || !userDetail ? (
          <div className="modal-overlay" onClick={() => setSelectedId(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}><div className="muted">Loading user...</div></div>
          </div>
        ) : (
          <UserDetail user={userDetail} currency={currency} onClose={() => { setSelectedId(null); setUserDetail(null) }} />
        )
      )}
    </div>
  )
}
