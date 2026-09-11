import { graphGetAllPages, graphBatch } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.users.label, requiredPermissions: MICROSOFT_CAPABILITIES.users.permissions }

// Fields confirmed on the Graph `user` resource. `manager` is deliberately
// NOT expanded here — Graph's support for $expand=manager on the *list*
// endpoint (vs. a single user) is limited/inconsistent, and guessing at an
// unverified query shape would risk a silent partial failure — manager is
// instead fetched via its own batched per-user call, see fetchManagers()
// below. `onPremisesExtensionAttributes` is the complex-type property that
// carries extensionAttribute1-15 — VBU's ONLY source (User.VBU ==
// extensionAttribute3, per this tenant's Entra ID configuration); it's a
// normal $select-able property on /users, not something requiring $expand.
// assignedPlans is the per-user, already-merged-across-every-SKU view of
// which service plans are Enabled/Disabled/PendingActivation for this
// specific person — distinct from assignedLicenses (SKU-level: skuId +
// disabledPlans) and from subscribedSkus[].servicePlans (the tenant-wide
// per-SKU catalog, identical for every holder of that SKU). Needed to
// determine a user's REAL current Copilot service-plan status rather than
// just "this SKU is assigned" — see server/services/microsoft/
// copilotEntitlement.js. Gated by the same User.Read.All permission
// already required for this whole capability — not a new permission.
const SELECT = [
  'id', 'displayName', 'givenName', 'surname', 'userPrincipalName', 'mail',
  'accountEnabled', 'department', 'jobTitle', 'officeLocation', 'companyName',
  'employeeId', 'usageLocation', 'assignedLicenses', 'assignedPlans', 'onPremisesExtensionAttributes'
].join(',')

export async function fetchUsers(accessToken) {
  return graphGetAllPages(accessToken, `/users?$select=${SELECT}&$top=999`, CTX)
}

// Batched (not one-request-per-user) manager lookup — a real tenant can
// have thousands of users, so a sequential per-user loop here would be
// exactly the N+1 problem this must avoid. A 404 sub-response is Graph's
// normal, valid "this user has no manager assigned" outcome (not an error);
// a user whose lookup doesn't come back cleanly this run (still-throttled
// after retries, or any other failure) is simply absent from the returned
// map — callers must treat "absent" as "not resolved this run" and leave
// any previously-stored manager value alone, never overwrite it with null.
const MANAGER_SELECT = 'id,displayName,mail,userPrincipalName'

export async function fetchManagers(accessToken, userIds) {
  const requests = userIds.map((id) => ({ id, url: `/users/${id}/manager?$select=${MANAGER_SELECT}` }))
  const responses = await graphBatch(accessToken, requests, CTX)
  const result = new Map()
  for (const [id, { status, body }] of responses) {
    if (status === 404) { result.set(id, null); continue } // confirmed: no manager assigned
    if (status >= 200 && status < 300 && body) {
      result.set(id, { displayName: body.displayName || null, upn: body.userPrincipalName || body.mail || null })
    }
    // any other status (403 permission issue, unexpected error, etc.) is
    // left unresolved for this user rather than guessed at
  }
  return result
}
