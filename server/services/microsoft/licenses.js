import { graphGet } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.licenses.label, requiredPermissions: MICROSOFT_CAPABILITIES.licenses.permissions }

// Tenant-level catalog of purchased/assigned SKUs. Per-user assignment
// comes from the `assignedLicenses` field already selected during the Users
// & Directory sync (see users.js) — no extra per-user call needed.
// https://learn.microsoft.com/en-us/graph/api/subscribedsku-list
export async function fetchSubscribedSkus(accessToken) {
  const json = await graphGet(accessToken, '/subscribedSkus', CTX)
  return json.value || []
}
