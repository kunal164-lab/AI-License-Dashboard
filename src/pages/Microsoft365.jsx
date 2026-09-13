import React, { useEffect, useMemo, useState } from 'react'
import {
  Users as UsersIcon, BadgeCheck, Laptop, ShieldCheck, ShieldAlert, AppWindow, Bot, KeyRound, ArrowLeft,
  Building2, MessagesSquare, LogIn, XCircle, Ban
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, LineChart, Line } from 'recharts'
import ChartCard from '../components/ChartCard'
import KpiCard from '../components/KpiCard'
import FilterableDataTable from '../components/FilterableDataTable'
import EmptyState from '../components/EmptyState'
import StatusBadge from '../components/StatusBadge'
import UserDetailModal from '../components/microsoft/UserDetailModal'
import DeviceDetailModal from '../components/microsoft/DeviceDetailModal'
import ApplicationDetailModal from '../components/microsoft/ApplicationDetailModal'
import Microsoft365ExportMenu from '../components/microsoft/Microsoft365ExportMenu'
import ProviderUserDetail from '../components/ProviderUserDetail'
import MicrosoftLicenses, { LICENSE_EXPORT_COLUMNS, OVERVIEW_FILTER_COLUMNS as LICENSE_FILTER_COLUMNS } from './microsoft365/MicrosoftLicenses'
import { groupApplicationsByName } from '../utils/microsoftApplicationGroups'
import BrandLogo from '../components/BrandLogo'
import { TruncatedAxisTick, horizontalBarChartHeight, CHART_HEIGHT_COMPACT, CHART_HEIGHT_ROOMY } from '../components/charts/ChartAxisTick'
import { licenseStatusLabel } from '../utils/licenseStatus'
import { describeFilters } from '../utils/tableFilters'
import toast from '../utils/toast'

const PIE_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b']

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}
function LinkCell({ onClick, children }) {
  return <button className="link-text" onClick={onClick}>{children || 'N/A'}</button>
}
// {key,name} column defs (already used by every FilterableDataTable on this
// page) double as the export projection for the unified Export Report menu
// — {key,label} pairs, so a dataset's CSV/XLSX/PDF always mirrors exactly
// what the on-screen table shows, never a second column definition.
function toExportColumns(columns) {
  return columns.map((c) => ({ key: c.key, label: c.name }))
}
function colMap(columns) {
  return Object.fromEntries(columns.map((c) => [c.key, c]))
}

// Every dataset this page can show, in view-selector order. `key` matches
// the view state; availability (whether it actually appears in the
// selector) is computed from real data below — Part 16 of the spec this
// implements is explicit that a view with no data must not be fabricated
// or shown empty by default.
const VIEW_DEFS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'devices', label: 'Devices' },
  { key: 'applications', label: 'Applications' },
  { key: 'licenses', label: 'Licenses' },
  { key: 'departments', label: 'Departments' },
  { key: 'groups', label: 'Groups & Teams' },
  { key: 'signins', label: 'Sign-ins / Activity' },
  { key: 'copilot', label: 'Copilot' }
]

// allData: the app's already-merged AI usage dataset (App.jsx) — filtered
// here to product === 'Microsoft Copilot' rather than re-fetching, so
// Copilot KPIs stay perfectly consistent with the Overview/Users pages.
// Every Copilot record already carries BOTH license_status (real Microsoft
// Graph license assignment — see server/services/microsoft/
// copilotEnrichment.js and src/utils/licenseStatus.js) and usage_status
// (activity-based — src/utils/activityScore.js) as SEPARATE fields; this
// page never conflates the two.
// setFilter/clearAllFilters: the app-wide AI-dashboard filter state, used
// only by the "Copilot Users" KPIs, which drill into the separate AI
// License dashboard's Users page (a different dataset from this page's own
// Microsoft 365 directory Users table).
export default function Microsoft365({ allData, navigate, setFilter, currency = 'USD' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('overview')
  const [filteredUsersView, setFilteredUsersView] = useState(null)
  const [filteredDevicesView, setFilteredDevicesView] = useState(null)
  const [filteredApplicationsView, setFilteredApplicationsView] = useState(null)
  // The license-centric aggregate rows (one per current license/SKU) and
  // their active top-level filters, reported up from MicrosoftLicenses.jsx
  // via onItemsChange/onFiltersChange — same lift-state-up pattern as every
  // other view's filteredXView/xFilters pair, so the unified Export Report
  // menu's "Licenses" dataset still works, now reflecting the new
  // license-centric shape instead of the old one-row-per-assignment shape.
  const [licenseAggregateItems, setLicenseAggregateItems] = useState([])
  const [filteredGroupsView, setFilteredGroupsView] = useState(null)
  const [filteredSignInsView, setFilteredSignInsView] = useState(null)
  const [filteredCopilotView, setFilteredCopilotView] = useState(null)

  // Each view's own active in-table filters (quick-filter pills + column
  // popovers), tracked separately from the filtered ROWS above — this is
  // what lets a PDF export of "the current view, filtered" say exactly
  // which filters produced it (Part 6 of the spec: every report must list
  // its applied filters), reusing the same describeFilters() the
  // on-screen ActiveFilterBar chips already use so the two can never
  // drift apart.
  const [usersFilters, setUsersFilters] = useState({})
  const [devicesFilters, setDevicesFilters] = useState({})
  const [applicationsFilters, setApplicationsFilters] = useState({})
  const [licensesFilters, setLicensesFilters] = useState({})
  const [groupsFilters, setGroupsFilters] = useState({})
  const [signInsFilters, setSignInsFilters] = useState({})
  const [copilotFilters, setCopilotFilters] = useState({})

  // KPI/department/domain-driven drill-down into the Users/Devices table's
  // own filter (e.g. "Non-Compliant Devices" -> Devices' compliance_state
  // filter, or "Finance" department -> Users' department filter). Each
  // {key,value} + an incrementing token so the same filter can be
  // re-applied even if it was manually cleared since the last click.
  const [usersExternalFilter, setUsersExternalFilter] = useState(null)
  const [usersFilterToken, setUsersFilterToken] = useState(0)
  const [devicesExternalFilter, setDevicesExternalFilter] = useState(null)
  const [devicesFilterToken, setDevicesFilterToken] = useState(0)

  // Read-only drill-down modal stack: linear history so Back/Close are
  // always unambiguous, and opening the same or a related record never
  // creates a circular loop — it's just another push.
  const [detailStack, setDetailStack] = useState([])
  function openUser(msId) { setDetailStack((s) => [...s, { type: 'user', key: msId }]) }
  function openDevice(msId) { setDetailStack((s) => [...s, { type: 'device', key: msId }]) }
  function openApplication(name) { setDetailStack((s) => [...s, { type: 'application', key: name }]) }
  function closeDetail() { setDetailStack([]) }
  function backDetail() { setDetailStack((s) => s.slice(0, -1)) }
  const currentDetail = detailStack[detailStack.length - 1]

  // Microsoft 365 Copilot's user detail is the SAME reusable provider-aware
  // component Products.jsx uses (server/services/userDetail.js — license/
  // usage/why-this-status/potential savings), not the generic Microsoft
  // directory modal above — a license row's users get whichever detail is
  // actually appropriate for that license (Part 5 of the license-centric
  // Licenses page spec).
  const [selectedCopilotUser, setSelectedCopilotUser] = useState(null)
  function openCopilotUser(email, name) { setSelectedCopilotUser({ email, name }) }

  useEffect(() => {
    fetch('/api/microsoft/data').then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [])

  const copilotRecords = useMemo(() => (allData || []).filter((r) => r.product === 'Microsoft Copilot'), [allData])
  const copilotActive = copilotRecords.filter((r) => r.usage_status === 'Active' || r.usage_status === 'Heavily Active')
  const copilotLicenseActive = useMemo(() => copilotRecords.filter((r) => licenseStatusLabel(r) === 'Active'), [copilotRecords])
  const copilotByEmail = useMemo(() => new Map(copilotRecords.filter((r) => r.email).map((r) => [r.email.toLowerCase(), r])), [copilotRecords])

  const applications = data?.applications || []
  const licenses = data?.licenses || []
  const groups = data?.groups || []
  const signIns = data?.signIns || []

  // Precompute human-readable labels for boolean fields so the filter
  // popover shows "Enabled"/"Yes" checkboxes instead of raw true/false, and
  // join in this person's real Copilot license/usage status (from the
  // canonical AI dataset above) where a matching email exists — never
  // fabricated when no match is found.
  const users = useMemo(() => (data?.users || []).map((u) => {
    const copilot = u.upn ? copilotByEmail.get(u.upn.toLowerCase()) : null
    return {
      ...u,
      status_label: u.account_enabled ? 'Enabled' : 'Disabled',
      copilot_license_status: copilot ? licenseStatusLabel(copilot) : null,
      copilot_usage_status: copilot ? copilot.usage_status : null,
      copilot_last_activity: copilot ? copilot.last_activity : null,
      copilot_activity_count: copilot ? copilot.activity_count : null
    }
  }), [data, copilotByEmail])
  const devices = data?.devices || []
  const groupRows = useMemo(() => groups.map((g) => ({ ...g, team_label: g.is_team ? 'Yes' : 'No', security_label: g.security_enabled ? 'Yes' : 'No' })), [groups])

  // "An application" = every microsoft_applications row sharing a
  // display_name — Intune's detectedApps API stores one row per
  // (name, version) combination, not one row per app (see
  // utils/microsoftApplicationGroups.js, shared with the Applications page).
  const applicationGroups = useMemo(() => groupApplicationsByName(applications), [applications])

  // Falls back to the unfiltered set until the table below reports its
  // first (initially "no filters applied") result.
  const usersForKpis = filteredUsersView ?? users
  const devicesForKpis = filteredDevicesView ?? devices

  const domains = useMemo(() => {
    const map = new Map()
    for (const u of usersForKpis) {
      const d = u.domain || 'Unknown'
      if (!map.has(d)) map.set(d, { domain: d, totalUsers: 0, activeUsers: 0 })
      const e = map.get(d)
      e.totalUsers++
      if (u.account_enabled) e.activeUsers++
    }
    return Array.from(map.values()).sort((a, b) => b.totalUsers - a.totalUsers)
  }, [usersForKpis])

  const departmentsChart = useMemo(() => {
    const map = new Map()
    for (const u of usersForKpis) {
      const d = u.department || 'Unknown'
      map.set(d, (map.get(d) || 0) + 1)
    }
    return Array.from(map.entries()).map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count)
  }, [usersForKpis])

  const devicesByOs = useMemo(() => {
    const map = new Map()
    for (const d of devicesForKpis) {
      const os = d.operating_system || 'Unknown'
      map.set(os, (map.get(os) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }))
  }, [devicesForKpis])

  const licenseBreakdown = useMemo(() => {
    const map = new Map()
    for (const l of licenses) {
      const sku = l.sku_part_number || l.sku_id
      map.set(sku, (map.get(sku) || 0) + 1)
    }
    return Array.from(map.entries()).map(([sku, count]) => ({ sku, count })).sort((a, b) => b.count - a.count).slice(0, 15)
  }, [licenses])

  const managedCompliant = devicesForKpis.filter((d) => d.compliance_state === 'compliant').length
  const nonCompliantValues = useMemo(() => Array.from(new Set(devices.map((d) => d.compliance_state).filter((v) => v && v !== 'compliant'))), [devices])
  const managedNonCompliant = devicesForKpis.filter((d) => d.compliance_state && d.compliance_state !== 'compliant').length

  const enabledUsersCount = useMemo(() => users.filter((u) => u.account_enabled).length, [users])
  const totalTeams = groups.filter((g) => g.is_team).length

  const groupsByType = useMemo(() => {
    const map = new Map()
    for (const g of groups) {
      let type = 'Other'
      if (g.is_team) type = 'Team'
      else if ((g.group_types || []).includes('Unified')) type = 'Microsoft 365 Group'
      else if (g.security_enabled) type = 'Security Group'
      else if (g.mail_enabled) type = 'Distribution List'
      map.set(type, (map.get(type) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }))
  }, [groups])

  const successfulSignIns = signIns.filter((s) => s.status === 'success').length
  const failedSignInsList = useMemo(() => signIns.filter((s) => s.status === 'failure'), [signIns])
  const uniqueSignInUsers = useMemo(() => new Set(signIns.map((s) => s.user_id).filter(Boolean)).size, [signIns])

  const signInsByDay = useMemo(() => {
    const map = new Map()
    for (const s of signIns) {
      if (!s.created_at) continue
      const day = s.created_at.slice(0, 10)
      if (!map.has(day)) map.set(day, { day, success: 0, failure: 0 })
      const e = map.get(day)
      if (s.status === 'success') e.success++
      else if (s.status === 'failure') e.failure++
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
  }, [signIns])

  const signInsByApp = useMemo(() => {
    const map = new Map()
    for (const s of signIns) {
      const app = s.app_display_name || 'Unknown'
      map.set(app, (map.get(app) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [signIns])

  // Real license-status/usage-status pairing across every Copilot record —
  // feeds the Complete Report PDF's Copilot section (never derived from
  // usage alone, per src/utils/licenseStatus.js).
  const copilotBreakdown = useMemo(() => {
    const map = new Map()
    for (const r of copilotRecords) {
      const licenseStatus = licenseStatusLabel(r) || 'Unknown'
      const usageStatus = r.usage_status || 'Unknown'
      const key = `${licenseStatus}||${usageStatus}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return Array.from(map.entries()).map(([key, count]) => {
      const [licenseStatus, usageStatus] = key.split('||')
      return { licenseStatus, usageStatus, count }
    }).sort((a, b) => b.count - a.count)
  }, [copilotRecords])

  // ---- Cross-view navigation ----
  function goToUsersFiltered(key, value) { setUsersExternalFilter({ key, value }); setUsersFilterToken((t) => t + 1); setView('users') }
  function goToDevicesFiltered(key, value) { setDevicesExternalFilter({ key, value }); setDevicesFilterToken((t) => t + 1); setView('devices') }

  const userColumns = [
    { key: 'display_name', name: 'Name', essential: true, type: 'text', render: (r) => <LinkCell onClick={() => openUser(r.ms_id)}>{r.display_name}</LinkCell> },
    { key: 'upn', name: 'Email / UPN', essential: true, type: 'text' },
    { key: 'domain', name: 'Domain', essential: true, type: 'category' },
    { key: 'department', name: 'Department', essential: true, type: 'category' },
    { key: 'job_title', name: 'Job Title', type: 'text' },
    { key: 'office_location', name: 'Office', type: 'text' },
    { key: 'status_label', name: 'Account Status', essential: true, type: 'category' },
    { key: 'copilot_license_status', name: 'Copilot License', type: 'category', render: (r) => (r.copilot_license_status ? <StatusBadge status={r.copilot_license_status} /> : 'N/A') },
    { key: 'copilot_usage_status', name: 'Copilot Usage', type: 'category', render: (r) => (r.copilot_usage_status ? <StatusBadge status={r.copilot_usage_status} /> : 'N/A') },
    { key: 'copilot_last_activity', name: 'Last Copilot Activity', type: 'date', render: (r) => r.copilot_last_activity || 'N/A' }
  ]
  const deviceColumns = [
    { key: 'device_name', name: 'Device', essential: true, type: 'text', render: (r) => <LinkCell onClick={() => openDevice(r.ms_id)}>{r.device_name}</LinkCell> },
    { key: 'user_principal_name', name: 'Primary User', essential: true, type: 'text' },
    { key: 'operating_system', name: 'OS', essential: true, type: 'category' },
    { key: 'os_version', name: 'OS Version', type: 'text' },
    { key: 'compliance_state', name: 'Compliance', essential: true, type: 'category' },
    { key: 'management_state', name: 'Management State', type: 'category' },
    { key: 'owner_type', name: 'Ownership', type: 'category' },
    { key: 'manufacturer', name: 'Manufacturer', type: 'text' },
    { key: 'model', name: 'Model', type: 'text' },
    { key: 'last_sync_at', name: 'Last Sync', essential: true, type: 'date', render: (r) => fmtDate(r.last_sync_at) }
  ]
  const appColumns = [
    { key: 'display_name', name: 'Application', essential: true, type: 'text', render: (r) => <LinkCell onClick={() => openApplication(r.display_name)}>{r.display_name}</LinkCell> },
    { key: 'publisher', name: 'Publisher', essential: true, type: 'category' },
    { key: 'platform', name: 'Platform', essential: true, type: 'category' },
    { key: 'version_count', name: 'Versions', essential: true, type: 'number' },
    { key: 'device_count', name: 'Devices', essential: true, type: 'number' }
  ]
  const groupColumns = [
    { key: 'display_name', name: 'Name', essential: true, type: 'text' },
    { key: 'mail', name: 'Mail', essential: true, type: 'text' },
    { key: 'team_label', name: 'Team', essential: true, type: 'category' },
    { key: 'visibility', name: 'Visibility', type: 'category' },
    { key: 'security_label', name: 'Security-Enabled', type: 'category' },
    { key: 'created_at_graph', name: 'Created', essential: true, type: 'date', render: (r) => fmtDate(r.created_at_graph) }
  ]
  const failedSignInColumns = [
    { key: 'created_at', name: 'Time', essential: true, type: 'date', render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : 'N/A') },
    { key: 'user_principal_name', name: 'User', essential: true, type: 'text' },
    { key: 'app_display_name', name: 'Application', essential: true, type: 'category' },
    { key: 'failure_reason', name: 'Failure Reason', essential: true, type: 'text' },
    { key: 'ip_address', name: 'IP Address', type: 'text' },
    { key: 'risk_level', name: 'Risk Level', essential: true, type: 'category' },
    { key: 'risk_state', name: 'Risk State', type: 'category' }
  ]
  const copilotColumns = [
    { key: 'name', name: 'Name', essential: true, type: 'text' },
    { key: 'email', name: 'Email', essential: true, type: 'text' },
    { key: 'department', name: 'Department', type: 'category' },
    { key: 'vbu', name: 'VBU', type: 'category' },
    { key: 'plan', name: 'Plan', type: 'category' },
    { key: 'license_status', name: 'License Status', essential: true, type: 'category', render: (r) => <StatusBadge status={r.license_status || 'Unknown'} /> },
    { key: 'usage_status', name: 'Usage Status', essential: true, type: 'category', render: (r) => <StatusBadge status={r.usage_status || 'Pending'} /> },
    { key: 'last_activity', name: 'Last Activity', essential: true, type: 'date' },
    { key: 'activity_count', name: 'Activity Count', type: 'number' },
    { key: 'display_cost', name: 'Monthly Cost', type: 'number', render: (r) => (r.display_cost === null || r.display_cost === undefined ? 'N/A' : r.display_cost) },
    { key: 'cost_label', name: 'Cost Type', type: 'category' }
  ]

  // ---- Unified Export Report menu (Part 13: one export surface for the
  // whole page, no per-view export buttons) — `datasets` is every dataset
  // with real data in report order; `currentView` is the view the user is
  // looking at right now (undefined on Overview, where "current view"
  // export doesn't apply). Rows are always the SAME raw records the
  // on-screen tables already use, never re-fetched or re-shaped.
  const datasets = useMemo(() => {
    const list = []
    if (users.length) list.push({ key: 'users', label: 'Users', rows: users, columns: toExportColumns(userColumns) })
    if (devices.length) list.push({ key: 'devices', label: 'Devices', rows: devices, columns: toExportColumns(deviceColumns) })
    if (applicationGroups.length) list.push({ key: 'applications', label: 'Applications', rows: applicationGroups, columns: toExportColumns(appColumns) })
    if (licenseAggregateItems.length) list.push({ key: 'licenses', label: 'Licenses', rows: licenseAggregateItems, columns: toExportColumns(LICENSE_EXPORT_COLUMNS) })
    if (domains.length) list.push({ key: 'departments', label: 'Departments & Domains', rows: domains, columns: [{ key: 'domain', label: 'Domain' }, { key: 'totalUsers', label: 'Total Users' }, { key: 'activeUsers', label: 'Active Users' }] })
    if (groupRows.length) list.push({ key: 'groups', label: 'Groups & Teams', rows: groupRows, columns: toExportColumns(groupColumns) })
    if (failedSignInsList.length) list.push({ key: 'signins', label: 'Sign-ins (Failed)', rows: failedSignInsList, columns: toExportColumns(failedSignInColumns) })
    if (copilotRecords.length) list.push({ key: 'copilot', label: 'Copilot', rows: copilotRecords, columns: toExportColumns(copilotColumns) })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, devices, applicationGroups, licenseAggregateItems, domains, groupRows, failedSignInsList, copilotRecords])

  const currentView = useMemo(() => {
    switch (view) {
      case 'users': return { key: 'users', label: 'Users', filteredRows: filteredUsersView ?? users, allRows: users, columns: toExportColumns(userColumns), filtersApplied: describeFilters(usersFilters, colMap(userColumns)) }
      case 'devices': return { key: 'devices', label: 'Devices', filteredRows: filteredDevicesView ?? devices, allRows: devices, columns: toExportColumns(deviceColumns), filtersApplied: describeFilters(devicesFilters, colMap(deviceColumns)) }
      case 'applications': return { key: 'applications', label: 'Applications', filteredRows: filteredApplicationsView ?? applicationGroups, allRows: applicationGroups, columns: toExportColumns(appColumns), filtersApplied: describeFilters(applicationsFilters, colMap(appColumns)) }
      case 'licenses': return { key: 'licenses', label: 'Licenses', filteredRows: licenseAggregateItems, allRows: licenseAggregateItems, columns: toExportColumns(LICENSE_EXPORT_COLUMNS), filtersApplied: describeFilters(licensesFilters, LICENSE_FILTER_COLUMNS) }
      case 'departments': return { key: 'departments', label: 'Departments & Domains', filteredRows: domains, allRows: domains, columns: [{ key: 'domain', label: 'Domain' }, { key: 'totalUsers', label: 'Total Users' }, { key: 'activeUsers', label: 'Active Users' }], filtersApplied: [] }
      case 'groups': return { key: 'groups', label: 'Groups & Teams', filteredRows: filteredGroupsView ?? groupRows, allRows: groupRows, columns: toExportColumns(groupColumns), filtersApplied: describeFilters(groupsFilters, colMap(groupColumns)) }
      case 'signins': return { key: 'signins', label: 'Sign-ins (Failed)', filteredRows: filteredSignInsView ?? failedSignInsList, allRows: failedSignInsList, columns: toExportColumns(failedSignInColumns), filtersApplied: describeFilters(signInsFilters, colMap(failedSignInColumns)) }
      case 'copilot': return { key: 'copilot', label: 'Copilot', filteredRows: filteredCopilotView ?? copilotRecords, allRows: copilotRecords, columns: toExportColumns(copilotColumns), filtersApplied: describeFilters(copilotFilters, colMap(copilotColumns)) }
      default: return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filteredUsersView, users, usersFilters, filteredDevicesView, devices, devicesFilters,
    filteredApplicationsView, applicationGroups, applicationsFilters,
    licenseAggregateItems, licensesFilters, domains,
    filteredGroupsView, groupRows, groupsFilters,
    filteredSignInsView, failedSignInsList, signInsFilters,
    filteredCopilotView, copilotRecords, copilotFilters])

  async function handleCompleteReport() {
    try {
      const { downloadMicrosoft365OverviewPdf } = await import('../reports/pdfReport.js')
      const filename = await downloadMicrosoft365OverviewPdf({
        title: 'Microsoft 365 Complete Report',
        generatedAt: new Date().toISOString(),
        dataLastUpdated: null,
        scope: 'complete',
        recordCount: users.length,
        sources: [{ label: 'Microsoft 365' }],
        filtersApplied: [],
        counts: {
          users: users.length, devices: devices.length, applications: applicationGroups.length,
          licenses: licenses.length, groups: groups.length, teams: totalTeams,
          copilotUsers: copilotRecords.length, copilotLicenseActive: copilotLicenseActive.length, signIns: signIns.length
        },
        departments: departmentsChart,
        domains,
        licenses: licenseBreakdown.map((l) => ({ sku: l.sku, count: l.count })),
        applications: applicationGroups.slice().sort((a, b) => (b.device_count || 0) - (a.device_count || 0)).slice(0, 15),
        groupsByType,
        signInsByDay,
        copilotBreakdown
      })
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
  }

  if (loading) return <div className="muted">Loading Microsoft 365 data...</div>

  const hasAnyData = users.length || devices.length || applications.length || licenses.length || groups.length || signIns.length || copilotRecords.length

  const availableViews = VIEW_DEFS.filter((v) => {
    if (v.key === 'overview') return true
    if (v.key === 'users') return users.length > 0
    if (v.key === 'devices') return devices.length > 0
    if (v.key === 'applications') return applicationGroups.length > 0
    if (v.key === 'licenses') return licenses.length > 0
    if (v.key === 'departments') return departmentsChart.length > 0 || domains.length > 0
    if (v.key === 'groups') return groups.length > 0
    if (v.key === 'signins') return signIns.length > 0
    if (v.key === 'copilot') return copilotRecords.length > 0
    return false
  })

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          {navigate && (
            <button className="button secondary" onClick={() => navigate('/products')} style={{ marginBottom: 8 }}>
              <ArrowLeft size={16} /> Back to Products
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandLogo product="Microsoft 365" size="md" />
            <h3 style={{ margin: 0 }}>Microsoft 365</h3>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>Users, devices, applications and licenses synced via Microsoft Graph — Copilot license/usage from the Microsoft 365 reporting data.</div>
        </div>
        {hasAnyData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select value={view} onChange={(e) => setView(e.target.value)} style={{ width: 200 }} aria-label="Microsoft 365 view">
              {availableViews.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <Microsoft365ExportMenu currentView={currentView} datasets={datasets} onCompleteReport={handleCompleteReport} />
          </div>
        )}
      </div>

      {!hasAnyData ? (
        <EmptyState
          title="No Microsoft 365 data synced yet"
          hint="Connect a Microsoft 365 tenant and enable capabilities from Data Sources → Microsoft 365, then Sync Now. Each capability requires its own Graph permission to be admin-consented before it can return data."
        />
      ) : (
        <>
          {view === 'overview' && (
            <>
              <div className="kpi-row kpi-row-dense">
                <KpiCard color="blue" icon={<UsersIcon size={16} />} title="Microsoft 365 Users" value={users.length ? users.length : 'N/A'} sub={users.length ? `${enabledUsersCount.toLocaleString()} enabled` : undefined} onClick={users.length ? () => setView('users') : undefined} />
                <KpiCard color="purple" icon={<Laptop size={16} />} title="Devices" value={devices.length ? devices.length : 'N/A'} onClick={devices.length ? () => setView('devices') : undefined} />
                <KpiCard color="teal" icon={<ShieldCheck size={16} />} title="Compliant Devices" value={devices.length ? managedCompliant : 'N/A'} onClick={devices.length ? () => goToDevicesFiltered('compliance_state', { type: 'category', values: ['compliant'] }) : undefined} />
                <KpiCard color="red" icon={<ShieldAlert size={16} />} title="Non-Compliant Devices" value={devices.length ? managedNonCompliant : 'N/A'} onClick={devices.length && nonCompliantValues.length ? () => goToDevicesFiltered('compliance_state', { type: 'category', values: nonCompliantValues }) : undefined} />
                <KpiCard color="orange" icon={<AppWindow size={16} />} title="Applications" value={applicationGroups.length || 'N/A'} onClick={applicationGroups.length ? () => setView('applications') : undefined} />
                <KpiCard color="blue" icon={<Bot size={16} />} title="Copilot Users" value={copilotRecords.length || 'N/A'} onClick={copilotRecords.length ? () => setView('copilot') : undefined} />
                <KpiCard color="green" icon={<Bot size={16} />} title="Copilot License Active" value={copilotRecords.length ? copilotLicenseActive.length : 'N/A'} sub="Currently assigned, not usage-based" onClick={copilotRecords.length ? () => setView('copilot') : undefined} />
                <KpiCard color="red" icon={<KeyRound size={16} />} title="Assigned Licenses" value={licenses.length || 'N/A'} onClick={licenses.length ? () => setView('licenses') : undefined} />
                <KpiCard color="purple" icon={<Building2 size={16} />} title="Groups" value={groups.length || 'N/A'} onClick={groups.length ? () => setView('groups') : undefined} />
                <KpiCard color="teal" icon={<MessagesSquare size={16} />} title="Teams" value={groups.length ? totalTeams : 'N/A'} onClick={groups.length ? () => setView('groups') : undefined} />
                <KpiCard color="blue" icon={<LogIn size={16} />} title="Sign-ins" value={signIns.length || 'N/A'} sub={signIns.length ? `${uniqueSignInUsers.toLocaleString()} unique users` : undefined} onClick={signIns.length ? () => setView('signins') : undefined} />
                <KpiCard color="green" icon={<BadgeCheck size={16} />} title="Successful Sign-ins" value={signIns.length ? successfulSignIns : 'N/A'} />
                <KpiCard color="red" icon={<XCircle size={16} />} title="Failed Sign-ins" value={signIns.length ? failedSignInsList.length : 'N/A'} onClick={signIns.length ? () => setView('signins') : undefined} />
              </div>

              <div className="charts-2col">
                {domains.length > 0 && (
                  <ChartCard title="Users by Domain" subtitle="Top 15, highest first — hover a name for the full value">
                    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(domains.length, 15))}>
                      <BarChart data={domains.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="domain" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                        <Tooltip />
                        <Bar dataKey="totalUsers" fill="#0b5fff" name="Total Users" radius={[0, 4, 4, 0]} cursor="pointer"
                          onClick={(d) => d?.domain && goToUsersFiltered('domain', { type: 'category', values: [d.domain] })} />
                        <Bar dataKey="activeUsers" fill="#059669" name="Active Users" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                {departmentsChart.length > 0 && (
                  <ChartCard title="Users by Department" subtitle="Top 15, highest first — click a bar or hover a name for the full value">
                    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(departmentsChart.length, 15))}>
                      <BarChart data={departmentsChart.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="department" width={110} tick={<TruncatedAxisTick />} interval={0} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#7c3aed" name="Users" radius={[0, 4, 4, 0]} cursor="pointer"
                          onClick={(d) => d?.department && goToUsersFiltered('department', { type: 'category', values: [d.department] })} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                {devicesByOs.length > 0 && (
                  <ChartCard title="Devices by OS">
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
                      <PieChart>
                        <Pie data={devicesByOs} dataKey="value" nameKey="name" outerRadius={80} label>
                          {devicesByOs.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip /><Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                {licenseBreakdown.length > 0 && (
                  <ChartCard title="License Assignment" subtitle="Assigned licenses, not active-usage data — top 15, hover a name for the full SKU">
                    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(licenseBreakdown.length)}>
                      <BarChart data={licenseBreakdown} layout="vertical" margin={{ left: 8, right: 8 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="sku" width={130} tick={<TruncatedAxisTick maxChars={20} />} interval={0} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#0891b2" name="Assigned" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </div>
            </>
          )}

          {view === 'users' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Users</div>
              <FilterableDataTable
                columns={userColumns} data={users} storageKey="microsoft365-users" itemLabel="users"
                quickKeys={['domain', 'department', 'status_label', 'copilot_license_status', 'copilot_usage_status']} searchFields={['display_name', 'upn']}
                emptyTitle="No users match the selected filters" emptyHint="Try removing a filter to broaden the results."
                onFilteredChange={setFilteredUsersView} onFiltersChange={setUsersFilters}
                externalFilter={usersExternalFilter} externalFilterToken={usersFilterToken}
              />
            </div>
          )}

          {view === 'devices' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Devices</div>
              <FilterableDataTable
                columns={deviceColumns} data={devices} storageKey="microsoft365-devices" itemLabel="devices"
                quickKeys={['operating_system', 'compliance_state', 'management_state', 'owner_type']} searchFields={['device_name', 'user_principal_name']}
                emptyTitle="No devices match the selected filters" emptyHint="Try removing a filter to broaden the results."
                onFilteredChange={setFilteredDevicesView} onFiltersChange={setDevicesFilters}
                externalFilter={devicesExternalFilter} externalFilterToken={devicesFilterToken}
              />
            </div>
          )}

          {view === 'applications' && (
            <div className="card">
              <div className="card-title">Applications</div>
              <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>Grouped by application name — Microsoft Graph reports one entry per detected version. Click an application to see its version breakdown and installed devices.</div>
              <FilterableDataTable
                columns={appColumns} data={applicationGroups} storageKey="microsoft365-applications" itemLabel="applications"
                quickKeys={['platform', 'publisher']} searchFields={['display_name', 'publisher']}
                emptyTitle="No applications match the selected filters" emptyHint="Try removing a filter to broaden the results."
                onFilteredChange={setFilteredApplicationsView} onFiltersChange={setApplicationsFilters}
              />
            </div>
          )}

          {view === 'licenses' && (
            <MicrosoftLicenses
              users={users} copilotByEmail={copilotByEmail}
              onOpenMicrosoftUser={openUser} onOpenCopilotUser={openCopilotUser}
              onItemsChange={setLicenseAggregateItems} onFiltersChange={setLicensesFilters}
            />
          )}

          {view === 'departments' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Departments &amp; Domains</div>
              <div className="muted small" style={{ marginBottom: 10 }}>Click a department or domain to see its users.</div>
              {departmentsChart.length > 0 && (
                <ResponsiveContainer width="100%" height={horizontalBarChartHeight(Math.min(departmentsChart.length, 15))}>
                  <BarChart data={departmentsChart.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="department" width={110} tick={<TruncatedAxisTick />} interval={0} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#7c3aed" name="Users" radius={[0, 4, 4, 0]} cursor="pointer"
                      onClick={(d) => d?.department && goToUsersFiltered('department', { type: 'category', values: [d.department] })} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {domains.length > 0 && (
                <div className="table" style={{ marginTop: 16, border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>Domain</th><th>Total Users</th><th>Active Users</th></tr></thead>
                    <tbody>
                      {domains.map((d) => (
                        <tr key={d.domain} className="clickable-row" onClick={() => goToUsersFiltered('domain', { type: 'category', values: [d.domain] })}>
                          <td><span className="link-text">{d.domain}</span></td><td>{d.totalUsers.toLocaleString()}</td><td>{d.activeUsers.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view === 'groups' && (
            groups.length === 0 ? (
              <EmptyState title="No groups synced" hint="Enable Groups & Teams in Data Sources → Microsoft 365 and grant Group.Read.All." />
            ) : (
              <div className="card">
                <div className="card-title" style={{ marginBottom: 8 }}>Groups &amp; Teams</div>
                {groupsByType.length > 0 && (
                  <div className="charts-2col" style={{ marginBottom: 16 }}>
                    <ChartCard title="Groups by Type">
                      <ResponsiveContainer width="100%" height={CHART_HEIGHT_ROOMY}>
                        <PieChart>
                          <Pie data={groupsByType} dataKey="value" nameKey="name" outerRadius={80} label>
                            {groupsByType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip /><Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>
                )}
                <FilterableDataTable
                  columns={groupColumns} data={groupRows} storageKey="microsoft365-groups" itemLabel="groups"
                  quickKeys={['team_label', 'visibility']} searchFields={['display_name', 'mail']}
                  emptyTitle="No groups match the selected filters" emptyHint="Try removing a filter to broaden the results."
                  onFilteredChange={setFilteredGroupsView} onFiltersChange={setGroupsFilters}
                />
              </div>
            )
          )}

          {view === 'signins' && (
            <div className="card">
              <div className="card-title">Sign-ins / Activity</div>
              <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>Risk fields are shown only where Microsoft Graph returns them. Sign-in activity is informational only — never used to determine license assignment status.</div>
              <div className="charts-2col">
                {signInsByDay.length > 0 && (
                  <ChartCard title="Sign-ins by Day">
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT_COMPACT}>
                      <LineChart data={signInsByDay}>
                        <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Line type="monotone" dataKey="success" stroke="#059669" name="Successful" dot={false} />
                        <Line type="monotone" dataKey="failure" stroke="#dc2626" name="Failed" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
                {signInsByApp.length > 0 && (
                  <ChartCard title="Sign-ins by Application" subtitle="Top 10, highest first — hover a name for the full value">
                    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(signInsByApp.length)}>
                      <BarChart data={signInsByApp} layout="vertical" margin={{ left: 8, right: 8 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#7c3aed" name="Sign-ins" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </div>
              <div className="card-title" style={{ marginTop: 12, marginBottom: 8 }}>Failed Sign-ins</div>
              {failedSignInsList.length === 0 ? (
                <EmptyState title="No failed sign-ins in the synced period" />
              ) : (
                <FilterableDataTable
                  columns={failedSignInColumns} data={failedSignInsList} storageKey="microsoft365-failed-signins" itemLabel="sign-ins"
                  quickKeys={['app_display_name', 'risk_level']} searchFields={['user_principal_name', 'app_display_name']}
                  emptyTitle="No failed sign-ins match the selected filters" emptyHint="Try removing a filter to broaden the results."
                  onFilteredChange={setFilteredSignInsView} onFiltersChange={setSignInsFilters}
                />
              )}
            </div>
          )}

          {view === 'copilot' && (
            <div className="card">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BrandLogo product="Microsoft Copilot" size="sm" />
                Copilot
              </div>
              <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
                License Status reflects real Microsoft 365 Copilot license assignment — never derived from usage. Usage Status reflects recorded activity. An active license with no usage is a valid, expected combination.
              </div>
              <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
                <KpiCard color="blue" icon={<Bot size={16} />} title="Copilot Users" value={copilotRecords.length} />
                <KpiCard color="green" icon={<BadgeCheck size={16} />} title="License Active" value={copilotLicenseActive.length} />
                <KpiCard color="teal" icon={<Ban size={16} />} title="License Inactive" value={copilotRecords.length - copilotLicenseActive.length} sub="Not currently assigned" />
                <KpiCard color="purple" icon={<Bot size={16} />} title="Actively Used" value={copilotActive.length} sub="Usage status Active/Heavily Active" />
              </div>
              <FilterableDataTable
                columns={copilotColumns} data={copilotRecords} storageKey="microsoft365-copilot" itemLabel="Copilot users"
                quickKeys={['license_status', 'usage_status', 'plan', 'vbu']} searchFields={['name', 'email']}
                emptyTitle="No Copilot users match the selected filters" emptyHint="Try removing a filter to broaden the results."
                onFilteredChange={setFilteredCopilotView} onFiltersChange={setCopilotFilters}
              />
            </div>
          )}
        </>
      )}

      {currentDetail?.type === 'user' && (
        <UserDetailModal
          key={`user-${currentDetail.key}`} userMsId={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToDevice={openDevice} onNavigateToApplication={openApplication}
        />
      )}
      {currentDetail?.type === 'device' && (
        <DeviceDetailModal
          key={`device-${currentDetail.key}`} deviceMsId={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToUser={openUser} onNavigateToApplication={openApplication}
        />
      )}
      {currentDetail?.type === 'application' && (
        <ApplicationDetailModal
          key={`application-${currentDetail.key}`} applicationName={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToDevice={openDevice} onNavigateToUser={openUser}
        />
      )}
      {selectedCopilotUser && (
        <ProviderUserDetail
          userId={selectedCopilotUser.email} userName={selectedCopilotUser.name} provider="copilot"
          currency={currency} onClose={() => setSelectedCopilotUser(null)}
        />
      )}
    </div>
  )
}
