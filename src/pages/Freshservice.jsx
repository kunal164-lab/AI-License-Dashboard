import React, { useMemo, useState } from 'react'
import { Users as UsersIcon, ArrowLeft } from 'lucide-react'
import KpiCard from '../components/KpiCard'
import FilterableDataTable from '../components/FilterableDataTable'
import EmptyState from '../components/EmptyState'
import StatusBadge from '../components/StatusBadge'
import BrandLogo from '../components/BrandLogo'
import ProviderUserDetail from '../components/ProviderUserDetail'
import { formatMoney } from '../utils/currency'
import { licenseStatusLabel } from '../utils/licenseStatus'

function LinkCell({ onClick, children }) {
  return <button className="link-text" onClick={onClick}>{children || 'N/A'}</button>
}

function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : null
}

// Freshservice agents are Microsoft 365 security group members (see the
// Freshservice re-architecture spec) — this page reads them the SAME way
// every other product reads its records: filtered from the app's already-
// merged AI usage dataset (allData, product === 'Freshservice'), never a
// second fetch/dataset. Name/Department/VBU are Microsoft-365-EXCLUSIVE
// (src/utils/userModel.js's AUTHORITATIVE_FIELDS) — resolved here from the
// same microsoftDirectory map Kiro/Claude already use, never invented and
// never taken from any other source. Monthly Cost is whatever the
// centralized Cost Engine already resolved onto the record (display_cost) —
// N/A until a Freshservice agent price is configured in Cost Settings,
// never a fabricated default.
export default function Freshservice({ allData, microsoftDirectory, currency = 'USD', navigate }) {
  const [filteredView, setFilteredView] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)

  const agents = useMemo(() => (allData || []).filter((r) => r.product === 'Freshservice'), [allData])
  const rows = useMemo(() => agents.map((r) => {
    const dir = microsoftDirectory?.get(normEmail(r.email)) || {}
    return {
      ...r,
      name: dir.name || r.name || null,
      department: dir.department || null,
      vbu: dir.vbu || null,
      status_label: licenseStatusLabel(r)
    }
  }), [agents, microsoftDirectory])

  const rowsForKpis = filteredView ?? rows

  function openUser(row) {
    if (row.email) setSelectedUser({ email: row.email, name: row.name })
  }

  const columns = [
    { key: 'name', name: 'User', essential: true, type: 'text', render: (r) => <LinkCell onClick={() => openUser(r)}>{r.name || r.email}</LinkCell> },
    { key: 'email', name: 'Email', essential: true, type: 'text' },
    { key: 'department', name: 'Department', essential: true, type: 'category', render: (r) => r.department || 'N/A' },
    { key: 'vbu', name: 'VBU', essential: true, type: 'category', render: (r) => r.vbu || 'N/A' },
    { key: 'status_label', name: 'License/Agent Status', essential: true, type: 'category', render: (r) => <StatusBadge status={r.status_label} /> },
    { key: 'display_cost', name: 'Monthly Cost', essential: true, type: 'number', render: (r) => (r.display_cost === null || r.display_cost === undefined ? 'N/A' : formatMoney(r.display_cost, currency, { maximumFractionDigits: 2 })) }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          {navigate && <button className="button secondary" onClick={() => navigate('/products')} style={{ marginBottom: 8 }}><ArrowLeft size={16} /> Back to Products</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandLogo product="Freshservice" size="md" />
            <h3 style={{ margin: 0 }}>Freshservice</h3>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Agents are current members of the configured Microsoft 365 security group (Data Sources → Freshservice). Click an agent for details.
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title="No Freshservice agents yet"
          hint="Connect Freshservice from Data Sources → Freshservice by entering your Microsoft 365 security group name."
        />
      ) : (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <KpiCard color="blue" icon={<UsersIcon size={16} />} title="Freshservice Agents" value={rowsForKpis.length} />
          </div>

          <div className="card">
            <div className="card-title">Agents</div>
            <FilterableDataTable
              columns={columns} data={rows} storageKey="freshservice-agents" itemLabel="agents"
              quickKeys={['department', 'vbu', 'status_label']} searchFields={['name', 'email']}
              emptyTitle="No agents match the selected filters" emptyHint="Try removing a filter to broaden the results."
              onFilteredChange={setFilteredView}
            />
          </div>
        </>
      )}

      {selectedUser && (
        <ProviderUserDetail
          userId={selectedUser.email} userName={selectedUser.name} provider="freshservice"
          currency={currency} onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  )
}
