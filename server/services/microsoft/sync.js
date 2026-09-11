import { getAccessToken } from './auth.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'
import * as copilotSvc from './copilot.js'
import * as usersSvc from './users.js'
import * as devicesSvc from './devices.js'
import * as applicationsSvc from './applications.js'
import * as licensesSvc from './licenses.js'
import * as groupsSvc from './groups.js'
import * as signinsSvc from './signins.js'
import { aggregateDepartments } from './departments.js'
import * as msRepo from '../../repositories/microsoftRepo.js'
import * as recordsRepo from '../../repositories/recordsRepo.js'
import { normalizeMicrosoft } from '../../../src/utils/microsoftNormalizer.js'

function isPermissionError(message) {
  return /permission|admin consent/i.test(message || '')
}

// Runs every capability the connection has enabled, independently — one
// capability failing (missing permission, Graph error, etc.) never blocks
// the others, and the connection-level sync as a whole is considered "ok"
// as long as at least the capabilities that DID run didn't all fail. Returns
// a per-capability result map the route layer turns into the UI's
// "Copilot synced / Devices permission required" summary.
export async function syncMicrosoftConnection(conn) {
  const rawCapabilities = (conn.meta.capabilities && conn.meta.capabilities.length)
    ? conn.meta.capabilities
    : ['copilot'] // backward compatible with connections created before capability selection existed
  // "devices" was consolidated into "intune_devices" (same endpoint/table,
  // just renamed to match the product's terminology) — remap any
  // connection still carrying the old key rather than silently dropping it.
  const enabledCapabilities = Array.from(new Set(rawCapabilities.map((c) => (c === 'devices' ? 'intune_devices' : c))))

  const results = {}

  let accessToken
  try {
    accessToken = await getAccessToken(conn.credentials)
  } catch (e) {
    for (const key of enabledCapabilities) {
      results[key] = { ok: false, error: e.message }
      msRepo.recordSyncRun({ connectionId: conn.id, capability: key, status: 'error', errorMessage: e.message })
    }
    return results
  }

  // Users must run before Departments/Licenses can derive anything
  // meaningful, regardless of the order the admin checked boxes in.
  const runOrder = [...enabledCapabilities].sort((a, b) => {
    const aDeps = MICROSOFT_CAPABILITIES[a]?.dependsOn?.includes(b) ? 1 : 0
    const bDeps = MICROSOFT_CAPABILITIES[b]?.dependsOn?.includes(a) ? 1 : 0
    return aDeps - bDeps
  })

  for (const key of runOrder) {
    const capDef = MICROSOFT_CAPABILITIES[key]
    if (!capDef) continue
    if (!capDef.implemented) {
      results[key] = { ok: false, skipped: true, error: `${capDef.label} is not yet implemented.` }
      continue
    }
    try {
      const result = await runCapability(key, conn, accessToken)
      results[key] = { ok: true, ...result }
      msRepo.recordSyncRun({ connectionId: conn.id, capability: key, status: 'success', recordCount: result.count })
    } catch (e) {
      const message = e.message || 'Unknown error'
      results[key] = { ok: false, error: message, throttled: !!e.throttled }
      // Persistent throttling gets its own status — distinct from a real
      // error/permission problem — and never wipes out data from a
      // previous successful sync (upserts only ever run on the success
      // path above, so a throttled/errored attempt simply leaves whatever
      // was already stored untouched).
      msRepo.recordSyncRun({
        connectionId: conn.id,
        capability: key,
        status: e.throttled ? 'throttled' : (isPermissionError(message) ? 'permission_missing' : 'error'),
        errorMessage: message
      })
    }
  }

  return results
}

async function runCapability(key, conn, accessToken) {
  if (key === 'copilot') {
    const raw = await copilotSvc.fetchCopilotUsage(accessToken, { period: conn.meta.period || 'D7' })
    const normalized = normalizeMicrosoft(raw)
    // Unchanged path: this is exactly what already feeds the existing AI
    // License & Usage dashboard (Users/Overview/Optimization pages).
    recordsRepo.replaceRecordsForConnection(conn.id, normalized)
    return { count: normalized.length }
  }
  if (key === 'users') {
    const raw = await usersSvc.fetchUsers(accessToken)
    // Ingestion boundary: the Microsoft 365 population is gated to exactly
    // company "SSP" (trimmed, case-insensitive — msRepo.isSspCompany) —
    // never a substring match, never a fallback to domain/department/VBU/
    // any other field. A user who doesn't pass this is filtered out HERE,
    // before storage and before anything downstream (Copilot enrichment,
    // license/cost/optimization/report/canonical-user processing) ever
    // sees them — not fetching their manager below either, since they're
    // not part of the population at all.
    const sspUsers = raw.filter((u) => msRepo.isSspCompany(u.companyName))
    const count = msRepo.upsertUsers(conn.id, sspUsers)
    // Manager is a separate batched fetch (users.js#fetchManagers) — its own
    // try/catch so a manager-specific problem (e.g. a permission gap on
    // /users/{id}/manager specifically) never fails the base user sync that
    // already succeeded above. Recorded as its own sync-history entry so
    // that's visible without being conflated with base "users" status.
    try {
      const resolved = await usersSvc.fetchManagers(accessToken, sspUsers.map((u) => u.id))
      msRepo.updateManagers(conn.id, resolved)
      msRepo.recordSyncRun({ connectionId: conn.id, capability: 'users_managers', status: 'success', recordCount: resolved.size })
    } catch (e) {
      msRepo.recordSyncRun({ connectionId: conn.id, capability: 'users_managers', status: e.throttled ? 'throttled' : 'error', errorMessage: e.message })
    }
    return { count }
  }
  if (key === 'departments') {
    const users = msRepo.listUsers(conn.id)
    const departments = aggregateDepartments(users)
    return { count: departments.length, note: users.length ? undefined : 'No synced users yet — enable Users & Directory too.' }
  }
  if (key === 'intune_devices') {
    const raw = await devicesSvc.fetchManagedDevices(accessToken)
    const count = msRepo.upsertDevices(conn.id, raw)
    return { count }
  }
  if (key === 'applications') {
    const { apps, deviceLinks, truncated, throttledStop, totalApps } = await applicationsSvc.fetchDetectedAppsWithDevices(accessToken)
    const count = msRepo.upsertApplications(conn.id, apps, deviceLinks)
    const note = throttledStop
      ? `Device-to-app linkage stopped early after Microsoft Graph throttling persisted; the app catalog (${count} apps) synced fully.`
      : (truncated ? `Device linkage limited to the first apps synced (of ${totalApps} total) to bound Graph API calls.` : undefined)
    return { count, truncated, note }
  }
  if (key === 'groups') {
    const raw = await groupsSvc.fetchGroups(accessToken)
    const count = msRepo.upsertGroups(conn.id, raw)
    return { count }
  }
  if (key === 'licenses') {
    const skus = await licensesSvc.fetchSubscribedSkus(accessToken)
    const users = msRepo.listUsers(conn.id)
    const count = msRepo.upsertLicenses(conn.id, users, skus)
    return { count, note: users.length ? undefined : 'No synced users yet — enable Users & Directory too for per-user license assignment.' }
  }
  if (key === 'signins') {
    const latest = msRepo.latestSignInTimestamp(conn.id)
    const sinceIso = signinsSvc.resolveSinceIso({ configuredDays: conn.meta.signInsDays, latestSyncedIso: latest })
    const raw = await signinsSvc.fetchSignIns(accessToken, sinceIso)
    const count = msRepo.upsertSignIns(conn.id, raw)
    return { count, note: `Synced sign-ins since ${sinceIso}${latest ? ' (incremental from last sync)' : ' (initial period)'}.` }
  }
  throw new Error(`No sync implementation for capability "${key}"`)
}
