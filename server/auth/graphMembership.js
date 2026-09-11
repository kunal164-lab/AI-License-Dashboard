// Microsoft Graph's purpose-built "is this specific user a member of these
// specific groups" check — used ONLY for authorization (server/auth/
// authorize.js), never for data sync. Deliberately reuses the EXISTING
// Microsoft 365 connection's own APPLICATION (client-credentials)
// permissions (server/services/microsoft/auth.js#getAccessToken) — never
// the signed-in human's own delegated token, and never a second Microsoft
// credential store (Part 13 of the auth spec: keep human SSO and the
// backend's data-sync Graph app strictly separate, but let authorization
// checks borrow the latter's existing permissions the same way
// Freshservice's group-membership sync already does).
import { getAccessToken } from '../services/microsoft/auth.js'
import { graphErrorMessage } from '../services/microsoft/graphClient.js'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const CTX = { capabilityLabel: 'Application access (security group membership check)', requiredPermissions: ['GroupMember.Read.All or Directory.Read.All (Application)'] }
// Microsoft Graph's documented per-call limit for checkMemberGroups'
// groupIds array.
const CHUNK_SIZE = 20

// Returns the subset of `groupIds` (Entra group ids) that `userId` (an
// Entra user object id) currently belongs to, including nested/transitive
// membership — Graph's own answer to exactly this question, chosen over
// fetching every configured group's full member list (which would be a
// real N+1 at this app's real tenant scale).
export async function checkMemberGroups(credentials, userId, groupIds) {
  if (!groupIds || !groupIds.length) return []
  const accessToken = await getAccessToken(credentials)
  const matched = []
  for (let i = 0; i < groupIds.length; i += CHUNK_SIZE) {
    const chunk = groupIds.slice(i, i + CHUNK_SIZE)
    let res
    try {
      res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userId)}/checkMemberGroups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: chunk })
      })
    } catch (e) {
      throw new Error('Network failure while calling Microsoft Graph: ' + (e.message || 'unknown error'))
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new Error(graphErrorMessage(res.status, bodyText, CTX))
    }
    const json = await res.json()
    matched.push(...(json.value || []))
  }
  return matched
}
