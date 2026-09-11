import { parseCsv } from '../utils/csv.js'

// Generic OAuth2 authorization-code flow — endpoints are user-supplied per
// connection since Kiro's OAuth app registration lives outside this project.
export function buildAuthUrl({ authorizationUrl, clientId, redirectUri, state, scope }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state })
  if (scope) params.set('scope', scope)
  return `${authorizationUrl}?${params.toString()}`
}

export async function exchangeCode({ tokenUrl, clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) throw new Error(json.error_description || json.error || 'Kiro token exchange failed')
  return json
}

// Fetches the configured API endpoint with either a bearer OAuth token or a
// static API key, and parses JSON or CSV depending on the response.
export async function fetchData({ apiBaseUrl, token, apiKey, headerName }) {
  const headers = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (apiKey) {
    if (headerName) headers[headerName] = apiKey
    else headers['Authorization'] = `Bearer ${apiKey}`
  }
  const res = await fetch(apiBaseUrl, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kiro API error (${res.status}): ${body.slice(0, 300)}`)
  }
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const j = await res.json()
    if (Array.isArray(j)) return j
    if (j && Array.isArray(j.records)) return j.records
    if (j && Array.isArray(j.data)) return j.data
    return [j]
  }
  const text = await res.text()
  return parseCsv(text)
}
