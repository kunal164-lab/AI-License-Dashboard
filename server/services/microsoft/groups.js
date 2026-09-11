import { graphGetAllPages } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.groups.label, requiredPermissions: MICROSOFT_CAPABILITIES.groups.permissions }

// Read-only group listing. `resourceProvisioningOptions` is how Graph
// exposes "this Microsoft 365 group also has a Team provisioned on it" —
// selecting it lets a group's own row be flagged is_team, with no separate
// Teams-specific endpoint call and no duplicate row in a second table.
// https://learn.microsoft.com/en-us/graph/api/group-list
// https://learn.microsoft.com/en-us/graph/api/resources/group (resourceProvisioningOptions)
const SELECT = [
  'id', 'displayName', 'description', 'mail', 'mailNickname', 'groupTypes',
  'securityEnabled', 'mailEnabled', 'visibility', 'createdDateTime', 'resourceProvisioningOptions'
].join(',')

export async function fetchGroups(accessToken) {
  return graphGetAllPages(accessToken, `/groups?$select=${SELECT}&$top=999`, CTX)
}
