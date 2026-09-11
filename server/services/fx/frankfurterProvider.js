// Frankfurter (https://frankfurter.dev/) — free, unauthenticated, daily
// reference exchange rates sourced from the European Central Bank
// (https://frankfurter.dev/providers/ecb/). No API key, no credentials —
// nothing to store via the app's secret/encryption mechanism. A fixed,
// hardcoded provider URL (never admin-supplied), so this deliberately does
// NOT go through server/utils/urlSafety.js's SSRF guard — that guard
// exists specifically for admin/OAuth-configurable destinations (see its
// own header comment), not fixed code-level constants, exactly like
// server/connectors/github.js's own hardcoded GitHub API URLs.
//
// These are DAILY reference rates, not real-time/intraday — every
// user-facing label referencing this data must say "daily"/"latest
// available", never "real-time" (see server/services/fx/fxService.js and
// src/pages/cost/CostSettings.jsx).
//
// v2's real /rates endpoint (confirmed against the live API and its own
// openapi.json — the docs-implied v1-style /latest?symbols=... shape this
// file originally guessed at returns 404 on v2) takes `base` + `quotes`
// (not `symbols`) and an explicit `providers` filter, and returns an ARRAY
// of one-pair-per-record objects — [{date, base, quote, rate}, ...] — not
// a single object with a `rates` map. Reshaped into the latter internally
// (see fetchLatestRates's return value) so fxService.js's cross-rate math
// never needs to know which provider-version shape produced it.
const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2'
const FETCH_TIMEOUT_MS = 8000

export const FX_PROVIDER_NAME = 'ECB (Frankfurter)'

// Never trusts external JSON blindly (Part 9 of the FX spec this
// implements) — every field is checked before anything downstream reads
// it. Throws with a clear, specific reason rather than letting a malformed
// response silently produce garbage rates.
function validateAndReshape(json, expectedBase) {
  if (!Array.isArray(json)) throw new Error('FX provider response was not an array of rate records')
  if (!json.length) throw new Error('FX provider response contained no rate records')
  const rates = {}
  let date = null
  for (const record of json) {
    if (!record || typeof record !== 'object') throw new Error('FX provider returned a malformed rate record')
    if (typeof record.date !== 'string' || !record.date) throw new Error('FX provider rate record is missing "date"')
    if (typeof record.base !== 'string' || record.base !== expectedBase) throw new Error(`FX provider rate record has an unexpected base currency (expected ${expectedBase})`)
    if (typeof record.quote !== 'string' || !record.quote) throw new Error('FX provider rate record is missing "quote"')
    const n = Number(record.rate)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`FX provider returned an invalid rate for ${record.quote}`)
    date = record.date
    if (record.quote === expectedBase) continue // identity record (base==quote, rate 1) — not needed, caller adds it itself
    rates[record.quote] = n
  }
  if (!date) throw new Error('FX provider response contained no usable date')
  return { date, base: expectedBase, rates }
}

// Fetches the latest ECB reference rates for `base` against `quotes` (an
// array of ISO 4217 codes) — ONE request covers every quote currency,
// never one request per currency/license (Part 3's explicit "no N+1 FX
// calls" requirement). Returns { date, base, rates: {CODE: number} };
// throws with a human-readable message on any network/timeout/HTTP/shape
// failure — callers (fxService.js) are responsible for falling back to the
// last successful stored rate, never for retrying in a loop.
export async function fetchLatestRates(base, quotes) {
  const params = new URLSearchParams({ base, quotes: quotes.join(','), providers: 'ECB' })
  const url = `${FRANKFURTER_BASE_URL}/rates?${params.toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, { signal: controller.signal })
  } catch (e) {
    throw new Error(`Could not reach the FX provider (${e.name === 'AbortError' ? 'request timed out' : e.message})`)
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`FX provider returned HTTP ${res.status}`)
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error('FX provider returned a response that was not valid JSON')
  }
  return validateAndReshape(json, base)
}
