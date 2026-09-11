// Freshservice sync orchestrator — dispatches to one of TWO independent
// ingestion methods, selected per-connection via meta.sourceMethod:
//   'ms_group'    — current members of a configured Microsoft 365 security
//                   group, resolved via Microsoft Graph. Still fully
//                   automatic (Refresh All/manual Refresh both work).
//   'manual_csv'  — a manually-uploaded Freshservice agent export. There is
//                   no automatic sync for this method (see
//                   runFreshserviceSync's dispatch below) — the
//                   SharePoint-CSV automatic method this replaced was
//                   removed entirely (unreliable SharePoint app-only
//                   permissions/authentication; see server/services/
//                   freshservice/sharepoint.js's removal). A different,
//                   genuinely automated Freshservice source is planned for
//                   later — this file is deliberately kept to exactly two
//                   dispatch branches so adding it later means adding one
//                   more branch, not restructuring this module.
// Both borrow the SAME linked Microsoft 365 connection's own credentials
// (never a second Microsoft auth flow, and manual_csv doesn't need Graph at
// all) and both converge on the SAME generic Freshservice product-record
// shape (src/utils/freshserviceNormalizer.js) — never merged together,
// never double-counted; exactly one method is active per connection.
import * as connectionsRepo from '../../repositories/connectionsRepo.js'
import * as recordsRepo from '../../repositories/recordsRepo.js'
import * as syncHistoryRepo from '../../repositories/syncHistoryRepo.js'
import * as msRepo from '../../repositories/microsoftRepo.js'
import { fetchGroupMemberIds } from './graphGroup.js'
import {
  toFreshserviceProductRecordsFromGroup,
  buildFreshserviceAgentImport,
  validateFreshserviceCsv
} from '../../../src/utils/freshserviceNormalizer.js'
import { buildValidEmailSet } from '../../../src/utils/canonicalIdentity.js'

// The fields each source method owns in a Freshservice connection's meta —
// used by upsertFreshserviceConnection to null out the OTHER method's
// fields whenever the administrator (re)configures Freshservice, so
// switching methods never leaves stale config from the previously
// selected method mixed into meta ("only the currently selected source
// method is the active source of truth"). manual_csv has no method-owned
// config fields of its own (just the uploaded data itself).
const METHOD_OWN_FIELDS = {
  ms_group: ['securityGroupName', 'securityGroupId'],
  manual_csv: []
}

// Freshservice is a singleton-per-app connection: exactly ONE connection
// per configured source method, ever (Part 4 — "do not create duplicate
// records when the user reconnects the same source"). Every OTHER
// provider's create flow is genuinely multi-account (a user can add
// several GitHub/Kiro accounts), so a plain "always insert" was correct
// there but wrong here.
export function upsertFreshserviceConnection({ label, authType, meta }) {
  const existing = connectionsRepo.listConnections('freshservice')[0]
  const otherMethod = meta.sourceMethod === 'manual_csv' ? 'ms_group' : 'manual_csv'
  const clearedMeta = { ...meta }
  for (const field of METHOD_OWN_FIELDS[otherMethod]) clearedMeta[field] = null

  if (existing) {
    // Reconfiguring (same or different method) invalidates whatever the
    // PREVIOUS config's stats meant — reset to 0 so a failed sync under
    // the new config never leaves the old config's agent count on
    // display looking like it still applies. The immediately-following
    // runSync call overwrites this with the real result either way.
    return {
      connection: connectionsRepo.updateConnection(existing.id, { label, meta: clearedMeta, stats: { users: 0, records: 0 } }),
      created: false
    }
  }
  return {
    connection: connectionsRepo.createConnection({ source: 'freshservice', kind: 'api', label, authType, credentials: {}, meta: clearedMeta }),
    created: true
  }
}

function requireLinkedMicrosoftConnection(conn) {
  const msConn = conn.meta.msConnectionId ? connectionsRepo.getConnection(conn.meta.msConnectionId) : null
  if (!msConn || msConn.source !== 'microsoft') {
    throw new Error('Microsoft 365 connection is required for Freshservice.')
  }
  if (msConn.status !== 'connected') {
    throw new Error('Microsoft 365 connection is required for Freshservice, and the linked connection is not currently connected. Reconnect Microsoft 365, then refresh Freshservice.')
  }
  return msConn
}

async function runFreshserviceGroupSync(conn, startedAt) {
  const msConn = requireLinkedMicrosoftConnection(conn)
  if (!conn.meta.securityGroupId) {
    throw new Error('No Microsoft 365 security group configured for this Freshservice source.')
  }

  // 1. Current members of the configured group (real Microsoft Graph group
  // membership — never inferred from email domain, department, job title,
  // license, or any other provider's own data).
  const memberIds = await fetchGroupMemberIds(msConn.credentials, conn.meta.securityGroupId)
  // 2. Resolve each member to the EXISTING canonical Microsoft user
  // (already SSP-company-filtered at Microsoft sync time — see
  // microsoftRepo.js#isSspCompany) — a group member who isn't in that
  // population is never treated as a Freshservice agent, and no duplicate/
  // standalone user record is ever created for them.
  const resolvedUsers = []
  for (const msId of memberIds) {
    const user = msRepo.getUserByMsId(msId)
    if (user) resolvedUsers.push(user)
  }

  const records = toFreshserviceProductRecordsFromGroup(resolvedUsers)
  // 3. Commit — only reached once every step above has fully succeeded.
  recordsRepo.replaceRecordsForConnection(conn.id, records)
  finalizeSuccess(conn, records.length, startedAt, { memberMsIds: resolvedUsers.map((u) => u.ms_id) })
  return { agentCount: records.length, unmatchedCount: memberIds.length - resolvedUsers.length }
}

function finalizeSuccess(conn, recordCount, startedAt, extraMeta = {}) {
  const now = new Date().toISOString()
  connectionsRepo.updateConnection(conn.id, {
    status: 'connected',
    lastError: null,
    lastSync: now,
    lastAttempt: now,
    stats: { users: recordCount, records: recordCount },
    meta: { lastSyncDurationMs: Date.now() - startedAt, ...extraMeta }
  })
  syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount })
}

// Called by: the initial POST /api/connections (to give instant pass/fail
// feedback), the per-connection "Refresh" button, and Refresh All. For
// manual_csv there is nothing to automatically refresh — this returns a
// clean "skipped" result (Part 19: "Refresh All must NOT attempt to
// refresh Freshservice from SharePoint... may simply skip Freshservice as
// a manual source") rather than erroring or silently doing nothing.
export async function runFreshserviceSync(conn) {
  if (conn.meta.enabled === false) {
    return { ok: true, body: { connection: connectionsRepo.toSafeView(conn), skipped: true, reason: 'Source is stopped' } }
  }
  if (conn.meta.sourceMethod === 'manual_csv') {
    return { ok: true, body: { connection: connectionsRepo.toSafeView(conn), skipped: true, reason: 'Manual import required' } }
  }

  const startedAt = Date.now()
  try {
    const result = await runFreshserviceGroupSync(conn, startedAt)
    return { ok: true, body: { connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), ...result } }
  } catch (e) {
    // Only lastError/lastAttempt change here — stats, lastSync and the
    // previously stored agent membership are left completely untouched, so
    // a temporary Graph failure can never wipe the last successful
    // Freshservice agent list.
    connectionsRepo.updateConnection(conn.id, {
      status: 'error',
      lastError: e.message,
      lastAttempt: new Date().toISOString(),
      meta: { lastSyncDurationMs: Date.now() - startedAt }
    })
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: e.throttled ? 'throttled' : 'error', errorMessage: e.message })
    return { ok: false, body: { connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)), error: e.message } }
  }
}

// Manual CSV upload (Data Sources → Freshservice, manual_csv method) — the
// dashboard's current, only-supported Freshservice ingestion path besides
// the Microsoft 365 security group. Full safe-import pipeline (Part 15):
// validate -> normalize -> filter User Type=Agent -> normalize email ->
// deduplicate -> match canonical Microsoft users -> ONLY THEN commit. A
// failed/invalid file never touches the previously successful dataset —
// nothing is written until buildFreshserviceAgentImport has fully resolved
// the final record set.
export function importFreshserviceCsv(conn, rawRows, fileName) {
  const validation = validateFreshserviceCsv(rawRows)
  if (!validation.valid) {
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'error', errorMessage: `Manual CSV rejected: ${validation.reason}` })
    return { ok: false, error: 'Invalid Freshservice CSV', reason: validation.reason }
  }

  const { records, diagnostics } = buildFreshserviceAgentImport(rawRows, { validEmails: buildValidEmailSet(msRepo.listAllUsers()) })
  recordsRepo.replaceRecordsForConnection(conn.id, records)

  const now = new Date().toISOString()
  const manualImport = { fileName: fileName || 'upload.csv', importedAt: now, ...diagnostics }
  connectionsRepo.updateConnection(conn.id, {
    status: 'connected',
    lastError: null,
    lastSync: now,
    lastAttempt: now,
    stats: { users: diagnostics.matchedCount, records: diagnostics.matchedCount },
    meta: { lastImportSourceType: 'manual_csv', lastManualImport: manualImport }
  })
  syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: diagnostics.matchedCount })
  return { ok: true, recordCount: diagnostics.matchedCount, diagnostics }
}
