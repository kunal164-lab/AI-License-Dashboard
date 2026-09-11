export function buildAuthUrl({ clientId, redirectUri, state, scope }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || 'read:org',
    state
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export async function exchangeCode({ clientId, clientSecret, code }) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error_description || json.error)
  return json.access_token
}

export async function fetchAuthenticatedUser(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error('Failed to fetch GitHub user: ' + res.status)
  return res.json()
}

// Real GitHub Copilot Business/Enterprise seat-assignment API — gives one
// row per licensed user with their last activity, which is what a per-user
// license dashboard needs (the aggregate /copilot/metrics endpoint only
// gives org-wide daily totals, not per-user breakdowns).
export async function fetchCopilotSeats(token, { org, enterprise }) {
  const scopePath = org ? `orgs/${encodeURIComponent(org)}` : `enterprises/${encodeURIComponent(enterprise)}`
  const seats = []
  let page = 1
  while (true) {
    const res = await fetch(`https://api.github.com/${scopePath}/copilot/billing/seats?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub Copilot seats API error (${res.status}): ${body.slice(0, 200)}`)
    }
    const json = await res.json()
    const batch = json.seats || []
    seats.push(...batch)
    if (batch.length < 100) break
    page++
    if (page > 50) break
  }
  return seats.map((s) => ({
    github_id: s.assignee && s.assignee.id,
    login: s.assignee && s.assignee.login,
    organization: org || enterprise,
    created_at: s.created_at,
    last_activity: s.last_activity_at,
    last_activity_editor: s.last_activity_editor,
    pending_cancellation_date: s.pending_cancellation_date,
    plan_type: s.plan_type
  }))
}
