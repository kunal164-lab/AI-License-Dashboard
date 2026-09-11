// Microsoft Graph security-group lookup/membership — used ONLY by the
// Freshservice re-architecture (Part 4/5 of the spec this implements):
// Freshservice has no API/credentials of its own, so this borrows the
// linked Microsoft 365 connection's own client-credentials token
// (services/microsoft/auth.js#getAccessToken) and the shared Graph HTTP
// layer (services/microsoft/graphClient.js) — no new auth framework.
import { getAccessToken } from '../microsoft/auth.js'
import { graphGetAllPages } from '../microsoft/graphClient.js'

const CTX = { capabilityLabel: 'Freshservice (Microsoft 365 security group)', requiredPermissions: ['GroupMember.Read.All (Application)'] }

// Escapes the one character that matters inside a Graph OData string
// literal ($filter=displayName eq '...') — a literal single quote is
// doubled, per OData syntax.
function escapeODataString(value) {
  return String(value).replace(/'/g, "''")
}

// Resolves a security group by its exact display name. Returns every match
// — the caller (server/index.js's connection-create route) decides what to
// do with 0/1/many results; this never guesses which one the admin meant.
export async function findGroupsByDisplayName(credentials, displayName) {
  const accessToken = await getAccessToken(credentials)
  const filter = `displayName eq '${escapeODataString(displayName)}'`
  const groups = await graphGetAllPages(accessToken, `/groups?$filter=${encodeURIComponent(filter)}&$select=id,displayName,description`, CTX)
  return groups.map((g) => ({ id: g.id, displayName: g.displayName, description: g.description || null }))
}

// Members of a security group, resolved to just the real Graph user id —
// /members returns heterogeneous directoryObjects (users, groups, devices,
// service principals for some group types); only #microsoft.graph.user
// entries are ever treated as a Freshservice agent candidate. Each user id
// is then matched against the already-synced microsoft_users table by the
// caller (services/freshservice/sync.js) — never a second identity system.
export async function fetchGroupMemberIds(credentials, groupId) {
  const accessToken = await getAccessToken(credentials)
  const members = await graphGetAllPages(accessToken, `/groups/${encodeURIComponent(groupId)}/members?$select=id,userPrincipalName`, CTX)
  return members.filter((m) => m['@odata.type'] === '#microsoft.graph.user').map((m) => m.id)
}
