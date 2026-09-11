import { run, all, persist } from '../db/index.js'

const MS_TABLES = ['microsoft_users', 'microsoft_devices', 'microsoft_applications', 'microsoft_device_applications', 'microsoft_licenses', 'microsoft_groups', 'microsoft_sign_ins', 'microsoft_sync_runs']

function nowIso() {
  return new Date().toISOString()
}

// The Microsoft 365 population is gated to exactly one authoritative
// company: trimmed, case-insensitive match against "SSP" — no substring
// matching ("SSP Limited"/"SSP Worldwide"/"SSP - India" all fail this),
// no fallback to any other field (domain/department/VBU/etc) if
// companyName is missing. Exported so every consumer of this gate (the
// sync-time filter below, plus anywhere else that needs to re-check a
// row) uses the exact same rule.
export function isSspCompany(companyName) {
  return typeof companyName === 'string' && companyName.trim().toLowerCase() === 'ssp'
}

// ---- Users ----
// `graphUsers` is expected to already be filtered to isSspCompany() by the
// caller (sync.js) — this is the ingestion boundary itself, so a non-SSP
// user should never even reach this function. The DELETE below is a
// defensive, idempotent cleanup that ALSO removes any row already stored
// for this connection from before this filter existed (or from any other
// path) that doesn't pass the same check — every sync leaves this
// connection's stored population with ONLY SSP-company users, never a mix
// of old and new rules.
export function upsertUsers(connectionId, graphUsers) {
  const now = nowIso()
  for (const u of graphUsers) {
    const email = u.userPrincipalName || u.mail || ''
    const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : null
    // VBU's ONLY source: onPremisesExtensionAttributes.extensionAttribute3.
    // Safe to fold into this same upsert (unlike manager below) because a
    // total /users fetch failure already skips this whole function — see
    // sync.js's per-capability try/catch — so old data is never blanked by
    // a failed run; this only ever writes what a SUCCESSFUL fetch returned.
    const vbu = u.onPremisesExtensionAttributes?.extensionAttribute3 || null
    run(
      `INSERT OR REPLACE INTO microsoft_users
        (connection_id, ms_id, upn, mail, display_name, given_name, surname, department, job_title, office_location, company_name, employee_id, account_enabled, usage_location, domain, vbu, assigned_licenses_json, assigned_plans_json, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        connectionId, u.id, u.userPrincipalName || null, u.mail || null, u.displayName || null,
        u.givenName || null, u.surname || null, u.department || null, u.jobTitle || null,
        u.officeLocation || null, u.companyName || null, u.employeeId || null,
        u.accountEnabled ? 1 : 0, u.usageLocation || null, domain, vbu,
        JSON.stringify(u.assignedLicenses || []), JSON.stringify(u.assignedPlans || []), now
      ]
    )
  }
  run(
    `DELETE FROM microsoft_users WHERE connection_id = ? AND (company_name IS NULL OR LOWER(TRIM(company_name)) != 'ssp')`,
    [connectionId]
  )
  persist()
  return graphUsers.length
}

// Separate from upsertUsers' full-row INSERT OR REPLACE on purpose: manager
// is fetched via its own batched call (users.js#fetchManagers) that can
// resolve only SOME users in a given run (throttling, transient errors).
// `resolvedById`: Map<msId, {displayName, upn} | null> — null means
// Graph confirmed no manager; an id simply absent from the map means "not
// resolved this run," and that user's row is left completely untouched, so
// a partial batch failure never wipes a previously-known manager value.
export function updateManagers(connectionId, resolvedById) {
  for (const [msId, mgr] of resolvedById) {
    run(
      'UPDATE microsoft_users SET manager_display_name = ?, manager_upn = ? WHERE connection_id = ? AND ms_id = ?',
      [mgr?.displayName || null, mgr?.upn || null, connectionId, msId]
    )
  }
  persist()
}

function rowToUser(r) {
  return {
    ...r,
    account_enabled: !!r.account_enabled,
    assigned_licenses: JSON.parse(r.assigned_licenses_json || '[]'),
    assigned_plans: JSON.parse(r.assigned_plans_json || '[]')
  }
}

export function listUsers(connectionId) {
  return all('SELECT * FROM microsoft_users WHERE connection_id = ? ORDER BY display_name', [connectionId]).map(rowToUser)
}

export function listAllUsers() {
  return all('SELECT * FROM microsoft_users ORDER BY display_name').map(rowToUser)
}

// Every distinct real VBU value currently on record (Dashboard View VBU
// Data Assignment spec) — the authoritative source for the admin UI's VBU
// multi-select, never a hardcoded list. Same source of truth as every VBU
// comparison elsewhere in the app: onPremisesExtensionAttributes
// .extensionAttribute3 (see upsertUsers above), synced verbatim, blank/
// null excluded rather than shown as a selectable "no VBU" option.
export function listDistinctVbus() {
  return all("SELECT DISTINCT vbu FROM microsoft_users WHERE vbu IS NOT NULL AND TRIM(vbu) <> '' ORDER BY vbu COLLATE NOCASE")
    .map((r) => r.vbu)
}

export function getUserByMsId(msId) {
  const row = all('SELECT * FROM microsoft_users WHERE ms_id = ? LIMIT 1', [msId])[0]
  return row ? rowToUser(row) : null
}

// ---- Devices ----
export function upsertDevices(connectionId, graphDevices) {
  const now = nowIso()
  for (const d of graphDevices) {
    run(
      `INSERT OR REPLACE INTO microsoft_devices
        (connection_id, ms_id, device_name, user_ms_id, user_principal_name, operating_system, os_version, compliance_state, management_state, owner_type, enrolled_at, last_sync_at, manufacturer, model, serial_number, azure_ad_device_id, synced_at,
         management_agent, device_registration_state, email_address, phone_number, wifi_mac_address, ethernet_mac_address, total_storage_bytes, free_storage_bytes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        connectionId, d.id, d.deviceName || null, d.userId || null, d.userPrincipalName || null,
        d.operatingSystem || null, d.osVersion || null, d.complianceState || null, d.managementState || null,
        d.managedDeviceOwnerType || null, d.enrolledDateTime || null, d.lastSyncDateTime || null,
        d.manufacturer || null, d.model || null, d.serialNumber || null, d.azureADDeviceId || null, now,
        d.managementAgent || null, d.deviceRegistrationState || null,
        d.emailAddress || null, d.phoneNumber || null, d.wiFiMacAddress || null, d.ethernetMacAddress || null,
        d.totalStorageSpaceInBytes ?? null, d.freeStorageSpaceInBytes ?? null
      ]
    )
  }
  persist()
  return graphDevices.length
}

export function listDevices(connectionId) {
  return all('SELECT * FROM microsoft_devices WHERE connection_id = ? ORDER BY device_name', [connectionId])
}

export function listAllDevices() {
  return all('SELECT * FROM microsoft_devices ORDER BY device_name')
}

// Just the two columns the Application page's device<->user linkage needs
// (see server/index.js's /api/microsoft/applications-overview) — avoids
// shipping every device's full column set (OS/compliance/storage/etc,
// irrelevant there) to the browser just to count unique users per app.
export function listAllDeviceUserLinks() {
  return all('SELECT ms_id, user_principal_name FROM microsoft_devices')
}

export function getDeviceByMsId(msId) {
  return all('SELECT * FROM microsoft_devices WHERE ms_id = ? LIMIT 1', [msId])[0] || null
}

export function getDevicesForUser(userMsId) {
  return all('SELECT * FROM microsoft_devices WHERE user_ms_id = ? ORDER BY device_name', [userMsId])
}

// ---- Applications ----
export function upsertApplications(connectionId, apps, deviceLinks) {
  const now = nowIso()
  for (const a of apps) {
    run(
      `INSERT OR REPLACE INTO microsoft_applications
        (connection_id, ms_id, display_name, version, publisher, platform, device_count, synced_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [connectionId, a.id, a.displayName || null, a.version || null, a.publisher || null, a.platform || null, a.deviceCount ?? null, now]
    )
  }
  run('DELETE FROM microsoft_device_applications WHERE connection_id = ?', [connectionId])
  for (const link of deviceLinks || []) {
    run(
      `INSERT OR REPLACE INTO microsoft_device_applications (connection_id, application_ms_id, device_ms_id, synced_at) VALUES (?,?,?,?)`,
      [connectionId, link.applicationMsId, link.deviceMsId, now]
    )
  }
  persist()
  return apps.length
}

export function listApplications(connectionId) {
  return all('SELECT * FROM microsoft_applications WHERE connection_id = ? ORDER BY device_count DESC', [connectionId])
}

export function listAllApplications() {
  return all('SELECT * FROM microsoft_applications ORDER BY device_count DESC')
}

export function listAllDeviceApplications() {
  return all('SELECT * FROM microsoft_device_applications')
}

export function getApplicationRowsByName(displayName) {
  return all('SELECT * FROM microsoft_applications WHERE display_name = ? ORDER BY device_count DESC', [displayName])
}

// Purely additive upsert for on-demand, single-app/single-device linkage
// discovery (detail.js) — unlike upsertApplications' bulk-sync path, this
// must NEVER delete existing links first: it's called with just a handful
// of newly-discovered links at a time (e.g. one user's devices, or one
// application's missing versions), and wiping the connection's whole
// device_applications table first would destroy everything else already
// cached.
export function upsertDeviceApplicationLinks(connectionId, links) {
  if (!links || !links.length) return 0
  const now = nowIso()
  for (const link of links) {
    run(
      `INSERT OR REPLACE INTO microsoft_device_applications (connection_id, application_ms_id, device_ms_id, synced_at) VALUES (?,?,?,?)`,
      [connectionId, link.applicationMsId, link.deviceMsId, now]
    )
  }
  persist()
  return links.length
}

// Every device linked to any of the given application ms_ids, joined with
// the device's own stored fields — used by the Application Detail view's
// "Device Installation Details" table.
export function getDeviceLinksForAppIds(appMsIds) {
  if (!appMsIds || !appMsIds.length) return []
  const placeholders = appMsIds.map(() => '?').join(',')
  return all(
    `SELECT da.application_ms_id, d.ms_id as device_ms_id, d.device_name, d.user_principal_name, d.operating_system, d.os_version, d.owner_type, d.compliance_state, d.management_state, d.last_sync_at
     FROM microsoft_device_applications da
     JOIN microsoft_devices d ON d.ms_id = da.device_ms_id
     WHERE da.application_ms_id IN (${placeholders})`,
    appMsIds
  )
}

// ---- Licenses ----
// Cross-references each user's assignedLicenses (skuId only) against the
// tenant's subscribedSkus (skuId -> skuPartNumber) to produce readable rows.
export function upsertLicenses(connectionId, users, skus) {
  const now = nowIso()
  const skuMap = new Map((skus || []).map((s) => [s.skuId, s]))
  run('DELETE FROM microsoft_licenses WHERE connection_id = ?', [connectionId])
  let count = 0
  for (const u of users) {
    // assignedPlans is the per-USER, already-merged-across-every-SKU view
    // of which service plans are Enabled/Disabled/PendingActivation for
    // THIS person (see users.js's $select comment) — cross-referenced here
    // against each SKU's own catalog plan list so enabled_service_plans_json
    // reflects this specific user's real status, not the same uniform
    // catalog every holder of the SKU would otherwise show regardless of
    // their own disabledPlans.
    const assignedPlanStatusById = new Map((u.assigned_plans || []).map((p) => [p.servicePlanId, p.capabilityStatus]))
    for (const lic of u.assigned_licenses || []) {
      if (!lic.skuId) continue
      const sku = skuMap.get(lic.skuId)
      const catalogPlans = sku?.servicePlans || []
      const enabledServicePlans = catalogPlans.map((p) => ({
        servicePlanId: p.servicePlanId,
        servicePlanName: p.servicePlanName,
        capabilityStatus: assignedPlanStatusById.get(p.servicePlanId) || null
      }))
      run(
        `INSERT OR REPLACE INTO microsoft_licenses (connection_id, user_ms_id, sku_id, sku_part_number, service_plans_json, enabled_service_plans_json, synced_at) VALUES (?,?,?,?,?,?,?)`,
        [connectionId, u.ms_id, lic.skuId, sku?.skuPartNumber || lic.skuId, JSON.stringify(catalogPlans), JSON.stringify(enabledServicePlans), now]
      )
      count++
    }
  }
  persist()
  return count
}

function rowToLicense(r) {
  return {
    ...r,
    service_plans: JSON.parse(r.service_plans_json || '[]'),
    enabled_service_plans: JSON.parse(r.enabled_service_plans_json || '[]')
  }
}

export function listLicenses(connectionId) {
  return all('SELECT * FROM microsoft_licenses WHERE connection_id = ?', [connectionId]).map(rowToLicense)
}

export function listAllLicenses() {
  return all('SELECT * FROM microsoft_licenses').map(rowToLicense)
}

export function getLicensesForUser(userMsId) {
  return all('SELECT * FROM microsoft_licenses WHERE user_ms_id = ?', [userMsId]).map(rowToLicense)
}

// ---- Groups & Teams ----
function rowToGroup(r) {
  return { ...r, security_enabled: !!r.security_enabled, mail_enabled: !!r.mail_enabled, is_team: !!r.is_team, group_types: JSON.parse(r.group_types || '[]') }
}

export function upsertGroups(connectionId, graphGroups) {
  const now = nowIso()
  for (const g of graphGroups) {
    const isTeam = Array.isArray(g.resourceProvisioningOptions) && g.resourceProvisioningOptions.includes('Team') ? 1 : 0
    run(
      `INSERT OR REPLACE INTO microsoft_groups
        (connection_id, ms_id, display_name, description, mail, mail_nickname, group_types, security_enabled, mail_enabled, visibility, is_team, created_at_graph, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        connectionId, g.id, g.displayName || null, g.description || null, g.mail || null, g.mailNickname || null,
        JSON.stringify(g.groupTypes || []), g.securityEnabled ? 1 : 0, g.mailEnabled ? 1 : 0, g.visibility || null,
        isTeam, g.createdDateTime || null, now
      ]
    )
  }
  persist()
  return graphGroups.length
}

export function listGroups(connectionId) {
  return all('SELECT * FROM microsoft_groups WHERE connection_id = ? ORDER BY display_name', [connectionId]).map(rowToGroup)
}

export function listAllGroups() {
  return all('SELECT * FROM microsoft_groups ORDER BY display_name').map(rowToGroup)
}

// ---- Sign-ins ----
// Graph's signIn.status is an object ({errorCode, failureReason, ...}); we
// derive a simple readable status string (errorCode 0 = success) rather
// than storing the whole object as the "status" column, while still
// preserving the detailed failureReason/errorCode separately.
export function upsertSignIns(connectionId, graphSignIns) {
  const now = nowIso()
  for (const s of graphSignIns) {
    const errorCode = s.status?.errorCode
    const statusLabel = errorCode === 0 ? 'success' : (errorCode != null ? 'failure' : null)
    run(
      `INSERT OR REPLACE INTO microsoft_sign_ins
        (connection_id, graph_signin_id, created_at, user_id, user_display_name, user_principal_name, app_display_name, app_id, client_app_used, ip_address, location, resource_display_name, conditional_access_status, status, failure_reason, failure_error_code, device_detail, authentication_requirement, risk_level, risk_state, risk_detail, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        connectionId, s.id, s.createdDateTime || null, s.userId || null, s.userDisplayName || null, s.userPrincipalName || null,
        s.appDisplayName || null, s.appId || null, s.clientAppUsed || null, s.ipAddress || null,
        s.location ? JSON.stringify(s.location) : null, s.resourceDisplayName || null, s.conditionalAccessStatus || null,
        statusLabel, s.status?.failureReason || null, errorCode != null ? String(errorCode) : null,
        s.deviceDetail ? JSON.stringify(s.deviceDetail) : null, s.authenticationRequirement || null,
        // riskLevelAggregated (not riskLevelDuringSignIn) — Graph's overall
        // per-sign-in risk assessment; see docs for why this one was chosen.
        s.riskLevelAggregated || null, s.riskState || null, s.riskDetail || null, now
      ]
    )
  }
  persist()
  return graphSignIns.length
}

export function latestSignInTimestamp(connectionId) {
  const row = all('SELECT MAX(created_at) as maxCreated FROM microsoft_sign_ins WHERE connection_id = ?', [connectionId])[0]
  return row?.maxCreated || null
}

export function listSignIns(connectionId, limit = 1000) {
  return all('SELECT * FROM microsoft_sign_ins WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?', [connectionId, limit])
}

export function listAllSignIns(limit = 2000) {
  return all('SELECT * FROM microsoft_sign_ins ORDER BY created_at DESC LIMIT ?', [limit])
}

export function getSignInsForUser(userMsId, limit = 50) {
  return all('SELECT * FROM microsoft_sign_ins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userMsId, limit])
}

// ---- Sync run history / current status ----
export function recordSyncRun({ connectionId, capability, status, recordCount, errorMessage }) {
  run(
    `INSERT INTO microsoft_sync_runs (connection_id, capability, attempted_at, status, record_count, error_message) VALUES (?,?,?,?,?,?)`,
    [connectionId, capability, nowIso(), status, recordCount ?? null, errorMessage ?? null]
  )
  persist()
}

// Latest row per capability for this connection (small table, so a JS-side
// reduction avoids depending on window-function SQL support).
export function latestSyncStatus(connectionId) {
  const rows = all('SELECT * FROM microsoft_sync_runs WHERE connection_id = ? ORDER BY attempted_at ASC', [connectionId])
  const latest = {}
  for (const r of rows) latest[r.capability] = r
  return latest
}

export function deleteAllForConnection(connectionId) {
  for (const t of MS_TABLES) run(`DELETE FROM ${t} WHERE connection_id = ?`, [connectionId])
  persist()
}
