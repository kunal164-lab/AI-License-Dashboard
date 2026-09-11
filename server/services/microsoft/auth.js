// Azure AD app, client-credentials flow (app-only, no user sign-in) —
// unchanged from the original Microsoft Copilot connector.
export async function getAccessToken({ tenantId, clientId, clientSecret }) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error_description || json.error || 'Failed to acquire Microsoft access token')
  return json.access_token
}
