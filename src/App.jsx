import React, { useEffect, useState, useMemo, useRef } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import ToastHost from './components/ToastHost'
import ReportModal from './components/ReportModal'
import Overview from './pages/Overview'
import Users from './pages/Users'
import Products from './pages/Products'
import Optimization from './pages/Optimization'
import Cost from './pages/Cost'
import Applications from './pages/Applications'
import DataSources from './pages/DataSources'
import DataSourcesGithub from './pages/DataSourcesGithub'
import DataSourcesKiro from './pages/DataSourcesKiro'
import DataSourcesMicrosoft from './pages/DataSourcesMicrosoft'
import DataSourcesFreshservice from './pages/DataSourcesFreshservice'
import DataSourcesFileImport from './pages/DataSourcesFileImport'
import Microsoft365 from './pages/Microsoft365'
import Freshservice from './pages/Freshservice'
import Kiro from './pages/Kiro'
import DataSourcesClaude from './pages/DataSourcesClaude'
import Claude from './pages/Claude'
import SignIn from './pages/SignIn'
import InitialAdminSetup from './pages/InitialAdminSetup'
import ChooseDashboardView from './pages/ChooseDashboardView'
import AccessDenied from './pages/AccessDenied'
import AdminAccess from './pages/AdminAccess'
import AdminDashboardViews from './pages/AdminDashboardViews'
import { pageKeyForPath } from './utils/pageAccess'
import { calculateSummary } from './utils/calculations'
import { activityStatusFor } from './utils/activityScore'
import { applyFilters, describeFilters, passesFilters } from './utils/tableFilters'
import { COLUMN_BY_KEY } from './utils/columnRegistry'
import { buildCanonicalUsers } from './utils/userModel'
import { mergeSeatGroupRecords } from './utils/productModel'
import { licenseStatusLabel } from './utils/licenseStatus'
import { buildReportModel } from './reports/reportBuilder'
import { applyDashboardTheme } from './utils/theme'
import toast from './utils/toast'

const PAGES = [
  { label: 'Overview', path: '/' },
  { label: 'Users', path: '/users' },
  { label: 'Products', path: '/products' },
  { label: 'Application', path: '/applications' },
  { label: 'Cost', path: '/cost' },
  { label: 'Optimization', path: '/optimization' },
  // Same route/page-key ('admin-access') the old sidebar-footer button
  // used — just exposed as a normal nav item now. Visibility is already
  // governed by the same allowedPages filter every other entry here goes
  // through (see visiblePages below), so an unauthorized user never sees
  // this item and never gets past AccessDenied by navigating to it
  // directly either — nothing new to authorize.
  { label: 'Administration', path: '/admin/access' },
  { label: 'Data Sources', path: '/data-sources' }
]

// Dedicated per-product pages (like Microsoft 365) live under the Products
// dropdown rather than their own sidebar entry, so the sidebar stays
// highlighted on "Products" while viewing one.
const PRODUCT_SUBPAGE_PATHS = ['/microsoft-365', '/freshservice', '/kiro', '/claude']

// Legacy browser-only storage keys from before the centralized backend
// existed. No longer written to, but still read once on startup so a
// browser with old local CSV imports can offer to migrate them server-side
// instead of silently losing them.
const LEGACY_DATA_KEY = 'dashboard_dataByConnection'
const LEGACY_CSV_KEY = 'dashboard_csvSources'

export default function App() {
  // The database (via the backend API) is the single source of truth for
  // all dashboard data. dataByConnection/connections are just an in-memory
  // reflection of what the server returned — nothing here is persisted to
  // localStorage. Every browser that loads this app sees the same data.
  const [dataByConnection, setDataByConnection] = useState({})
  // Microsoft 365's authoritative org/identity fields (job_title/department/
  // vbu/manager/company/office/domain/account_status), keyed by normalized
  // email — see src/utils/userModel.js#buildMicrosoftDirectory. Kept as the
  // raw {email: {...}} object from the server; converted to a Map where
  // consumed (buildCanonicalUsers expects a Map).
  const [microsoftDirectory, setMicrosoftDirectory] = useState({})
  // The application's centrally-configured display currency (Cost page,
  // GET /api/settings/currency) — never localStorage. Defaults to USD
  // until the first dashboard load resolves it.
  const [currency, setCurrency] = useState('USD')
  // Real historical/current monthly cost series (server/services/
  // costAnalytics.js#costTrend) — server-computed and already scoped to
  // this session's effective VBU access, exactly like every other
  // /api/dashboard field. Never recomputed or re-scoped client-side.
  const [costTrend, setCostTrend] = useState(null)
  // All connections (API accounts AND manual CSV/XLSX imports) as returned
  // by the backend. kind: 'api' | 'csv'.
  const [connections, setConnections] = useState([])
  // The auto-refresh effect below mounts once (empty deps, so it survives
  // background/visibility handling without re-subscribing) and calls
  // refreshAllSources from that single mount-time closure. Without this ref,
  // refreshAllSources would read `connections` as it was frozen at that
  // first render (an empty array, since the dashboard hadn't loaded yet) on
  // every single scheduled tick thereafter — which silently short-circuited
  // the "any API sources connected?" check and skipped the real refresh
  // call every time. This was the actual reason the 30-minute auto-refresh
  // never advanced the "last successful refresh" timestamp at all.
  const connectionsRef = useRef(connections)
  useEffect(() => { connectionsRef.current = connections }, [connections])
  // Same stale-closure problem, same fix, for the auto-refresh heartbeat
  // effect below (also mount-once, empty deps): without this ref it would
  // keep calling the protected /api/connections endpoint before
  // authentication is established (using the `isAuthorized` value frozen at
  // mount, always false) and never start working after a later local/
  // Microsoft sign-in (Part 6/9 of the local-admin auth spec).
  const isAuthorizedRef = useRef(false)
  // 'loading' | 'ready' | 'error' — gates the whole app. On error we show a
  // clear message and never fall back to fake/sample/cached data.
  const [dashboardState, setDashboardState] = useState('loading')
  const [dashboardErrorMsg, setDashboardErrorMsg] = useState('')
  // Legacy local-only CSV data detected on this browser, offered for
  // one-time migration into the shared backend.
  const [legacyMigration, setLegacyMigration] = useState(null)
  const [migrating, setMigrating] = useState(false)
  // Which existing CSV source (if any) a file-import page should replace.
  const [csvEditTarget, setCsvEditTarget] = useState(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  // Synchronous in-flight guard — refreshingAll (state) updates on the next
  // render, which isn't fast enough to stop two near-simultaneous callers
  // (the 60s heartbeat and a visibilitychange catch-up firing back to back,
  // or a manual click landing mid-scheduled-run) from both starting a
  // refresh-all call.
  const refreshInFlightRef = useRef(false)
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname || '/')
  // ---- GLOBAL FILTER STATE ----
  // Every filter entry point in the app — the Users page's quick bar, its
  // per-column Excel-style popovers, search, a KPI tile click, a chart
  // segment click — writes into this ONE object, using the same shapes
  // defined in utils/tableFilters.js. There is exactly one filtering engine.
  const [globalFilters, setGlobalFilters] = useState({})
  const [reportModal, setReportModal] = useState(null) // { title, buildModel, filePrefix } | null

  useEffect(() => {
    const onPop = () => setCurrentPath(window.location.pathname || '/')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(path) {
    if (path === window.location.pathname) return
    window.history.pushState({}, '', path)
    setCurrentPath(path)
  }

  // ---- Centralized data loading ----
  async function fetchDashboardData() {
    const r = await fetch('/api/dashboard')
    if (!r.ok) throw new Error(`Server returned ${r.status}`)
    const j = await r.json()
    setConnections(j.connections || [])
    setDataByConnection(j.dataByConnection || {})
    setMicrosoftDirectory(j.microsoftDirectory || {})
    if (j.currency) setCurrency(j.currency)
    setCostTrend(j.costTrend || null)
    return j
  }

  async function loadDashboard() {
    setDashboardState('loading')
    try {
      await fetchDashboardData()
      setDashboardState('ready')
      checkLegacyMigration()
    } catch (e) {
      setDashboardErrorMsg(e.message || 'Unable to reach the server.')
      setDashboardState('error')
    }
  }

  // Authentication (who is this person — Microsoft Entra ID SSO) and
  // authorization (what can they access — Microsoft security group ->
  // application role -> allowed pages/write access, server/auth/*) are
  // resolved ONCE here, before this app fetches or renders anything else.
  // `auth` states: undefined = still checking; {configured:false} = SSO not
  // set up on the server; {authenticated:false} = not signed in;
  // {authenticated:true, allowedPages:[...], canWrite} = the ONLY shape
  // that unlocks the rest of the app (Part 17: default-deny — no
  // configured access at all renders Access Denied, never the dashboard).
  const [auth, setAuth] = useState(undefined)
  // Checked BEFORE anything else (Part 2/13 of the local-admin auth spec):
  // a fresh install with no local administrator account at all must show a
  // dedicated "Initial Administrator Setup" screen, never just dead-end at
  // the normal sign-in screen with no way forward. `undefined` = still
  // checking; {bootstrapRequired:true} is the ONLY state that renders
  // InitialAdminSetup — every other value (including right after setup
  // completes but before this fetch re-runs) falls through to the normal
  // auth flow below.
  const [setupStatus, setSetupStatus] = useState(undefined)
  function refreshSetupStatus() {
    return fetch('/api/auth/local/status').then((r) => r.json())
      .then((j) => setSetupStatus({ bootstrapRequired: !j.exists }))
      .catch(() => setSetupStatus({ bootstrapRequired: false }))
  }
  useEffect(() => { refreshSetupStatus() }, [])

  function refreshAuth() {
    return fetch('/api/auth/me').then((r) => r.json()).then(setAuth).catch(() => setAuth({ configured: false, authenticated: false }))
  }
  useEffect(() => {
    if (setupStatus === undefined || setupStatus.bootstrapRequired) return
    refreshAuth()
  }, [setupStatus])
  const isAuthorized = !!(auth?.authenticated && (auth.allowedPages?.length || auth.canWrite))
  useEffect(() => { isAuthorizedRef.current = isAuthorized }, [isAuthorized])

  // VBU-aware Dashboard View: apply the resolved view's theme as soon as it
  // is known (before the dashboard itself finishes loading — Part 14 of the
  // spec: "avoid showing the wrong VBU branding for a noticeable period").
  // An empty/missing theme object is a no-op (every token falls back to the
  // base :root default already declared in src/styles.css).
  useEffect(() => { applyDashboardTheme(auth?.dashboardView?.theme) }, [auth?.dashboardView])

  useEffect(() => { if (isAuthorized) loadDashboard() }, [isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Local-admin-only "Switch Dashboard View" (VBU-aware-views spec,
  // section 16) — clears the session's selection so the ChooseDashboardView
  // gate above re-appears on the next render, without signing out. Only
  // ever wired up for a local-admin session (App.jsx passes this to
  // Header/UserProfileMenu unconditionally, but UserProfileMenu itself only
  // renders the menu item when authenticationProvider === 'local').
  async function switchDashboardView() {
    await fetch('/api/auth/local/dashboard-view/clear', { method: 'POST' })
    await refreshAuth()
  }

  async function signOut() {
    const r = await fetch('/auth/microsoft/logout', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    window.location.href = j.logoutUrl || '/'
  }

  function checkLegacyMigration() {
    try {
      const legacyCsv = JSON.parse(localStorage.getItem(LEGACY_CSV_KEY) || '{}')
      const legacyData = JSON.parse(localStorage.getItem(LEGACY_DATA_KEY) || '{}')
      if (Object.keys(legacyCsv).length > 0) {
        setLegacyMigration({ csvSources: legacyCsv, dataByConnection: legacyData })
      }
    } catch (e) {}
  }

  async function migrateLocalData() {
    if (!legacyMigration) return
    setMigrating(true)
    try {
      const entries = Object.values(legacyMigration.csvSources)
      let migrated = 0
      for (const entry of entries) {
        const rows = legacyMigration.dataByConnection[entry.id] || []
        const res = await fetch('/api/connections/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: entry.source, sourceType: entry.sourceType, label: entry.label, rows })
        })
        if (res.ok) migrated++
      }
      localStorage.removeItem(LEGACY_CSV_KEY)
      localStorage.removeItem(LEGACY_DATA_KEY)
      setLegacyMigration(null)
      await fetchDashboardData()
      toast.success(`Migrated ${migrated} of ${entries.length} local source(s) to the server.`)
    } catch (e) {
      toast.error('Migration failed: ' + (e.message || 'unknown error'))
    } finally {
      setMigrating(false)
    }
  }

  function dismissMigration() {
    setLegacyMigration(null)
  }

  // Refresh the connection list (for header/sidebar stats) whenever the user
  // navigates — catches connect/disconnect/sync actions taken on any of the
  // provider pages without needing a shared store. /api/connections is a
  // protected route (requirePage('data-sources')); calling it before
  // authentication is established is expected to 401, so this must never
  // fire until isAuthorized is true (Part 6/9 of the local-admin auth spec
  // — fix the frontend's call timing, never make the API itself public).
  function refreshConnectionsList() {
    if (!isAuthorized) return Promise.resolve([])
    return fetch('/api/connections').then((r) => r.json()).then((j) => {
      setConnections(j.connections || [])
      return j.connections || []
    }).catch(() => [])
  }
  useEffect(() => { if (isAuthorized) refreshConnectionsList() }, [currentPath, isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps

  const apiConnections = useMemo(() => connections.filter((c) => c.kind === 'api'), [connections])
  // Reshaped for the pages that expect the pre-existing local csvSources
  // shape (keyed by id) — those pages don't need to change.
  const csvSources = useMemo(() => Object.fromEntries(
    connections.filter((c) => c.kind === 'csv').map((c) => [c.id, {
      id: c.id,
      source: c.source,
      label: c.label,
      sourceType: c.sourceType || 'csv',
      status: c.status,
      lastSync: c.lastSync,
      lastAttempt: c.lastAttempt,
      recordCount: c.stats?.records ?? 0,
      errorMessage: c.lastError
    }])
  ), [connections])

  // One row per (person, product, source) — i.e. every real license/usage
  // assignment, un-collapsed. This used to be run through mergeByEmail,
  // which flattened every record for the same email into ONE row and, in
  // doing so, silently discarded every product but the first — the root
  // cause of e.g. a user with both a Claude license and a Microsoft 365
  // Copilot license only ever showing up under one of the two. Every
  // consumer below (Overview/Products/Optimization/Reports) already treats
  // "one row" as "one license assignment," not "one person," so this is a
  // correctness fix for them too, not just a shape change.
  // Microsoft 365's authoritative org/identity fields, as a Map (the shape
  // buildCanonicalUsers/buildCanonicalUsersForProvider expect) — rebuilt
  // only when the server sends a new directory snapshot.
  const microsoftDirectoryMap = useMemo(() => new Map(Object.entries(microsoftDirectory)), [microsoftDirectory])

  const allRecords = useMemo(() => {
    const flat = Object.values(dataByConnection).flat()
    // Product/license identity resolution (src/utils/productModel.js) —
    // collapses sibling records that are really ONE seat reported across
    // multiple sources/CSVs (e.g. Claude Chat + Claude Code) into a single
    // canonical product record, BEFORE anything downstream counts
    // products/licenses or groups by product name. Kept separate from
    // costEngine.js's shared-seat cost dedup (server-side, already applied
    // to every record here) — that only stops double-BILLING; this stops
    // double-COUNTING the same seat as two products/licenses.
    const merged = mergeSeatGroupRecords(flat)
    // Purely additive presentation tags — does not touch normalization.
    // usage_status: existing activity-based classification (unchanged).
    // license_status: normalized here (not derived from activity — see
    // src/utils/licenseStatus.js) into the one clean Active/Inactive/
    // Unknown vocabulary every provider's raw value (assigned/unassigned,
    // or a Freshservice CSV's own Active/Inactive) collapses into, so every
    // page reads one consistent field instead of a mixed vocabulary. This
    // runs AFTER cost resolution (server-side, already applied to these
    // records) — which already read the raw value — so it only affects
    // display/filtering, never cost.
    //
    // job_title/department/vbu/manager/company/office/domain/account_status
    // are likewise overwritten here (not backfilled/merged) with Microsoft
    // 365's directory value for this email — the single authoritative
    // source for these eight fields everywhere in the app (Overview's
    // department charts, Optimization's grouping, calculations.js's cost-
    // by-department/VBU, every filter). Whatever a source's own normalizer
    // originally put in these fields is intentionally discarded here; the
    // real raw values are never destroyed, they still live untouched in
    // that source's own table/dedicated page (e.g. Freshservice.jsx reads
    // freshservice_agents directly, not this array).
    return merged.map((r) => {
      const email = r.email ? String(r.email).trim().toLowerCase() : null
      const ms = email ? microsoftDirectoryMap.get(email) : null
      return {
        ...r,
        usage_status: activityStatusFor(r),
        license_status: licenseStatusLabel(r),
        // Microsoft-authoritative, no per-record fallback (Part 1/3 of the
        // canonical-identity spec this implements) — a record whose email
        // isn't in the directory at all gets null, never its own source's
        // name/N/A-vs-Unknown guess; every provider's own normalizer is
        // responsible for never emitting such a record in the first place
        // (src/utils/canonicalIdentity.js's buildValidEmailSet is the
        // shared gate every provider should use).
        name: ms?.name ?? null,
        job_title: ms?.job_title ?? null,
        department: ms?.department ?? null,
        vbu: ms?.vbu ?? null,
        manager: ms?.manager ?? null,
        company: ms?.company ?? null,
        office: ms?.office ?? null,
        domain: ms?.domain ?? null,
        account_status: ms?.account_status ?? null
      }
    })
  }, [dataByConnection, microsoftDirectoryMap])

  // Person-level view: one canonical user per real person, with an
  // unlimited `products` array. THE single shared Dashboard User
  // Population, consumed by every page that shows a user count or user
  // table (Users, Overview, Header) — see utils/userModel.js for why this
  // is deliberately NOT the same deduplication mergeByEmail used to do.
  // A "Total User" = a canonical Microsoft user with at least one tracked
  // product/license relationship. Microsoft 365 remains the authoritative
  // SSP *directory* (microsoftDirectoryMap, used above for identity
  // fields), but a real employee with zero connected products/licenses is
  // not part of the dashboard population — includeUnassignedMicrosoftUsers
  // stays opt-in (default false) precisely so this call site is
  // record-driven, not directory-seeded.
  const canonicalUsers = useMemo(() => buildCanonicalUsers(allRecords, microsoftDirectoryMap), [allRecords, microsoftDirectoryMap])
  const filteredCanonicalUsers = useMemo(
    () => canonicalUsers.filter((u) => passesFilters(u, globalFilters)),
    [canonicalUsers, globalFilters]
  )

  // ALL DATA -> GLOBAL FILTER STATE -> FILTERED DATASET -> every page + reports.
  const records = useMemo(() => applyFilters(allRecords, globalFilters), [allRecords, globalFilters])
  // calculateSummary itself is untouched: filtering already happened above,
  // so it always receives an empty filter object and just aggregates.
  const summary = useMemo(() => calculateSummary(records, {}), [records])

  // ---- Global filter helpers, shared by every page ----
  function setFilter(key, filterObj) {
    setGlobalFilters((prev) => ({ ...prev, [key]: filterObj }))
  }
  function setFiltersPatch(patch) {
    setGlobalFilters((prev) => ({ ...prev, ...patch }))
  }
  function clearFilter(key) {
    setGlobalFilters((prev) => { const next = { ...prev }; delete next[key]; return next })
  }
  function clearAllFilters() {
    setGlobalFilters({})
  }

  const connectedCsvCount = Object.values(csvSources).filter((c) => c.status === 'connected').length
  const connectedApiCount = apiConnections.filter((c) => c.status === 'connected').length
  const connectedCount = connectedCsvCount + connectedApiCount
  const lastUpdated = [
    ...Object.values(csvSources).map((c) => c.lastSync),
    ...apiConnections.map((c) => c.lastSync)
  ].filter(Boolean).sort().slice(-1)[0] || null
  // API-only, distinct from lastUpdated above: this is specifically what the
  // "auto refresh every 30 minutes" claim refers to (manual CSV/XLSX imports
  // have no live endpoint to auto-refresh, so they must never be folded into
  // this figure — that would let a manual import masquerade as an automatic
  // one). null means no automatically-synced source has ever completed a
  // successful refresh.
  const lastAutoRefreshAt = apiConnections.map((c) => c.lastSync).filter(Boolean).sort().slice(-1)[0] || null

  // ---- CSV/XLSX sources (manual "connections") — rows are already
  // normalized by the file-import page before reaching here; the backend
  // stores them and owns id generation for new sources. ----
  async function applyCsvRows({ id, provider, sourceType, rows, label }) {
    try {
      const res = await fetch('/api/connections/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, provider, sourceType, label, rows })
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.connection) throw new Error(j.error || 'Import failed')
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === j.connection.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = j.connection; return next }
        return [...prev, j.connection]
      })
      setDataByConnection((prev) => ({ ...prev, [j.connection.id]: rows }))
      setCsvEditTarget(null)
      toast.success(`${provider}: imported ${rows.length.toLocaleString()} records.`)
    } catch (e) {
      toast.error(`${provider}: import failed — ${e.message || 'unknown error'}`)
    }
  }

  async function removeCsvSource(id) {
    try {
      await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    } catch (e) {}
    setConnections((prev) => prev.filter((c) => c.id !== id))
    setDataByConnection((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  function startAddCsvSource() {
    setCsvEditTarget(null)
  }

  function startEditCsvSource(id) {
    setCsvEditTarget(id)
  }

  // ---- API connections (GitHub / Kiro / Microsoft) ----
  // The backend already normalizes records (via the same normalizer files
  // this app used to run client-side) before returning them from a sync, so
  // this just stores what the server sent — no re-normalization here.
  function applyConnectionRecords(id, source, records) {
    setDataByConnection((prev) => ({ ...prev, [id]: records }))
  }

  function removeConnectionData(id) {
    // The calling page already issued the DELETE request; this just drops
    // the connection from local state.
    setConnections((prev) => prev.filter((c) => c.id !== id))
    setDataByConnection((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  // Shared by the Header button, the Sidebar footer button, and the Data
  // Sources page — one implementation, three entry points. The backend owns
  // the refresh loop and only touches API sources (per spec: CSV sources
  // keep their last imported data/timestamp and require a manual re-upload
  // to change); on completion we refetch the full dashboard so every synced
  // source's records/timestamps/stats are up to date.
  // scheduled:true is used ONLY by the automatic background timer below —
  // it tells the backend to skip sources with their own configured refresh
  // schedule (currently just Freshservice) if they're not due yet, instead
  // of refreshing every source unconditionally like a manual button click.
  async function refreshAllSources({ scheduled = false } = {}) {
    // Guards against the manual button, the heartbeat, and a visibility
    // catch-up all landing at once — only one refresh-all call is ever in
    // flight. A scheduled caller that loses the race just skips this tick
    // silently; the next due-check (heartbeat or visibility) will retry.
    if (refreshInFlightRef.current) return []
    refreshInFlightRef.current = true
    setRefreshingAll(true)
    try {
      const currentApi = connectionsRef.current.filter((c) => c.kind === 'api')
      if (!currentApi.length) {
        if (!scheduled) toast.info('No API sources connected to refresh.')
        return []
      }
      const res = await fetch(`/api/sources/refresh-all${scheduled ? '?scheduled=true' : ''}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Refresh failed')
      const results = j.results || []
      // fetchDashboardData() re-pulls connections (with their real,
      // server-authoritative lastSync) alongside the dashboard data itself —
      // this is what the sidebar's "last successful refresh" timestamp comes
      // from. A source that errored keeps its previous lastSync untouched
      // server-side (server/index.js's runSync/runMicrosoftSync only stamp
      // lastSync on the success path), so a failed refresh can never make
      // the displayed timestamp jump forward.
      await fetchDashboardData()
      const skipped = results.filter((r) => r.skipped)
      const attempted = results.filter((r) => !r.skipped)
      const okCount = attempted.filter((r) => r.ok).length
      const failCount = attempted.length - okCount
      // A quiet scheduled tick where nothing was actually due yet shouldn't
      // interrupt the user with a toast.
      if (scheduled && attempted.length === 0) return results
      if (failCount === 0) toast.success(`${okCount} source(s) refreshed successfully.${skipped.length ? ` (${skipped.length} not due yet)` : ''}`)
      else toast.error(`${okCount} refreshed, ${failCount} failed — see Data Sources for details.`)
      return results
    } catch (e) {
      if (!scheduled) toast.error('Refresh failed: ' + (e.message || 'unknown error'))
      return []
    } finally {
      setRefreshingAll(false)
      refreshInFlightRef.current = false
    }
  }

  // Real auto-refresh, driven off the server's own lastSync timestamps
  // rather than a naive 30-minute setInterval. A plain setInterval is
  // unreliable here: browsers throttle or fully suspend timers in
  // backgrounded/minimized tabs and during OS sleep, so a single 30-minute
  // timer can silently miss its tick and not fire again until the tab comes
  // back — which is exactly how "last refresh 50 minutes ago" happened
  // under an "every 30 minutes" label. Instead, a cheap 60s heartbeat (plus
  // an immediate check when the tab regains visibility) asks "has 30 minutes
  // actually elapsed since the last successful API-source sync?" and only
  // triggers a real refresh-all when the answer is yes — so a suspended
  // heartbeat just catches up on the next tick or the next time the tab is
  // looked at, instead of losing the cycle entirely. Because "due" is
  // computed from the connections' actual lastSync (not a separately-tracked
  // schedule), a manual "Refresh All" click naturally pushes the next
  // automatic run out by a full 30 minutes too, with no extra bookkeeping.
  useEffect(() => {
    const AUTO_REFRESH_MS = 30 * 60 * 1000
    const HEARTBEAT_MS = 60 * 1000

    async function maybeAutoRefresh() {
      if (!isAuthorizedRef.current) return
      if (refreshInFlightRef.current) return
      const list = await refreshConnectionsList()
      const apiList = list.filter((c) => c.kind === 'api')
      if (!apiList.length) return
      const lastAutoSync = apiList.map((c) => c.lastSync).filter(Boolean).sort().slice(-1)[0]
      const dueAt = lastAutoSync ? new Date(lastAutoSync).getTime() + AUTO_REFRESH_MS : 0
      if (Date.now() >= dueAt) refreshAllSources({ scheduled: true })
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') maybeAutoRefresh()
    }

    const id = setInterval(maybeAutoRefresh, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', handleVisibility)
    // Catch up immediately if the app is opened already past due (e.g. the
    // browser/tab was closed or asleep across the whole interval).
    maybeAutoRefresh()
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Report generation ----
  const reportSources = [
    ...apiConnections.map((c) => ({ label: c.label, status: c.status, lastSync: c.lastSync })),
    ...Object.values(csvSources).map((c) => ({ label: c.label, status: c.status, lastSync: c.lastSync }))
  ]
  const reportMeta = { connectedCount, lastUpdated, sources: reportSources }

  function openReportModal({ title = 'Generate Report', buildModel = buildReportModel, filePrefix = 'Internal_IT_Usage_Report' } = {}) {
    setReportModal({ title, buildModel, filePrefix })
  }

  // PDF/Excel generation pull in real (if optional-heavy) libraries — loaded
  // on demand via dynamic import so the main bundle stays lean for the
  // common case of a session that never generates a report.
  async function handleGenerateReport(scope, format) {
    if (!reportModal) return
    const model = reportModal.buildModel({ allRecords, filteredRecords: records, scope, filters: globalFilters, meta: reportMeta })
    try {
      let filename
      if (format === 'pdf') {
        const { downloadReportPdf } = await import('./reports/pdfReport')
        filename = await downloadReportPdf(model, reportModal.filePrefix)
      } else if (format === 'excel') {
        const { downloadExcelReport } = await import('./reports/excelReport')
        filename = downloadExcelReport(model, reportModal.filePrefix)
      } else {
        const { downloadCsvReport } = await import('./reports/csvReport')
        filename = downloadCsvReport(model, reportModal.filePrefix)
      }
      toast.success(`Downloaded ${filename}`)
    } catch (e) {
      console.error(e)
      toast.error('Failed to generate report: ' + (e.message || 'unknown error'))
    }
  }

  // Authentication/authorization gate — resolved before anything else this
  // app would render or fetch (Part 1/6/17 of the auth spec). Two ways
  // past "not authenticated": the real Microsoft Entra ID redirect, or
  // signing in as the local Administrator (SignIn.jsx) — the emergency
  // recovery path that must keep working regardless of Entra ID's state.
  if (setupStatus === undefined) {
    return <div className="app-root"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }} className="muted">Loading...</div></div>
  }
  // First-run bootstrap (Part 2/13 of the local-admin auth spec): a fresh
  // install with no local administrator account yet gets a dedicated setup
  // screen instead of dead-ending at "contact your administrator" with no
  // way forward. This path disappears the moment the account is created —
  // refreshSetupStatus() re-checks after a successful submission and the
  // app falls through to the normal flow below, already signed in.
  if (setupStatus.bootstrapRequired) {
    return <InitialAdminSetup onComplete={refreshSetupStatus} />
  }
  if (auth === undefined) {
    return <div className="app-root"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }} className="muted">Loading...</div></div>
  }
  if (!auth.authenticated) {
    return <SignIn configured={auth.configured} onLocalSignedIn={refreshAuth} />
  }
  // Local-administrator-only gate (VBU-aware-views spec, "Local
  // Administrator" section) — a real Microsoft-authenticated user's
  // dashboardViewChosen is always true (GET /api/auth/me), so this never
  // shows for them; a local admin sees it once per fresh login, until they
  // pick a view to test (POST /api/auth/local/dashboard-view).
  if (!auth.dashboardViewChosen) {
    return <ChooseDashboardView onSelected={refreshAuth} />
  }
  if (!isAuthorized) {
    return <AccessDenied user={auth.user} reason="Your Microsoft 365 account is not currently assigned to any application role. Contact your administrator to be added to an authorized security group." />
  }

  // The database (via the backend) is the source of truth — never render the
  // app with fake/sample/cached data while it's unreachable.
  if (dashboardState !== 'ready') {
    return (
      <div className="app-root">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', padding: 24 }}>
          {dashboardState === 'loading' ? (
            <div className="muted">Loading dashboard...</div>
          ) : (
            <>
              <h3 style={{ margin: 0 }}>Unable to load dashboard data</h3>
              <div className="muted" style={{ marginTop: 8 }}>Please check the server connection.</div>
              {dashboardErrorMsg && <div className="small muted" style={{ marginTop: 4 }}>{dashboardErrorMsg}</div>}
              <button className="button primary" style={{ marginTop: 16 }} onClick={loadDashboard}>Retry</button>
            </>
          )}
        </div>
      </div>
    )
  }

  // The sidebar only ever shows pages this user is actually authorized for
  // (Part 6: "must only show pages the signed-in user is authorized to
  // access") — but hiding a nav entry is never the real guard; direct
  // navigation is blocked below by the SAME check, and every API call the
  // resulting page would make is independently re-checked by the backend
  // (server/auth/middleware.js). effectiveAllowedPages is RBAC's own
  // allowedPages already narrowed by the resolved Dashboard View's own page
  // list (server/services/dashboardViews.js#effectivePages) — a view can
  // only ever hide a page RBAC would otherwise allow, never grant one RBAC
  // denies (VBU-aware Dashboard View spec, Part 6).
  const effectiveAllowedPages = auth.effectiveAllowedPages || auth.allowedPages
  // Purely informational (Dashboard View VBU Data Assignment spec, Part 5:
  // "the frontend can display the current scope... but must not be
  // responsible for enforcing it" — server/auth/vbuScope.js is the real
  // boundary, this never feeds back into any request). Deliberately just
  // the raw resolved value — a local administrator's own identity has no
  // personal VBU at all, even while previewing a Dashboard View for
  // testing (server/services/dashboardViews.js#applyLocalAdminPreview
  // still sets `vbu` to the previewed view's own VBU for other display
  // purposes) — UserProfileMenu.jsx is where that distinction is actually
  // enforced (never shows this value at all for a local-admin identity),
  // so this never needs to special-case isPreviewingVbu itself.
  const vbuLabel = auth.vbu || null
  const visiblePages = PAGES.filter((p) => effectiveAllowedPages.includes(pageKeyForPath(p.path)))
  const currentPageKey = pageKeyForPath(currentPath)
  const hasCurrentPageAccess = currentPageKey ? effectiveAllowedPages.includes(currentPageKey) : true

  return (
    <div className="app-root">
      <ToastHost />
      <Sidebar
        pages={visiblePages}
        current={PRODUCT_SUBPAGE_PATHS.includes(currentPath) ? '/products' : currentPath}
        onNavigate={navigate}
        lastUpdated={lastUpdated}
        onRefreshAll={refreshAllSources}
        refreshingAll={refreshingAll}
        autoRefreshLabel="Every 30 min"
        lastAutoRefreshAt={lastAutoRefreshAt}
        hasApiSources={apiConnections.length > 0}
        canWrite={auth.canWrite}
        logoKey={auth.dashboardView?.logoKey}
        sidebarTagline={auth.dashboardView?.theme?.sidebarTagline}
        sidebarDecorationKey={auth.dashboardView?.theme?.sidebarDecorationKey}
        viewDisplayName={auth.dashboardView?.displayName}
      />
      <div className="main">
        <Header
          connectedCount={connectedCount} lastUpdated={lastUpdated} summary={summary} userCount={filteredCanonicalUsers.length} onExport={() => openReportModal()}
          onRefreshAll={refreshAllSources} refreshingAll={refreshingAll} canWrite={auth.canWrite}
          user={auth.user} role={auth.role} vbu={vbuLabel} canAccessAdmin={effectiveAllowedPages.includes('admin-access')}
          onOpenAdmin={() => navigate('/admin/access')} onSignOut={signOut}
          headerGraphicKey={auth.dashboardView?.theme?.headerGraphicKey}
          headerDecorationKey={auth.dashboardView?.theme?.headerDecorationKey}
          viewDisplayName={auth.dashboardView?.displayName}
          onSwitchDashboardView={auth.user?.authenticationProvider === 'local' ? switchDashboardView : undefined}
        />
        <div className="content">
          {!hasCurrentPageAccess ? (
            <AccessDenied user={auth.user} />
          ) : (
          <>
          {legacyMigration && (
            <div className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Local browser data found</strong>
                <div className="small muted" style={{ marginTop: 2 }}>
                  {Object.keys(legacyMigration.csvSources).length} previously imported report(s) exist only in this browser. Migrate them to the shared server so every user can see them.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="button secondary" onClick={dismissMigration} disabled={migrating}>Dismiss</button>
                <button className="button primary" onClick={migrateLocalData} disabled={migrating}>{migrating ? 'Migrating...' : 'Migrate to Server'}</button>
              </div>
            </div>
          )}
          {currentPath === '/' && (
            <Overview data={records} allData={allRecords} canonicalUsers={filteredCanonicalUsers} summary={summary} globalFilters={globalFilters}
              setFilter={setFilter} setFiltersPatch={setFiltersPatch} clearFilter={clearFilter} clearAllFilters={clearAllFilters}
              navigate={navigate} connectedCount={connectedCount} csvSources={csvSources} apiConnections={apiConnections} currency={currency}
              costTrend={costTrend} />
          )}
          {currentPath === '/users' && (
            <Users data={filteredCanonicalUsers} allData={canonicalUsers} globalFilters={globalFilters}
              setFilter={setFilter} setFiltersPatch={setFiltersPatch} clearFilter={clearFilter} clearAllFilters={clearAllFilters}
              navigate={navigate} currency={currency} />
          )}
          {currentPath === '/products' && (
            <Products data={records} allData={allRecords} globalFilters={globalFilters} setFilter={setFilter} clearFilter={clearFilter} clearAllFilters={clearAllFilters} navigate={navigate} currency={currency}
              microsoftDirectory={microsoftDirectoryMap} />
          )}
          {currentPath === '/applications' && (
            <Applications navigate={navigate} />
          )}
          {currentPath === '/cost' && (
            <Cost navigate={navigate} currency={currency} onCurrencyChange={setCurrency} setFilter={setFilter} clearFilter={clearFilter} onOpenReport={openReportModal} />
          )}
          {currentPath === '/optimization' && (
            <Optimization data={records} allData={allRecords} summary={summary} globalFilters={globalFilters}
              setFilter={setFilter} clearFilter={clearFilter} clearAllFilters={clearAllFilters}
              onOpenReport={openReportModal} currency={currency} />
          )}
          {currentPath === '/microsoft-365' && (
            <Microsoft365 allData={allRecords} navigate={navigate} setFilter={setFilter} currency={currency} />
          )}
          {currentPath === '/freshservice' && (
            <Freshservice allData={allRecords} microsoftDirectory={microsoftDirectoryMap} currency={currency} navigate={navigate} />
          )}
          {currentPath === '/kiro' && (
            <Kiro data={records} allData={allRecords} microsoftDirectory={microsoftDirectoryMap} currency={currency} navigate={navigate} />
          )}
          {currentPath === '/claude' && (
            <Claude data={records} allData={allRecords} microsoftDirectory={microsoftDirectoryMap} currency={currency} navigate={navigate} />
          )}
          {currentPath === '/data-sources' && (
            <DataSources
              navigate={navigate}
              csvSources={csvSources}
              onAddCsvSource={(provider) => { startAddCsvSource(); navigate(provider === 'Claude' ? '/data-sources/claude' : '/data-sources/other') }}
              onEditCsvSource={(id, provider) => { startEditCsvSource(id); navigate(provider === 'Claude' ? '/data-sources/claude' : '/data-sources/other') }}
              onCsvDisconnect={removeCsvSource}
              onSyncApplied={applyConnectionRecords}
              onDisconnectApplied={removeConnectionData}
              onRefreshAll={refreshAllSources}
              refreshingAll={refreshingAll}
            />
          )}
          {currentPath === '/data-sources/claude' && (
            <DataSourcesClaude navigate={navigate} onDataChanged={fetchDashboardData} />
          )}
          {currentPath === '/data-sources/other' && (
            <DataSourcesFileImport
              provider="Other"
              navigate={navigate}
              csvSources={csvSources}
              editId={csvEditTarget}
              onImport={applyCsvRows}
              onDisconnect={removeCsvSource}
            />
          )}
          {currentPath === '/data-sources/github' && (
            <DataSourcesGithub navigate={navigate}
              onImportCopilot={(id, records) => applyConnectionRecords(id, 'github', records)}
              onDisconnect={removeConnectionData}
            />
          )}
          {currentPath === '/data-sources/kiro' && (
            <DataSourcesKiro navigate={navigate}
              onImportGeneric={(id, records) => applyConnectionRecords(id, 'kiro', records)}
              onDisconnect={removeConnectionData}
            />
          )}
          {currentPath === '/data-sources/microsoft-copilot' && (
            <DataSourcesMicrosoft navigate={navigate}
              onImportMicrosoft={(id, records) => applyConnectionRecords(id, 'microsoft', records)}
              onDisconnect={removeConnectionData}
            />
          )}
          {currentPath === '/data-sources/freshservice' && (
            <DataSourcesFreshservice navigate={navigate} onDisconnect={removeConnectionData} />
          )}
          {currentPath === '/admin/access' && (
            <AdminAccess navigate={navigate} />
          )}
          {currentPath === '/admin/dashboard-views' && (
            <AdminDashboardViews navigate={navigate} />
          )}
          </>
          )}
        </div>
      </div>

      {reportModal && (
        <ReportModal
          title={reportModal.title}
          hasActiveFilters={Object.keys(globalFilters).length > 0}
          filteredCount={records.length}
          totalCount={allRecords.length}
          filtersDescription={describeFilters(globalFilters, COLUMN_BY_KEY)}
          onGenerate={handleGenerateReport}
          onClose={() => setReportModal(null)}
        />
      )}
    </div>
  )
}
