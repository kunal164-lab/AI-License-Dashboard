// Centralized FX orchestration — the ONE place currency-conversion rates
// are fetched from an external provider, cached, and read from for use.
// Every consumer (Cost Engine, Cost Settings UI, reports) goes through
// this file (for refresh/status) or the existing exchangeRateRepo it
// writes into (for the actual rate rows costEngine.js#convert already
// reads) — never a second, duplicated currency-conversion implementation.
import * as exchangeRateRepo from '../../repositories/exchangeRateRepo.js'
import * as settingsRepo from '../../repositories/settingsRepo.js'
import { fetchLatestRates, FX_PROVIDER_NAME } from './frankfurterProvider.js'

export { FX_PROVIDER_NAME }

// Every currency this app's dropdowns offer is populated from this list —
// not scattered hardcoded strings across the UI (Part 3: "the currency
// dropdown should be driven by the supported-currency list rather than
// scattered hardcoded strings"). Matches the existing frontend list
// (src/utils/currency.js, now sourced from GET /api/fx/currencies instead
// of its own copy) so switching to automatic FX never regresses a
// currency an admin could already price a license in. Frankfurter/ECB
// itself supports many more (30+ real ECB-tracked currencies) — add to
// this one list, never a second hardcoded dropdown, when this app needs
// to price/report in another one.
export const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AUD', 'NZD', 'CAD']

const REFRESH_META_KEY = 'fx_last_refresh'
const RETRY_COOLDOWN_MS = 60 * 60 * 1000 // don't hammer the provider during an outage (Part 9)

function nowIso() { return new Date().toISOString() }
function today(d = new Date()) { return d.toISOString().slice(0, 10) }

export function getRefreshMeta() {
  const raw = settingsRepo.getSetting(REFRESH_META_KEY)
  const empty = { lastAttemptAt: null, lastAttemptDate: null, status: null, rateDate: null, error: null }
  if (!raw) return empty
  try {
    return { ...empty, ...JSON.parse(raw) }
  } catch {
    return empty
  }
}

function setRefreshMeta(patch) {
  settingsRepo.setSetting(REFRESH_META_KEY, JSON.stringify({ ...getRefreshMeta(), ...patch }))
}

// A rate row is a manual override if its source is anything OTHER than
// this provider's own label — matches exchangeRateRepo.setRate()'s
// existing 'Admin configured' default for a rate saved with no explicit
// source (the only way a rate is set today outside this service). An
// automatic refresh must NEVER silently overwrite one (Part 4: "Do NOT
// silently mix manually entered and automatic rates" — the override stays
// in effect until an admin explicitly deletes/replaces it).
export function isManualOverride(existingRow) {
  return !!existingRow && existingRow.source !== FX_PROVIDER_NAME
}

// Cross-derives every ordered pair among SUPPORTED_CURRENCIES from ONE
// EUR-based response — Frankfurter's rates are relative to whatever `base`
// you request, but this never assumes the response is USD-based or that
// the ONE currency this app happens to be converting right now is the only
// pair worth deriving (Part 3: "If the provider uses EUR as the base,
// correctly derive the cross-rate... do not assume the provider's response
// is directly USD-based").
// `eurRates`: {CODE: eurToCodeRate} — must include every SUPPORTED_CURRENCIES
// entry (EUR itself = 1).
export function deriveCrossRates(eurRates) {
  const pairs = []
  for (const from of SUPPORTED_CURRENCIES) {
    for (const to of SUPPORTED_CURRENCIES) {
      if (from === to) continue
      const fromPerEur = eurRates[from]
      const toPerEur = eurRates[to]
      if (!fromPerEur || !toPerEur) continue
      // 1 EUR = fromPerEur `from` = toPerEur `to`  =>  1 `from` = (toPerEur / fromPerEur) `to`
      pairs.push({ base: from, target: to, rate: toPerEur / fromPerEur })
    }
  }
  return pairs
}

// Fetches the latest rates and writes every non-overridden pair into
// exchange_rates — skipped entirely if today's refresh already succeeded,
// or if the last attempt (success or failure) was too recent, unless
// `force` (the admin's "Refresh FX Rates" button) is set. This is what
// guarantees the provider is called at most a handful of times per day,
// never once per license/user/page-load (Part 3's explicit "no N+1 FX
// calls" requirement) and never repeatedly during an outage (Part 9).
export async function refreshRates({ force = false } = {}) {
  const now = new Date()
  const meta = getRefreshMeta()
  const alreadySucceededToday = meta.status === 'ok' && meta.lastAttemptDate === today(now)
  const recentlyAttempted = meta.lastAttemptAt && (now.getTime() - new Date(meta.lastAttemptAt).getTime()) < RETRY_COOLDOWN_MS

  if (!force && (alreadySucceededToday || recentlyAttempted)) {
    return { ok: meta.status === 'ok', skipped: true, reason: alreadySucceededToday ? 'Already refreshed today' : 'Refreshed recently — will retry later', meta }
  }

  try {
    const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== 'EUR')
    const { date, rates } = await fetchLatestRates('EUR', symbols)
    const eurRates = { EUR: 1, ...rates }
    const missing = SUPPORTED_CURRENCIES.filter((c) => !(c in eurRates))
    if (missing.length) throw new Error(`FX provider did not return a rate for: ${missing.join(', ')}`)

    let written = 0
    for (const pair of deriveCrossRates(eurRates)) {
      const existing = exchangeRateRepo.getRate(pair.base, pair.target)
      if (isManualOverride(existing)) continue
      exchangeRateRepo.setRate({ baseCurrency: pair.base, targetCurrency: pair.target, rate: pair.rate, rateDate: date, source: FX_PROVIDER_NAME })
      written++
    }

    setRefreshMeta({ lastAttemptAt: nowIso(), lastAttemptDate: today(now), status: 'ok', rateDate: date, error: null })
    return { ok: true, skipped: false, ratesWritten: written, rateDate: date }
  } catch (e) {
    setRefreshMeta({ lastAttemptAt: nowIso(), lastAttemptDate: today(now), status: 'error', error: e.message })
    return { ok: false, skipped: false, error: e.message }
  }
}

// Health status for the Cost Settings UI (Part 4):
//  'healthy'               — today's automatic refresh has succeeded.
//  'using_last_successful' — today's attempt failed (or hasn't run yet),
//                            but an earlier successful auto rate exists;
//                            costEngine.js#convert already uses whatever
//                            row is stored regardless, so this is purely a
//                            status LABEL, not a second conversion path.
//  'unavailable'           — no successful automatic rate has ever been
//                            stored for any supported pair.
export function getFxStatus() {
  const meta = getRefreshMeta()
  const hasAnyAutoRate = exchangeRateRepo.listRates().some((r) => r.source === FX_PROVIDER_NAME)
  const status = meta.status === 'ok' ? 'healthy' : (hasAnyAutoRate ? 'using_last_successful' : 'unavailable')
  return {
    status,
    provider: FX_PROVIDER_NAME,
    lastAttemptAt: meta.lastAttemptAt,
    rateDate: meta.rateDate,
    lastError: meta.status === 'error' ? meta.error : null
  }
}
