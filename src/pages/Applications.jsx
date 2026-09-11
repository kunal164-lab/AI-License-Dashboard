import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AppWindow, Layers, HardDrive, Users as UsersIcon, GitBranch, TrendingDown,
  Award, AlertTriangle, ArrowRight
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend, LabelList } from 'recharts'
import KpiCard from '../components/KpiCard'
import ChartCard from '../components/ChartCard'
import InsightCard from '../components/InsightCard'
import FilterableDataTable from '../components/FilterableDataTable'
import EmptyState from '../components/EmptyState'
import ExportMenu from '../components/ExportMenu'
import ApplicationDetailModal from '../components/microsoft/ApplicationDetailModal'
import BrandLogo from '../components/BrandLogo'
import UserDetailModal from '../components/microsoft/UserDetailModal'
import DeviceDetailModal from '../components/microsoft/DeviceDetailModal'
import { groupApplicationsByName } from '../utils/microsoftApplicationGroups'
import { TruncatedAxisTick, horizontalBarChartHeight } from '../components/charts/ChartAxisTick'
import { buildReportFilename } from '../reports/reportFilenames'
import { downloadBlob } from '../reports/downloadFile'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import toast from '../utils/toast'

const PIE_COLORS = ['#0b5fff', '#7c3aed', '#059669', '#f97316', '#0891b2', '#dc2626', '#64748b', '#d97706']

// Installed/detected != actively used - Microsoft Graph's Intune
// detectedApps API only reports presence on a device, never activity, so
// every KPI/label here says "Installation(s)"/"Detected", never "Usage".
const LOW_INSTALL_THRESHOLD = 2

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const APP_COLUMNS = [
  { key: 'display_name', name: 'Application Name', type: 'text', essential: true },
  { key: 'publisher', name: 'Publisher', type: 'category', essential: true },
  { key: 'device_count', name: 'Total Installations', type: 'number', essential: true },
  { key: 'version_count', name: 'Versions', type: 'number', essential: true },
  { key: 'platform', name: 'Operating System', type: 'category', essential: true },
  { key: 'last_synced_at', name: 'Last Detected', type: 'date' }
]

export default function Applications({ navigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msConnections, setMsConnections] = useState([])
  const [detailStack, setDetailStack] = useState([])
  const currentDetail = detailStack[detailStack.length - 1]

  function openApplication(name) { setDetailStack((s) => [...s, { type: 'application', key: name }]) }
  function openDevice(msId) { setDetailStack((s) => [...s, { type: 'device', key: msId }]) }
  function openUser(msId) { setDetailStack((s) => [...s, { type: 'user', key: msId }]) }
  function closeDetail() { setDetailStack([]) }
  function backDetail() { setDetailStack((s) => s.slice(0, -1)) }

  useEffect(() => {
    // Lightweight, purpose-built payload (applications/deviceApplications/
    // trimmed devices only) — NOT /api/microsoft/data, which also carries
    // the full Users & Directory/licenses/groups/sign-ins datasets this
    // page never reads (that endpoint is for Microsoft365.jsx).
    fetch('/api/microsoft/applications-overview').then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
    fetch('/api/connections?source=microsoft').then((r) => r.json()).then((j) => setMsConnections(j.connections || [])).catch(() => {})
  }, [])

  const rawApplications = data?.applications || []
  const deviceApplications = data?.deviceApplications || []
  const devices = data?.devices || []
  const applicationGroups = useMemo(() => groupApplicationsByName(rawApplications), [rawApplications])

  // Best-available (not necessarily complete - see ApplicationDetailModal's
  // own linkageCoverage note) unique device/user counts, from whichever
  // device<->application links have been synced/loaded so far.
  const deviceByMsId = useMemo(() => new Map(devices.map((d) => [d.ms_id, d])), [devices])
  const { uniqueDeviceCount, uniqueUserCount } = useMemo(() => {
    const deviceIds = new Set()
    const users = new Set()
    for (const link of deviceApplications) {
      deviceIds.add(link.device_ms_id)
      const d = deviceByMsId.get(link.device_ms_id)
      if (d?.user_principal_name) users.add(d.user_principal_name.toLowerCase())
    }
    return { uniqueDeviceCount: deviceIds.size, uniqueUserCount: users.size }
  }, [deviceApplications, deviceByMsId])

  const [filteredView, setFilteredView] = useState(null)
  const appsForKpis = filteredView ?? applicationGroups

  const totalInstallations = useMemo(() => appsForKpis.reduce((s, a) => s + (a.device_count || 0), 0), [appsForKpis])
  const multiVersionApps = useMemo(() => appsForKpis.filter((a) => a.version_count > 1), [appsForKpis])
  const lowInstallApps = useMemo(() => [...appsForKpis].filter((a) => (a.device_count || 0) <= LOW_INSTALL_THRESHOLD).sort((a, b) => (a.device_count || 0) - (b.device_count || 0) || a.display_name.localeCompare(b.display_name)), [appsForKpis])
  const missingDataApps = useMemo(() => appsForKpis.filter((a) => !a.device_count), [appsForKpis])
  const missingPublisherApps = useMemo(() => appsForKpis.filter((a) => !a.publisher), [appsForKpis])
  const mostInstalled = appsForKpis[0] || null
  const mostVersions = useMemo(() => (appsForKpis.length ? appsForKpis.reduce((max, a) => (a.version_count > (max?.version_count || 0) ? a : max), null) : null), [appsForKpis])

  const topApplicationsChart = useMemo(() => appsForKpis.slice(0, 10).map((a) => ({ name: a.display_name, value: a.device_count || 0 })), [appsForKpis])

  const osDistribution = useMemo(() => {
    const map = new Map()
    for (const a of appsForKpis) {
      const os = a.platform || 'Unknown'
      map.set(os, (map.get(os) || 0) + (a.device_count || 0))
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0)
  }, [appsForKpis])

  const publisherDistribution = useMemo(() => {
    const map = new Map()
    for (const a of appsForKpis) {
      const p = a.publisher || 'Unknown'
      map.set(p, (map.get(p) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [appsForKpis])

  const installBuckets = useMemo(() => {
    const buckets = [
      { label: '1 device', min: 1, max: 1, count: 0 },
      { label: '2-5 devices', min: 2, max: 5, count: 0 },
      { label: '6-10 devices', min: 6, max: 10, count: 0 },
      { label: '11-25 devices', min: 11, max: 25, count: 0 },
      { label: '26-50 devices', min: 26, max: 50, count: 0 },
      { label: '50+ devices', min: 51, max: Infinity, count: 0 }
    ]
    for (const a of appsForKpis) {
      const c = a.device_count || 0
      if (c < 1) continue
      const b = buckets.find((b) => c >= b.min && c <= b.max)
      if (b) b.count++
    }
    return buckets.filter((b) => b.count > 0).map((b) => ({ name: b.label, value: b.count }))
  }, [appsForKpis])

  async function handleExport(format) {
    if (!applicationGroups.length) { toast.info('No applications to export.'); return }
    const rows = (filteredView ?? applicationGroups).map((a) => ({
      'Application Name': a.display_name, Publisher: a.publisher || 'N/A', 'Total Installations': a.device_count,
      Versions: a.version_count, 'Operating System': a.platform || 'N/A', 'Last Detected': fmtDate(a.last_synced_at)
    }))
    const scope = filteredView ? 'filtered' : 'complete'
    try {
      if (format === 'csv') {
        const keys = Object.keys(rows[0])
        const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"'
        const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
        const filename = buildReportFilename({ prefix: 'Internal_IT_Applications', scope, ext: 'csv' })
        downloadBlob(new Blob([csv], { type: 'text/csv' }), filename)
        toast.success(`Downloaded ${filename}`)
      } else if (format === 'xlsx') {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Applications')
        const filename = buildReportFilename({ prefix: 'Internal_IT_Applications', scope, ext: 'xlsx' })
        downloadBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), filename)
        toast.success(`Downloaded ${filename}`)
      } else {
        toast.info('Open a specific application and use its own Export button for a PDF report.')
      }
    } catch (e) {
      toast.error('Export failed: ' + (e.message || 'unknown error'))
    }
  }

  const applicationsCapability = msConnections[0]?.capabilities?.includes?.('applications')
  const hasMsConnection = msConnections.length > 0

  if (loading) return <div className="muted">Loading application data...</div>

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h3 style={{ margin: 0 }}>Application</h3>
          <div className="muted small" style={{ marginTop: 4, maxWidth: 640 }}>
            Application inventory and installation insights across Microsoft-managed devices, from Microsoft Graph / Intune detected applications.
          </div>
        </div>
        {applicationGroups.length > 0 && <ExportMenu label="Export Applications" onExport={handleExport} />}
      </div>

      {applicationGroups.length === 0 ? (
        <EmptyState
          title="No application data available"
          hint={!hasMsConnection
            ? 'Connect a Microsoft 365 source first (Data Sources → Microsoft 365).'
            : applicationsCapability === false
              ? 'Installed Applications data is not enabled for this Microsoft 365 connection. Enable it in Data Sources → Microsoft 365 → Configure, then Sync Now.'
              : 'Enable Installed Applications in Microsoft 365 Data Sources and run a refresh.'}
        />
      ) : (
        <>
          <div className="kpi-row">
            <KpiCard color="blue" icon={<AppWindow size={17} />} title="Total Applications" value={applicationGroups.length} />
            <KpiCard color="purple" icon={<Layers size={17} />} title="Total Installations" value={totalInstallations.toLocaleString()} />
            <KpiCard color="teal" icon={<HardDrive size={17} />} title="Unique Devices" value={uniqueDeviceCount || 'N/A'} sub="Based on linked data so far" />
            <KpiCard color="green" icon={<UsersIcon size={17} />} title="Unique Users" value={uniqueUserCount || 'N/A'} sub="Based on linked data so far" />
            <KpiCard color="orange" icon={<GitBranch size={17} />} title="Multiple Versions" value={multiVersionApps.length} />
            <KpiCard color="red" icon={<TrendingDown size={17} />} title="Low-Installation Apps" value={lowInstallApps.length} sub={`${LOW_INSTALL_THRESHOLD} or fewer devices`} />
            <KpiCard color="teal" icon={<Award size={17} />} title="Most Installed" value={mostInstalled?.display_name || 'N/A'} sub={mostInstalled ? `${mostInstalled.device_count.toLocaleString()} installs` : null} onClick={mostInstalled ? () => openApplication(mostInstalled.display_name) : undefined} />
            <KpiCard color="red" icon={<AlertTriangle size={17} />} title="Missing Installation Data" value={missingDataApps.length} />
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 4 }}>Application Health</div>
            <div className="insight-row">
              {mostInstalled && <InsightCard tone="good" title={`${mostInstalled.display_name} is the most installed application`} sub={`${mostInstalled.device_count.toLocaleString()} detected installations`} />}
              {mostVersions && mostVersions.version_count > 1 && <InsightCard tone="info" title={`${mostVersions.display_name} has the highest version diversity`} sub={`${mostVersions.version_count} distinct versions detected — installation/detection data only, no "latest version" reference is available from the current source.`} />}
              {lowInstallApps.length > 0 && <InsightCard tone="warn" title={`${lowInstallApps.length} application${lowInstallApps.length === 1 ? '' : 's'} installed on ${LOW_INSTALL_THRESHOLD} or fewer devices`} sub="Based on detected installations; application usage activity is not available from the current source." />}
              {missingPublisherApps.length > 0 && <InsightCard tone="warn" title={`${missingPublisherApps.length} application${missingPublisherApps.length === 1 ? '' : 's'} missing publisher information`} sub="Not reported by Microsoft Graph for these apps" />}
            </div>
          </div>

          <div className="charts">
            <ChartCard title="Top Applications" subtitle="By detected installation count">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topApplicationsChart} layout="vertical" margin={{ left: 8, right: 28 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={<TruncatedAxisTick />} interval={0} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0b5fff" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => d?.name && openApplication(d.name)}>
                    <LabelList dataKey="value" position="right" fontSize={10} fill="var(--muted-fg, #64748b)" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Applications by Operating System">
              {osDistribution.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={osDistribution} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>
                      {osDistribution.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Installation Distribution" subtitle="Number of applications by device count">
              {installBuckets.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={installBuckets}>
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis width={32} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Top Publishers" subtitle="By number of applications — hover a name for the full value">
              {publisherDistribution.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={horizontalBarChartHeight(publisherDistribution.length, { min: 220 })}>
                  <BarChart data={publisherDistribution} layout="vertical" margin={{ left: 8, right: 28 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={<TruncatedAxisTick />} interval={0} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#059669" radius={[0, 4, 4, 0]} barSize={18}>
                      <LabelList dataKey="value" position="right" fontSize={10} fill="var(--muted-fg, #64748b)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="card">
            <div className="section-header" style={{ marginBottom: 10 }}>
              <div className="section-header-text">
                <div className="card-title">Application Inventory</div>
                <div className="muted small" style={{ marginTop: 4 }}>Click an application to see versions, devices and users.</div>
              </div>
            </div>
            <FilterableDataTable
              columns={APP_COLUMNS.map((c) => (c.key === 'display_name'
                ? {
                    ...c,
                    render: (r) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <BrandLogo publisher={r.publisher} size="xs" />
                        <span className="link-text" onClick={() => openApplication(r.display_name)}>{r.display_name}</span>
                      </span>
                    )
                  }
                : c.key === 'last_synced_at' ? { ...c, render: (r) => fmtDate(r.last_synced_at) }
                : c))}
              data={applicationGroups}
              quickKeys={['publisher', 'platform']}
              storageKey="applications-inventory"
              itemLabel="applications"
              searchFields={['display_name', 'publisher']}
              onFilteredChange={setFilteredView}
              emptyTitle="No applications match the selected filters"
              emptyHint="Try removing a filter to broaden the results."
            />
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>Low-Installation Applications</div>
            <div className="muted small" style={{ marginBottom: 10 }}>
              Based on detected installations; application usage activity is not available from the current source.
            </div>
            {lowInstallApps.length === 0 ? (
              <EmptyState title="Nothing low-installation" hint={`Every application is installed on more than ${LOW_INSTALL_THRESHOLD} devices.`} />
            ) : (
              <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Application</th><th>Publisher</th><th>Installations</th><th>Versions</th></tr></thead>
                  <tbody>
                    {lowInstallApps.slice(0, 25).map((a) => (
                      <tr key={a.display_name} className="clickable-row" onClick={() => openApplication(a.display_name)}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <BrandLogo publisher={a.publisher} size="xs" />
                            <span className="link-text">{a.display_name}</span>
                          </span>
                        </td>
                        <td>{a.publisher || 'N/A'}</td>
                        <td>{a.device_count}</td>
                        <td>{a.version_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {currentDetail?.type === 'application' && (
        <ApplicationDetailModal
          key={`application-${currentDetail.key}`} applicationName={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToDevice={openDevice} onNavigateToUser={openUser}
        />
      )}
      {currentDetail?.type === 'device' && (
        <DeviceDetailModal
          key={`device-${currentDetail.key}`} deviceMsId={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToUser={openUser} onNavigateToApplication={openApplication}
        />
      )}
      {currentDetail?.type === 'user' && (
        <UserDetailModal
          key={`user-${currentDetail.key}`} userMsId={currentDetail.key}
          onClose={closeDetail} onBack={detailStack.length > 1 ? backDetail : null}
          onNavigateToDevice={openDevice} onNavigateToApplication={openApplication}
        />
      )}
    </div>
  )
}
