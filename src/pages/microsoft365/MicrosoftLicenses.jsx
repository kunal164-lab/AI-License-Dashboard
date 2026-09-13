import React, { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import ChartCard from '../../components/ChartCard'
import EmptyState from '../../components/EmptyState'
import QuickFilterBar from '../../components/QuickFilterBar'
import ActiveFilterBar from '../../components/ActiveFilterBar'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import { TruncatedAxisTick, horizontalBarChartHeight, CHART_HEIGHT_ROOMY } from '../../components/charts/ChartAxisTick'

const PIE_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b', '#d97706', '#0d9488', '#9333ea', '#e11d48', '#4f46e5', '#65a30d', '#0284c7']

// Top-level ("Licenses") filter columns — License narrows to one row by its
// display name, Department/VBU scope the assigned counts themselves (not
// just which rows are shown). VBU always comes from the canonical Microsoft
// user field (onPremisesExtensionAttributes.extensionAttribute3, synced
// into microsoft_users.vbu) — this page never derives it any other way.
export const OVERVIEW_FILTER_COLUMNS = {
  license: { key: 'license', name: 'License', type: 'category' },
  department: { key: 'department', name: 'Department', type: 'category' },
  vbu: { key: 'vbu', name: 'VBU', type: 'category' }
}
// License detail's own user-table filters — Department/VBU refine WITHIN
// whatever the overview's own department/vbu filters already scoped the
// fetch to. Usage Status only applies to Microsoft 365 Copilot (the one
// license this app has real usage data for); it's simply absent from every
// other license's filter bar.
function detailFilterColumns(hasUsageStatus) {
  const cols = {
    department: { key: 'department', name: 'Department', type: 'category' },
    vbu: { key: 'vbu', name: 'VBU', type: 'category' }
  }
  if (hasUsageStatus) cols.usage_status = { key: 'usage_status', name: 'Usage Status', type: 'category' }
  return cols
}

// Category filters in this app are multi-select (checkboxes in
// ColumnFilterPopover) — joined as a comma-separated query param, matching
// costAnalytics.js's own applyRowFilters convention exactly, so selecting
// more than one Department/VBU/License narrows to ANY of them rather than
// silently keeping only the first choice.
function joinedValues(filter) { return filter?.values?.length ? filter.values.join(',') : null }

// Plain {key,name} column defs for the unified "Export Report" menu
// (Microsoft365.jsx's toExportColumns).
export const LICENSE_EXPORT_COLUMNS = [
  { key: 'license', name: 'License' },
  { key: 'product', name: 'Product' },
  { key: 'assigned', name: 'Assigned' }
]

// `users` is the already-fetched Microsoft 365 directory (Microsoft365.jsx's
// own /api/microsoft/data users list, which already carries department and
// the canonical vbu field) — used ONLY to populate the Department/VBU
// filter dropdowns' option lists here; the assigned counts themselves
// always come from the server (/api/microsoft/licenses), never recomputed
// client-side from this list.
// `copilotByEmail`: Map<lowercased email, Copilot AI-usage record> — the
// SAME map Microsoft365.jsx's own Copilot view already builds
// (src/utils/activityScore.js's usage_status, via the app's canonical AI
// dataset). Reused here only to show "Usage Status" in Copilot's own
// license detail (Part 6: "usage status where applicable") — nothing here
// recalculates it.
export default function MicrosoftLicenses({ users = [], copilotByEmail, onOpenMicrosoftUser, onOpenCopilotUser, onItemsChange, onFiltersChange }) {
  const [filters, setFilters] = useState({})
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)

  // Reports the current rows/filters up to Microsoft365.jsx so the page's
  // existing unified "Export Report" menu can still offer a "Licenses"
  // dataset — same lift-state-up pattern every other view on this page
  // already uses (filteredUsersView/usersFilters, etc).
  React.useEffect(() => { onItemsChange?.(items) }, [items])
  React.useEffect(() => { onFiltersChange?.(filters) }, [filters])

  const [selectedLicenseId, setSelectedLicenseId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFilters, setDetailFilters] = useState({})

  const num = (v) => (v === null || v === undefined ? 'N/A' : v.toLocaleString())

  function fetchOverview(f) {
    setLoading(true)
    const params = new URLSearchParams()
    if (joinedValues(f.license)) params.set('license', joinedValues(f.license))
    if (joinedValues(f.department)) params.set('department', joinedValues(f.department))
    if (joinedValues(f.vbu)) params.set('vbu', joinedValues(f.vbu))
    fetch(`/api/microsoft/licenses?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => setItems(j.items || []))
      .catch(() => setItems([]))
      .finally(() => { setLoading(false); setLoaded(true) })
  }

  // Fetch on mount and whenever the top-level filters change.
  React.useEffect(() => { fetchOverview(filters) }, [filters])

  function setFilter(key, f) { setFilters((prev) => ({ ...prev, [key]: f })) }
  function clearFilter(key) { setFilters((prev) => { const n = { ...prev }; delete n[key]; return n }) }
  function clearAllFilters() { setFilters({}) }

  function openLicense(row) {
    setSelectedLicenseId(row.licenseId)
    setDetail(null)
    // Seed the detail's own filters from whatever was already active at the
    // top level, so the user list you land on matches the row you clicked —
    // freely adjustable afterward.
    const seeded = {}
    if (filters.department) seeded.department = filters.department
    if (filters.vbu) seeded.vbu = filters.vbu
    setDetailFilters(seeded)
    setDetailLoading(true)
    const params = new URLSearchParams()
    if (joinedValues(filters.department)) params.set('department', joinedValues(filters.department))
    if (joinedValues(filters.vbu)) params.set('vbu', joinedValues(filters.vbu))
    fetch(`/api/microsoft/licenses/${encodeURIComponent(row.licenseId)}?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error('License not found'); return r.json() })
      .then((j) => {
        // Usage status only exists for Microsoft 365 Copilot — joined
        // client-side from the already-computed AI usage dataset, never
        // recalculated here.
        const withUsage = j.license.product === 'Microsoft Copilot' && copilotByEmail
          ? { ...j, users: j.users.map((u) => ({ ...u, usage_status: (u.email && copilotByEmail.get(u.email.toLowerCase())?.usage_status) || null })) }
          : j
        setDetail(withUsage)
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false))
  }
  function backToLicenses() { setSelectedLicenseId(null); setDetail(null); setDetailFilters({}) }
  function setDetailFilter(key, f) { setDetailFilters((prev) => ({ ...prev, [key]: f })) }
  function clearDetailFilter(key) { setDetailFilters((prev) => { const n = { ...prev }; delete n[key]; return n }) }
  function clearAllDetailFilters() { setDetailFilters({}) }

  function openDetailUser(row) {
    if (detail?.license?.product === 'Microsoft Copilot' && row.email) onOpenCopilotUser?.(row.email, row.name)
    else if (row.ms_id) onOpenMicrosoftUser?.(row.ms_id)
  }

  const overviewColumns = [
    { key: 'license', name: 'License', type: 'text', essential: true, render: (r) => <span className="link-text">{r.license}</span> },
    { key: 'product', name: 'Product', type: 'category', essential: true },
    { key: 'assigned', name: 'Assigned', type: 'number', essential: true, render: (r) => num(r.assigned) }
  ]

  const hasUsageStatus = detail?.license?.product === 'Microsoft Copilot'
  const detailColumns = [
    { key: 'name', name: 'User', type: 'text', essential: true, render: (r) => <span className="link-text">{r.name || 'N/A'}</span> },
    { key: 'email', name: 'Email', type: 'text', essential: true, render: (r) => r.email || 'N/A' },
    { key: 'department', name: 'Department', type: 'category', essential: true, render: (r) => r.department || 'N/A' },
    { key: 'vbu', name: 'VBU', type: 'category', essential: true, render: (r) => r.vbu || 'N/A' },
    ...(hasUsageStatus ? [{ key: 'usage_status', name: 'Usage Status', type: 'category', essential: true, render: (r) => (r.usage_status ? <StatusBadge status={r.usage_status} /> : 'N/A') }] : []),
    // Microsoft Copilot is presented as ONE business product ("Microsoft
    // Copilot" / Premium — see server/services/microsoft/
    // copilotEntitlement.js) even though more than one real Graph SKU can
    // roll up into it. The real SKU(s) stay available here as secondary/
    // technical detail (not essential, so it doesn't clutter the default
    // view) — never lost, never promoted into a separate product row.
    ...(hasUsageStatus ? [{ key: 'skuPartNumbers', name: 'SKU', type: 'category', essential: false, render: (r) => (Array.isArray(r.skuPartNumbers) && r.skuPartNumbers.length ? r.skuPartNumbers.join(', ') : 'N/A') }] : [])
  ]

  // ---- License detail: filtered users (Department/VBU/Usage Status),
  // applied client-side over the already department/vbu-scoped fetch above
  // — no second server round-trip for this extra layer. ----
  const detailUsers = detail?.users || []
  const filteredDetailUsers = detailUsers.filter((u) => {
    for (const key of Object.keys(detailFilters)) {
      const f = detailFilters[key]
      if (!f || !f.values?.length) continue
      if (!f.values.includes(u[key])) return false
    }
    return true
  })

  const pieData = items.map((i) => ({ name: i.license, value: i.assigned }))
  const barData = items.map((i) => ({ name: i.license, value: i.assigned }))

  // ---- Detail view ----
  if (selectedLicenseId) {
    if (detailLoading || !detail) return <div className="muted">Loading license detail...</div>
    const l = detail.license
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-button" onClick={backToLicenses} aria-label="Back"><ArrowLeft size={16} /></button>
          <div>
            <h4 style={{ margin: 0 }}>{l.license}</h4>
            <div className="muted small" style={{ marginTop: 2 }}>{l.product} · {num(detail.assigned)} assigned users</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <QuickFilterBar
            quickKeys={hasUsageStatus ? ['department', 'vbu', 'usage_status'] : ['department', 'vbu']} moreKeys={[]} allData={detailUsers}
            filters={detailFilters} onSetFilter={setDetailFilter} onClearFilter={clearDetailFilter}
            showSearch={false} columnByKey={detailFilterColumns(hasUsageStatus)}
          />
          <ActiveFilterBar
            filters={detailFilters} onClearFilter={clearDetailFilter} onClearAll={clearAllDetailFilters}
            shownCount={filteredDetailUsers.length} totalCount={detailUsers.length} itemLabel="users" columnByKey={detailFilterColumns(hasUsageStatus)}
          />
          <DataTable
            columns={detailColumns} data={filteredDetailUsers} onRowClick={openDetailUser} storageKey="microsoft365-license-detail"
            emptyState={<EmptyState title="No users match the selected filters" hint="Try removing a filter to broaden the results." />}
          />
        </div>
      </div>
    )
  }

  // ---- Overview: filters, charts, then the simple 3-column table ----
  if (loading && !loaded) return <div className="muted">Loading licenses...</div>

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 8 }}>Licenses</div>
      <div className="muted small" style={{ marginBottom: 10 }}>
        Current assignment counts for the paid Microsoft 365 licenses this tenant monitors.
      </div>

      {/* Two QuickFilterBar instances side by side, not one — "License"
          options come from the license rows themselves, "Department"/"VBU"
          from the Microsoft directory; a single shared allData array can't
          serve both. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <QuickFilterBar
          quickKeys={['license']} moreKeys={[]} allData={items}
          filters={filters} onSetFilter={setFilter} onClearFilter={clearFilter}
          showSearch={false} columnByKey={OVERVIEW_FILTER_COLUMNS}
        />
        <QuickFilterBar
          quickKeys={['department', 'vbu']} moreKeys={[]} allData={users}
          filters={filters} onSetFilter={setFilter} onClearFilter={clearFilter}
          showSearch={false} columnByKey={OVERVIEW_FILTER_COLUMNS}
        />
      </div>
      <ActiveFilterBar
        filters={filters} onClearFilter={clearFilter} onClearAll={clearAllFilters}
        shownCount={items.length} totalCount={items.length} itemLabel="licenses" columnByKey={OVERVIEW_FILTER_COLUMNS}
      />

      {items.length === 0 ? (
        <EmptyState title="No licenses match the selected filters" hint="Try removing a filter to broaden the results." />
      ) : (
        <>
          <div className="charts-2col" style={{ marginBottom: 16 }}>
            <ChartCard title="Assigned Users by License" subtitle="Share of assigned seats across monitored licenses">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label={({ percent }) => `${Math.round(percent * 100)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v.toLocaleString(), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Assigned Licenses" subtitle="Current assignment count per license, highest first">
              <ResponsiveContainer width="100%" height={horizontalBarChartHeight(barData.length, { min: 190 })}>
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={160} tick={<TruncatedAxisTick maxChars={24} />} interval={0} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0b5fff" name="Assigned" radius={[0, 4, 4, 0]} cursor="pointer"
                    onClick={(d) => { const row = items.find((i) => i.license === d.name); if (row) openLicense(row) }} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <DataTable
            columns={overviewColumns} data={items} onRowClick={openLicense} storageKey="microsoft365-licenses"
            emptyState={<EmptyState title="No licenses match the selected filters" />}
          />
        </>
      )}
    </div>
  )
}
