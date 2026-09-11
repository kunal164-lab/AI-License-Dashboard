// Orchestrates the read-only drill-down views (User Detail, Application
// Detail, Device Detail) — DB reads plus a bounded, on-demand live Graph
// fetch to fill in device<->application linkage that the bulk sync (see
// applications.js) only partially covers (per-app device linkage is capped
// there to avoid throttling a tenant-wide sync of ~5,000 app/version rows).
// A user/device only has a handful of installed apps, so fetching that
// live when a specific detail view is opened is cheap and keeps the main
// Microsoft 365 page itself fast (nothing here runs during the main page
// load or the bulk Refresh All sync).
import { getAccessToken } from './auth.js'
import * as applicationsSvc from './applications.js'
import * as devicesSvc from './devices.js'
import * as connectionsRepo from '../../repositories/connectionsRepo.js'
import * as recordsRepo from '../../repositories/recordsRepo.js'
import * as msRepo from '../../repositories/microsoftRepo.js'
import { activityStatusFor } from '../../../src/utils/activityScore.js'
import { isCopilotSku, resolveCopilotEntitlement } from './copilotEntitlement.js'

// Safety cap mirroring applications.js's own MAX_DEVICE_LINKAGE_CALLS
// philosophy — bounds how many extra Graph calls a single detail-view
// request can trigger (matters for apps like "Microsoft.Winget.Source"
// that have 100+ distinct version rows).
const MAX_ONDEMAND_VERSION_CALLS = 40

export async function getUserDetail(msId) {
  const user = msRepo.getUserByMsId(msId)
  if (!user) return null

  const licenses = msRepo.getLicensesForUser(msId)
  const devices = msRepo.getDevicesForUser(msId)
  const signIns = msRepo.getSignInsForUser(msId)
  const conn = connectionsRepo.getConnection(user.connection_id)

  // Copilot usage lives in the generic usage_records table under the SAME
  // Microsoft 365 connection id (see sync.js's copilot branch) — matched by
  // email since that's the only reliable common key between the two.
  let copilot = null
  if (conn) {
    const email = (user.mail || user.upn || '').toLowerCase()
    if (email) {
      const records = recordsRepo.getRecordsForConnection(conn.id)
      copilot = records.find((r) => (r.email || '').toLowerCase() === email) || null
    }
  }
  // LICENSE STATUS vs USAGE STATUS: this route reads the raw usage_records
  // match directly (not the /api/dashboard pipeline's enriched copy), so it
  // never inherited copilotEnrichment.js's real license-assignment join —
  // determined here instead from `licenses` (already fetched above, real
  // Graph /subscribedSkus + assignedLicenses data), never from activity.
  // usage_status reuses the exact same activity-based classification every
  // other page uses (src/utils/activityScore.js) — never a second definition.
  const copilotLicense = licenses.find((l) => isCopilotSku(l.sku_part_number))
  // `plan` is the ONE business plan value — 'Premium' for every recognized
  // Copilot SKU (see copilotEnrichment.js's identical comment) — never a
  // separate Copilot-only field alongside it.
  if (copilot) {
    copilot = {
      ...copilot,
      license_status: copilotLicense ? 'assigned' : 'unassigned',
      usage_status: activityStatusFor(copilot),
      sku_part_number: copilotLicense?.sku_part_number || null,
      plan: copilotLicense ? resolveCopilotEntitlement(copilotLicense.sku_part_number) : null,
      service_plans: copilotLicense?.enabled_service_plans || copilotLicense?.service_plans || null
    }
  } else if (copilotLicense) {
    // A Copilot LICENSE exists even though this person has no row in the
    // Copilot usage report yet (a brand-new assignment, or a report period
    // that simply hasn't included them) — license/SKU/plan must still be
    // shown (Part "License: Assigned" of the spec this implements); usage
    // fields stay genuinely null/N/A, never fabricated as a measured
    // "No Usage".
    copilot = {
      license_status: 'assigned',
      usage_status: null,
      activity_count: null,
      last_activity: null,
      plan: resolveCopilotEntitlement(copilotLicense.sku_part_number),
      sku_part_number: copilotLicense.sku_part_number,
      service_plans: copilotLicense.enabled_service_plans || copilotLicense.service_plans || null
    }
  }

  let applications = []
  let applicationsError = null
  if (conn && devices.length) {
    // byApp is built outside the try and read after it regardless of
    // outcome, so if fetching device 2 of N throws (e.g. throttled),
    // whatever device 1 already found is still returned — not thrown away
    // along with the one call that failed.
    const byApp = new Map()
    try {
      const accessToken = await getAccessToken(conn.credentials)
      for (const device of devices) {
        const apps = await devicesSvc.fetchDetectedAppsForDevice(accessToken, device.ms_id)
        if (apps.length) msRepo.upsertDeviceApplicationLinks(conn.id, apps.map((a) => ({ applicationMsId: a.id, deviceMsId: device.ms_id })))
        for (const a of apps) {
          if (!byApp.has(a.id)) byApp.set(a.id, { ms_id: a.id, display_name: a.displayName || null, version: a.version || null, publisher: a.publisher || null, platform: a.platform || null, devices: [] })
          byApp.get(a.id).devices.push(device.device_name)
        }
      }
    } catch (e) {
      applicationsError = e.message
    }
    applications = Array.from(byApp.values())
  }

  return { user, licenses, devices, applications, applicationsError, applicationsSource: 'graph-beta', copilot, signIns }
}

export async function getDeviceDetail(deviceMsId) {
  const device = msRepo.getDeviceByMsId(deviceMsId)
  if (!device) return null
  const user = device.user_ms_id ? msRepo.getUserByMsId(device.user_ms_id) : null
  const conn = connectionsRepo.getConnection(device.connection_id)

  let applications = []
  let applicationsError = null
  if (conn) {
    try {
      const accessToken = await getAccessToken(conn.credentials)
      const apps = await devicesSvc.fetchDetectedAppsForDevice(accessToken, deviceMsId)
      if (apps.length) msRepo.upsertDeviceApplicationLinks(conn.id, apps.map((a) => ({ applicationMsId: a.id, deviceMsId })))
      applications = apps.map((a) => ({ ms_id: a.id, display_name: a.displayName || null, version: a.version || null, publisher: a.publisher || null, platform: a.platform || null }))
    } catch (e) {
      applicationsError = e.message
    }
  }

  return { device, user, applications, applicationsError, applicationsSource: 'graph-beta' }
}

// Builds the client-facing shape from whatever version/link rows are
// already on hand — never makes a network call itself. Shared by the fast,
// DB-only summary (getApplicationSummary) and the on-demand linkage fetch
// (fetchApplicationDeviceLinkage) below so both endpoints return the exact
// same response shape regardless of how the `links` were obtained.
function buildApplicationDetailResponse(displayName, versionRows, links, linkageMeta) {
  const totalDeviceCount = versionRows.reduce((s, v) => s + (v.device_count || 0), 0)
  const publishers = Array.from(new Set(versionRows.map((v) => v.publisher).filter(Boolean)))
  const platforms = Array.from(new Set(versionRows.map((v) => v.platform).filter(Boolean)))
  const lastSyncedAt = versionRows.reduce((max, v) => (!max || (v.synced_at && v.synced_at > max) ? v.synced_at : max), null)

  const versionByMsId = new Map(versionRows.map((v) => [v.ms_id, v]))
  const finalLinkedIds = new Set(links.map((l) => l.application_ms_id))

  // Department comes from the separately-synced Users & Directory
  // capability, joined here by exact (lowercased) UPN match — the only
  // stable identifier the device-linkage rows carry for a user. Never
  // fuzzy-matched; left null (shown as N/A) when no exact match exists.
  // VBU is not a Microsoft Graph field, so it's never populated here.
  const usersByUpn = new Map(msRepo.listAllUsers().map((u) => [(u.upn || '').toLowerCase(), u]).filter(([k]) => k))

  return {
    summary: {
      displayName,
      publishers,
      platforms,
      totalDeviceCount,
      versionCount: versionRows.length,
      uniqueLinkedDeviceCount: new Set(links.map((l) => l.device_ms_id)).size,
      lastSyncedAt
    },
    versions: versionRows.map((v) => ({
      ms_id: v.ms_id,
      version: v.version,
      deviceCount: v.device_count,
      percentage: totalDeviceCount ? Math.round((v.device_count / totalDeviceCount) * 1000) / 10 : null,
      linked: finalLinkedIds.has(v.ms_id)
    })),
    devices: links.map((l) => ({
      device_ms_id: l.device_ms_id,
      device_name: l.device_name,
      application_version: versionByMsId.get(l.application_ms_id)?.version || null,
      user_principal_name: l.user_principal_name,
      user_ms_id: usersByUpn.get((l.user_principal_name || '').toLowerCase())?.ms_id || null,
      department: usersByUpn.get((l.user_principal_name || '').toLowerCase())?.department || null,
      operating_system: l.operating_system,
      os_version: l.os_version,
      owner_type: l.owner_type,
      compliance_state: l.compliance_state,
      management_state: l.management_state,
      last_sync_at: l.last_sync_at
    })),
    linkageCoverage: {
      linkedVersions: versionRows.filter((v) => finalLinkedIds.has(v.ms_id)).length,
      totalVersions: versionRows.length,
      onDemandFetched: linkageMeta.onDemandFetched || 0,
      truncated: linkageMeta.missingVersionsCount > MAX_ONDEMAND_VERSION_CALLS,
      error: linkageMeta.onDemandError || null,
      // Tells the client whether it's worth calling the on-demand linkage
      // endpoint at all — false once every version already has cached
      // linkage, or once a prior on-demand call has already run for this
      // request (avoids the client looping the same fetch forever).
      canFetchMore: !linkageMeta.alreadyAttempted && linkageMeta.missingVersionsCount > 0
    }
  }
}

// Fast path — every application open hits this first. DB-only, zero live
// Graph calls, so it returns in milliseconds regardless of how many
// versions this application has. Device linkage reflects whatever the bulk
// sync (or a prior on-demand fetch below) already cached; versions with no
// cached linkage yet are still listed (linked: false) rather than hidden.
export function getApplicationSummary(displayName) {
  const versionRows = msRepo.getApplicationRowsByName(displayName)
  if (!versionRows.length) return null
  const appMsIds = versionRows.map((v) => v.ms_id)
  const links = msRepo.getDeviceLinksForAppIds(appMsIds)
  const linkedIds = new Set(links.map((l) => l.application_ms_id))
  const missingVersionsCount = versionRows.filter((v) => !linkedIds.has(v.ms_id)).length
  return buildApplicationDetailResponse(displayName, versionRows, links, { missingVersionsCount })
}

// Slow path — only called by the client AFTER the fast summary above has
// already rendered (see ApplicationDetailModal.jsx), and only when the
// summary reported missing linkage. Does the same bounded, sequential live
// Graph lookup the old single-request getApplicationDetail used to do
// inline, but now it runs in the background while the user is already
// looking at the rest of the application's real data instead of blocking
// on it — this is the fix for the noticeable delay opening an application
// used to cause (up to MAX_ONDEMAND_VERSION_CALLS sequential Graph round
// trips before the modal could show anything at all).
export async function fetchApplicationDeviceLinkage(displayName) {
  const versionRows = msRepo.getApplicationRowsByName(displayName)
  if (!versionRows.length) return null

  const connectionId = versionRows[0].connection_id
  const appMsIds = versionRows.map((v) => v.ms_id)
  let links = msRepo.getDeviceLinksForAppIds(appMsIds)
  const linkedIds = new Set(links.map((l) => l.application_ms_id))
  const missingVersions = versionRows.filter((v) => !linkedIds.has(v.ms_id))

  let onDemandFetched = 0
  let onDemandError = null
  if (missingVersions.length) {
    const conn = connectionsRepo.getConnection(connectionId)
    if (conn) {
      try {
        const accessToken = await getAccessToken(conn.credentials)
        let fetchedAny = false
        for (const v of missingVersions) {
          if (onDemandFetched >= MAX_ONDEMAND_VERSION_CALLS) break
          onDemandFetched++
          // Persisted per-version, not batched until the loop finishes —
          // if throttling (or any other error) interrupts partway through,
          // whatever versions were already fetched successfully must not
          // be thrown away along with the one call that failed.
          const devices = await applicationsSvc.fetchDevicesForApp(accessToken, v.ms_id)
          if (devices.length) {
            msRepo.upsertDeviceApplicationLinks(connectionId, devices.map((d) => ({ applicationMsId: v.ms_id, deviceMsId: d.id })))
            fetchedAny = true
          }
        }
        if (fetchedAny) links = msRepo.getDeviceLinksForAppIds(appMsIds)
      } catch (e) {
        onDemandError = e.message
      }
    }
  }

  return buildApplicationDetailResponse(displayName, versionRows, links, {
    onDemandFetched, onDemandError, missingVersionsCount: missingVersions.length, alreadyAttempted: true
  })
}
