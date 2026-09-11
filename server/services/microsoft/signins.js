import { graphGetAllPages } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.signins.label, requiredPermissions: MICROSOFT_CAPABILITIES.signins.permissions }
const DEFAULT_DAYS = 30
// Hard ceiling regardless of what a connection's settings request — sign-in
// logs can be very high volume, and this capability must never trigger an
// unbounded historical pull.
const MAX_DAYS = 90

// GET /auditLogs/signIns (v1.0) — Entra ID sign-in logs. Requires
// AuditLog.Read.All. Always time-windowed via $filter=createdDateTime ge
// {iso} — never fetched without a lower bound.
// https://learn.microsoft.com/en-us/graph/api/signin-list
export async function fetchSignIns(accessToken, sinceIso) {
  const filter = encodeURIComponent(`createdDateTime ge ${sinceIso}`)
  return graphGetAllPages(accessToken, `/auditLogs/signIns?$filter=${filter}&$top=999`, CTX)
}

// Incremental strategy: never re-walk further back than the last successful
// sync already covered (so Refresh All doesn't re-download the same
// history every time), but never go further back than the configured
// period floor either — shortening the configured period should still take
// effect rather than being permanently pinned to the oldest sync ever run.
export function resolveSinceIso({ configuredDays, latestSyncedIso }) {
  const days = Math.min(Math.max(Number(configuredDays) || DEFAULT_DAYS, 1), MAX_DAYS)
  const periodFloor = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  if (latestSyncedIso && latestSyncedIso > periodFloor) return latestSyncedIso
  return periodFloor
}

export { DEFAULT_DAYS, MAX_DAYS }
