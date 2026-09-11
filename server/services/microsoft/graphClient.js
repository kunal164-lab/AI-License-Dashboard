// Thin, shared Microsoft Graph HTTP layer: consistent error messages,
// @odata.nextLink pagination, and 429 retry/backoff — used by every
// capability module (copilot, users, devices, applications, licenses) so
// none of them re-implement this.
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
// A 429 is retried up to MAX_RETRIES times: Retry-After is honored when
// Graph sends one; otherwise a controlled exponential backoff (2^attempt
// seconds) is used instead of guessing a flat delay. Both are capped at
// MAX_RETRY_DELAY_SEC so a bad Retry-After value can't stall a sync for
// minutes. If throttling persists past MAX_RETRIES, the request fails with
// a distinguishable "throttled" error (e.throttled === true) rather than a
// generic one, so callers can report status:"throttled" instead of
// status:"error" and know not to treat it as a permission/config problem.
const MAX_RETRIES = 4
const MAX_RETRY_DELAY_SEC = 30

// Status-code-specific, capability-aware messages. Never includes the token
// or Authorization header — the Graph error body itself never contains
// caller credentials, so it's safe to surface as-is.
//
// IMPORTANT: a 403 does NOT always mean "permission not admin-consented" —
// it can also mean a Conditional Access policy, a licensing/service-plan
// restriction, a delegated-vs-application permission mismatch, or something
// else entirely. This function surfaces Microsoft's OWN error code/message
// (parsed from the response body) rather than assuming a cause, so a real
// 403 is never silently rewritten into a guess that happens to be wrong.
// The required-permission list is included only as context for what the
// capability normally needs, not as a claim about why THIS request failed.
export function graphErrorMessage(status, bodyText, { capabilityLabel, requiredPermissions } = {}) {
  const snippet = (bodyText || '').slice(0, 300)
  let graphCode = null
  let graphDetail = null
  try {
    const parsed = JSON.parse(bodyText || '')
    if (parsed && parsed.error) {
      graphCode = parsed.error.code || null
      graphDetail = parsed.error.message || null
    }
  } catch (e) {
    // Body wasn't JSON (e.g. an HTML error page from a proxy) — fall back
    // to the raw snippet below.
  }
  const label = capabilityLabel ? `${capabilityLabel}: ` : ''
  const perms = (requiredPermissions || []).join(', ')

  if (status === 401) return `${label}Microsoft authentication/token is invalid or expired.`
  if (status === 403) {
    const detail = graphDetail || snippet || 'no detail returned by Graph'
    const codePart = graphCode ? ` (${graphCode})` : ''
    return `${label}Microsoft Graph denied this request with 403${codePart}: ${detail}.${perms ? ` This capability normally requires: ${perms} — verify that permission is an Application permission (not Delegated) with admin consent granted to THIS exact app registration.` : ''}`
  }
  if (status === 404) return `${label}Microsoft Graph endpoint or resource not found.` + (snippet ? ` (${snippet})` : '')
  if (status === 429) return `${label}Microsoft Graph throttling. Retry later.`
  if (status >= 500) return `${label}Microsoft Graph service error.`
  if (status === 400) return `${label}Microsoft Graph error (400): ${graphDetail || snippet}`
  return `${label}Microsoft Graph error (${status}): ${graphDetail || snippet}`
}

function throttledError(url) {
  const err = new Error(`Microsoft Graph throttling persisted after ${MAX_RETRIES} retries.`)
  err.throttled = true
  err.url = url
  return err
}

// Same Retry-After-first, exponential-backoff-else, capped-at-30s policy as
// fetchWithRetry — extracted so graphBatch can apply it per FAILED
// SUB-REQUEST (a $batch call can 429 as a whole, or an individual
// sub-response inside an otherwise-200 batch can itself be a 429; both need
// the same treatment, not just the outer HTTP call).
async function backoffDelay(attempt, retryAfterHeader) {
  const delaySec = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? Math.min(retryAfterHeader, MAX_RETRY_DELAY_SEC)
    : Math.min(2 ** attempt, MAX_RETRY_DELAY_SEC)
  await new Promise((resolve) => setTimeout(resolve, delaySec * 1000))
}

async function fetchWithRetry(url, accessToken, accept, attempt = 0) {
  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: accept } })
  } catch (e) {
    throw new Error('Network failure while calling Microsoft Graph: ' + (e.message || 'unknown error'))
  }
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw throttledError(url)
    const retryAfterHeader = Number(res.headers.get('retry-after'))
    const delaySec = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? Math.min(retryAfterHeader, MAX_RETRY_DELAY_SEC)
      : Math.min(2 ** attempt, MAX_RETRY_DELAY_SEC) // exponential backoff when Graph gives no Retry-After
    // Diagnostic only — no token, no secret, no request body.
    console.log(`[microsoft-graph] 429 throttled, retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000))
    return fetchWithRetry(url, accessToken, accept, attempt + 1)
  }
  return res
}

function toUrl(pathOrUrl) {
  return pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`
}

// Raw response — used by the Copilot report endpoints, which can return CSV
// or JSON depending on the tenant and aren't a standard {value:[...]} page.
export async function graphFetchRaw(accessToken, pathOrUrl, ctx = {}) {
  const res = await fetchWithRetry(toUrl(pathOrUrl), accessToken, 'application/json, text/csv')
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(graphErrorMessage(res.status, bodyText, ctx))
  }
  return res
}

// Single JSON resource (not a paged collection), e.g. /subscribedSkus.
export async function graphGet(accessToken, pathOrUrl, ctx = {}) {
  const res = await fetchWithRetry(toUrl(pathOrUrl), accessToken, 'application/json')
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(graphErrorMessage(res.status, bodyText, ctx))
  }
  return res.json()
}

// Follows @odata.nextLink until every page has been retrieved — never
// assumes a single response contains the full collection.
export async function graphGetAllPages(accessToken, pathOrUrl, ctx = {}) {
  let url = toUrl(pathOrUrl)
  const out = []
  while (url) {
    const res = await fetchWithRetry(url, accessToken, 'application/json')
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new Error(graphErrorMessage(res.status, bodyText, ctx))
    }
    const json = await res.json()
    if (Array.isArray(json.value)) out.push(...json.value)
    url = json['@odata.nextLink'] || null
  }
  return out
}

const BATCH_SIZE = 20 // Microsoft Graph's documented per-$batch-call limit
const MAX_SUBREQUEST_RETRIES = 4

// Microsoft Graph's real POST /$batch endpoint — used where a per-item
// GET (e.g. one /users/{id}/manager call per user) would be a real N+1
// problem at real tenant scale (thousands of users). `requests` is
// [{id, method, url}, ...] (url relative, e.g. '/users/abc/manager'); the
// outer POST can itself 429, and — separately — any individual sub-response
// inside an otherwise-200 batch can also carry its own 429 status, so both
// are retried here (up to MAX_SUBREQUEST_RETRIES each) rather than only
// retrying the whole batch. Returns Map<requestId, {status, body}> — a
// sub-request that still fails after retries is simply left OUT of the map
// (never given a fabricated status), so callers can treat "absent from the
// map" as "not resolved this run" and leave any previously-stored value
// alone instead of overwriting it with a guess.
export async function graphBatch(accessToken, requests, ctx = {}) {
  const results = new Map()
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const chunk = requests.slice(i, i + BATCH_SIZE)
    await runBatchChunk(accessToken, chunk, ctx, results, 0)
  }
  return results
}

async function runBatchChunk(accessToken, chunk, ctx, results, attempt) {
  if (!chunk.length) return
  let res
  try {
    res = await fetch(toUrl('/$batch'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: chunk.map((r) => ({ id: r.id, method: r.method || 'GET', url: r.url })) })
    })
  } catch (e) {
    throw new Error('Network failure while calling Microsoft Graph $batch: ' + (e.message || 'unknown error'))
  }
  if (res.status === 429) {
    if (attempt >= MAX_SUBREQUEST_RETRIES) return // give up on this chunk only — callers treat missing ids as "not resolved this run"
    await backoffDelay(attempt, Number(res.headers.get('retry-after')))
    return runBatchChunk(accessToken, chunk, ctx, results, attempt + 1)
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(graphErrorMessage(res.status, bodyText, ctx))
  }
  const json = await res.json()
  const byId = new Map(chunk.map((r) => [r.id, r]))
  const retry = []
  for (const sub of json.responses || []) {
    if (sub.status === 429) { retry.push(byId.get(sub.id)); continue }
    results.set(sub.id, { status: sub.status, body: sub.body })
  }
  if (retry.length && attempt < MAX_SUBREQUEST_RETRIES) {
    await backoffDelay(attempt, null)
    await runBatchChunk(accessToken, retry, ctx, results, attempt + 1)
  }
}
