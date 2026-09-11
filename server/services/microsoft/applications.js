import { graphGetAllPages } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.applications.label, requiredPermissions: MICROSOFT_CAPABILITIES.applications.permissions }

// Intune-DETECTED applications on managed devices — option (A) from the
// spec's A/B/C distinction. This is intentionally NOT:
//   (B) Microsoft Teams installed apps      -> GET /users/{id}/teamwork/installedApps
//   (C) Microsoft 365 app usage reports      -> GET /reports/getMicrosoft365AppUserDetail
// Those are different Graph APIs returning different data and are not
// implemented here; mixing them into this same dataset would misrepresent
// what "installed application" means for each row.
// https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-detectedapp
const APP_SELECT = ['id', 'displayName', 'version', 'publisher', 'platform', 'deviceCount'].join(',')

// Per-app device linkage is a separate call per app (Graph doesn't offer a
// single bulk "app -> devices" collection), so it's bounded by a safety cap
// to avoid unbounded API usage on tenants with very large app catalogs.
// Truncation is reported back, never silently dropped.
const MAX_DEVICE_LINKAGE_CALLS = 200

// One app's device linkage — factored out so both the bulk sync (below) and
// an on-demand detail-view lookup (server/services/microsoft/detail.js) can
// call the exact same real Graph relationship.
export async function fetchDevicesForApp(accessToken, appMsId) {
  return graphGetAllPages(accessToken, `/deviceManagement/detectedApps/${appMsId}/managedDevices?$select=id&$top=999`, CTX)
}

export async function fetchDetectedAppsWithDevices(accessToken) {
  const apps = await graphGetAllPages(accessToken, `/deviceManagement/detectedApps?$select=${APP_SELECT}&$top=999`, CTX)
  const deviceLinks = []
  let truncated = false
  let throttledStop = false
  let calls = 0
  for (const app of apps) {
    if (calls >= MAX_DEVICE_LINKAGE_CALLS) { truncated = true; break }
    calls++
    try {
      const devices = await fetchDevicesForApp(accessToken, app.id)
      for (const d of devices) deviceLinks.push({ applicationMsId: app.id, deviceMsId: d.id })
    } catch (e) {
      if (e.throttled) {
        // graphGetAllPages already retried this one call with backoff and
        // still got throttled — hammering through the remaining apps would
        // be exactly the "uncontrolled parallel/rapid requests" behavior to
        // avoid. Stop the linkage loop here; the app catalog itself (with
        // its deviceCount) is still fully synced.
        truncated = true
        throttledStop = true
        break
      }
      // Any other single app's device-linkage failing shouldn't fail the
      // whole sync — the app itself is still recorded.
    }
  }
  return { apps, deviceLinks, truncated, throttledStop, deviceLinkageCallsMade: calls, totalApps: apps.length }
}

export { MAX_DEVICE_LINKAGE_CALLS }
