import { parseCsv } from '../../utils/csv.js'
import { graphFetchRaw } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const V1_PERIODS = ['D7', 'D30', 'D90', 'D180', 'ALL']
const V2_PERIODS = ['D7', 'D28', 'D90', 'D180', 'ALL']
const DEFAULT_PERIOD = 'D7'
const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.copilot.label, requiredPermissions: MICROSOFT_CAPABILITIES.copilot.permissions }

// Microsoft Graph Copilot usage reports live under the /copilot segment —
// NOT under the general /reports root. Calling
//   /v1.0/reports/getMicrosoft365CopilotUsageUserDetail(...)
// returns a 400 "Resource not found for the segment" error; the correct
// path is:
//   /v1.0/copilot/reports/getMicrosoft365CopilotUsageUserDetail(...)
// See: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail
//
// Requires Reports.Read.All (application permission, admin consent).
// Returns CSV by default; some tenants/clients may receive JSON depending on
// the Accept header, so both are handled.
export async function fetchCopilotUsage(accessToken, { period, version = 'v1' } = {}) {
  const allowedPeriods = version === 'v2' ? V2_PERIODS : V1_PERIODS
  const resolvedPeriod = allowedPeriods.includes(period) ? period : DEFAULT_PERIOD
  const res = await graphFetchRaw(accessToken, `/copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='${resolvedPeriod}')`, CTX)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await res.json()
    if (Array.isArray(json)) return json
    if (json && Array.isArray(json.value)) return json.value
    return []
  }
  return parseCsv(await res.text())
}

// Copilot-enabled/active user count summary for a given period. Not used to
// populate per-user records (the user-detail report above already gives a
// reliable per-user total/active count), but kept available as a small,
// independent cross-check or future KPI source.
export async function fetchUserCountSummary(accessToken, { period } = {}) {
  const resolvedPeriod = V1_PERIODS.includes(period) ? period : DEFAULT_PERIOD
  const res = await graphFetchRaw(accessToken, `/copilot/reports/getMicrosoft365CopilotUserCountSummary(period='${resolvedPeriod}')`, CTX)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return parseCsv(await res.text())
}

// User-count trend over time — a real time series (unlike the user-detail
// snapshot above), useful for a future "usage trend" chart. Not consumed by
// sync.js yet; kept available for that future work.
export async function fetchUserCountTrend(accessToken, { period } = {}) {
  const resolvedPeriod = V1_PERIODS.includes(period) ? period : DEFAULT_PERIOD
  const res = await graphFetchRaw(accessToken, `/copilot/reports/getMicrosoft365CopilotUserCountTrend(period='${resolvedPeriod}')`, CTX)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return parseCsv(await res.text())
}
