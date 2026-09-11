// Claude MTD sync orchestrator — closely mirrors server/services/
// freshservice/sync.js's shape (download -> validate -> parse -> normalize
// -> commit, never touching the previous successful dataset until a new
// one is fully valid), with two differences specific to Claude: (1) the
// download is a DIRECT, independent password-protected share-link session
// (see shareLinkAuth.js/shareLinkDownload.js) — it does NOT use Microsoft
// Graph, an Azure AD app permission, or the Microsoft 365 connection at
// all; and (2) a SHA-256 content hash gates whether anything is
// re-imported, since the file is an MTD snapshot that gets REPLACED in
// place — the same file name can appear unchanged day after day, and
// re-processing identical content must be a safe no-op, never a re-import
// (Part 5/9 of the spec this implements).
//
// The ONE intentional touchpoint with Microsoft 365 is a DATA relationship,
// not an access one: after the file is downloaded (independently of
// Microsoft 365 entirely), each row's email is matched against the
// already-synced Microsoft directory to find the canonical person it
// belongs to — see Part 13 of the spec this implements.
import crypto from 'crypto'
import { authenticateShareLink } from './shareLinkAuth.js'
import { downloadFileFromShareLink } from './shareLinkDownload.js'
import { parseCsv } from '../../utils/csv.js'
import { validateClaudeCsv, normalizeClaudeSnapshot } from '../../../src/utils/claudeNormalizer.js'
import * as connectionsRepo from '../../repositories/connectionsRepo.js'
import * as claudeRepo from '../../repositories/claudeRepo.js'
import * as recordsRepo from '../../repositories/recordsRepo.js'
import * as msRepo from '../../repositories/microsoftRepo.js'
import * as syncHistoryRepo from '../../repositories/syncHistoryRepo.js'
import { buildValidEmailSet } from '../../../src/utils/canonicalIdentity.js'

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

// "Manual" (scheduleMinutes falsy) never auto-fires — same convention as
// Freshservice's isDue (server/services/freshservice/sync.js). Claude's
// own default is set to 1440 (daily) when its connection is created (see
// server/index.js), never hourly.
function isDue(conn) {
  const minutes = conn.meta.scheduleMinutes
  if (!minutes) return false
  if (!conn.lastSync) return true
  const elapsedMs = Date.now() - new Date(conn.lastSync).getTime()
  return elapsedMs >= minutes * 60 * 1000
}

async function downloadClaudeMtdCsv(conn) {
  const { shareUrl, fileName } = conn.meta
  if (!shareUrl) throw new Error('No SharePoint/OneDrive folder URL configured for the Claude source.')
  if (!fileName) throw new Error('No file name configured for the Claude source.')
  const password = conn.credentials?.password
  if (!password) {
    throw new Error('No share-link password is configured for the Claude source. Enter the password on the Claude data source page.')
  }
  const session = await authenticateShareLink(shareUrl, password)
  return downloadFileFromShareLink({ shareUrl, fileName, ...session })
}

export async function runClaudeSync(conn, { respectSchedule = false } = {}) {
  if (conn.meta.enabled === false) {
    return { ok: true, body: { connection: connectionsRepo.toSafeView(conn), skipped: true, reason: 'Source is stopped' } }
  }
  if (respectSchedule && !isDue(conn)) {
    return { ok: true, body: { connection: connectionsRepo.toSafeView(conn), skipped: true, reason: 'Not due yet' } }
  }

  const now = new Date().toISOString()
  try {
    const rawText = await downloadClaudeMtdCsv(conn)

    const snapshotHash = sha256(rawText)
    const previous = claudeRepo.latestSuccessfulSnapshot(conn.id)
    if (previous && previous.snapshot_hash === snapshotHash) {
      // Unchanged — record the check, touch last_attempt only. The
      // existing successful dataset (usage_records + snapshot history) is
      // completely untouched.
      claudeRepo.recordSnapshot({
        connectionId: conn.id, snapshotHash, snapshotImportedAt: previous.snapshot_imported_at,
        recordCount: previous.record_count, uniqueUserCount: previous.unique_user_count, status: 'unchanged'
      })
      connectionsRepo.updateConnection(conn.id, { status: 'connected', lastError: null, lastAttempt: now })
      syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: previous.record_count })
      return {
        ok: true,
        body: {
          connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)),
          changed: false,
          message: 'File checked — no changes detected.',
          recordCount: previous.record_count,
          uniqueUserCount: previous.unique_user_count
        }
      }
    }

    const rawRows = parseCsv(rawText)
    const structural = validateClaudeCsv(rawRows)
    if (!structural.valid) throw new Error(structural.reason)

    // Microsoft 365 as the authoritative user directory (Part 13) — a DATA
    // relationship only, looked up AFTER the file is already fully
    // downloaded/parsed independently of Microsoft 365. If no Microsoft
    // directory has been synced yet, every row is simply unmatched (never
    // an access error, never blocks the download itself).
    const msUsers = msRepo.listAllUsers()
    const validEmails = buildValidEmailSet(msUsers)
    const { records, diagnostics } = normalizeClaudeSnapshot(rawRows, { validEmails })
    if (!records.length) {
      throw new Error(`The Claude MTD file was downloaded and parsed, but no rows matched a current Microsoft 365 user (${diagnostics.unmatchedCount} unmatched email(s), ${diagnostics.invalidRows} invalid row(s) out of ${diagnostics.totalRows}).`)
    }

    // Commit — only reached once download, structural validation, parsing
    // and normalization have all fully succeeded, so a failure above never
    // touches the previous successful snapshot or usage_records.
    claudeRepo.recordSnapshot({
      connectionId: conn.id, snapshotHash, snapshotImportedAt: now,
      recordCount: records.length, uniqueUserCount: diagnostics.uniqueUserCount, status: 'success', records
    })
    recordsRepo.replaceRecordsForConnection(conn.id, records.map((r) => ({ ...r, _snapshot_imported_at: now, reporting_type: 'MTD' })))

    connectionsRepo.updateConnection(conn.id, {
      status: 'connected',
      lastError: null,
      lastSync: now,
      lastAttempt: now,
      stats: { users: diagnostics.uniqueUserCount, records: records.length },
      meta: { lastImportSourceType: 'automatic' }
    })
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'success', recordCount: records.length })
    return {
      ok: true,
      body: {
        connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)),
        changed: true,
        message: 'New MTD snapshot imported successfully.',
        recordCount: records.length,
        snapshotImportedAt: now,
        uniqueUserCount: diagnostics.uniqueUserCount,
        unmatchedUserCount: diagnostics.unmatchedCount
      }
    }
  } catch (e) {
    // Stage tag (A-G, Part 6 of the spec this implements) for server-side
    // debugging only — which step failed, never any secret. `e.stage` is
    // set by shareLinkAuth.js (A) / shareLinkDownload.js (B-G); absent for
    // any other kind of failure (e.g. a validation/normalization error).
    if (e.stage) console.log(`[claude-sync] failed at stage ${e.stage}: ${e.message}`)
    // Only lastError/lastAttempt change — stats, lastSync and the stored
    // snapshot/usage_records are left exactly as they were, so the previous
    // successful Claude dataset keeps feeding the dashboard.
    connectionsRepo.updateConnection(conn.id, { status: 'error', lastError: e.message, lastAttempt: now })
    syncHistoryRepo.recordSyncAttempt({ connectionId: conn.id, status: 'error', errorMessage: e.message })
    return {
      ok: false,
      body: {
        connection: connectionsRepo.toSafeView(connectionsRepo.getConnection(conn.id)),
        error: e.message,
        message: 'Refresh failed. Previous successful data is still being used.'
      }
    }
  }
}

export { isDue }
