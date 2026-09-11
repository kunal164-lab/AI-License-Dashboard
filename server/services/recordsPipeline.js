// The one place every server-side cost/license computation should get its
// starting flat record set from. Applies Microsoft's real license-
// assignment enrichment (copilotEnrichment.js — cross-references the
// synced Users & Directory / Licenses capability against each Copilot
// usage record) to every Microsoft Copilot record before anything else
// touches it, so license_status/cost/coverage are always based on real
// Graph license data, never silently skipped.
//
// /api/dashboard (server/index.js) already applies this same enrichment
// inline (it needs a per-connection-keyed shape this flat helper doesn't
// produce, so it isn't switched to call this) — but /api/cost/summary,
// /api/cost/missing and costAnalytics.js's buildCostDataset all used to
// read records directly from recordsRepo without it, meaning Cost
// Analytics never saw which Copilot usage-report users had since lost
// their license. This is the fix: one shared function all of them call.
import * as connectionsRepo from '../repositories/connectionsRepo.js'
import * as recordsRepo from '../repositories/recordsRepo.js'
import * as msRepo from '../repositories/microsoftRepo.js'
import { enrichCopilotRecords, excludeUnlicensedCopilotUsage } from './microsoft/copilotEnrichment.js'

export function getAllEnrichedRecords() {
  const connections = connectionsRepo.listConnections()
  const flat = []
  for (const conn of connections) {
    let records = recordsRepo.getRecordsForConnection(conn.id)
    if (conn.source === 'microsoft') {
      const users = msRepo.listUsers(conn.id)
      const licenses = msRepo.listLicenses(conn.id)
      const enriched = enrichCopilotRecords(records.filter((r) => r.product === 'Microsoft Copilot'), { users, licenses })
      let i = 0
      records = records.map((r) => (r.product === 'Microsoft Copilot' ? enriched[i++] : r))
      // Current-license population, not "appeared in the usage report" —
      // see excludeUnlicensedCopilotUsage's own comment.
      records = excludeUnlicensedCopilotUsage(records)
    }
    flat.push(...records)
  }
  return flat
}
