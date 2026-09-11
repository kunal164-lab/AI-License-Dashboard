// Regression coverage for the automatic FX/currency-conversion service
// (Part 3 of the spec this implements). Uses a real temp SQLite DB (same
// established pattern as server/services/freshservice/__tests__/
// importCsv.test.js) since fxService.js writes into the real
// exchange_rates/application_settings tables via exchangeRateRepo/
// settingsRepo — and mocks global.fetch (same pattern as
// frankfurterProvider.test.js) so nothing here depends on live network
// access.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `fx-service-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../../db/index.js')
const exchangeRateRepo = await import('../../../repositories/exchangeRateRepo.js')
const { refreshRates, getFxStatus, getRefreshMeta, deriveCrossRates, FX_PROVIDER_NAME } = await import('../fxService.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run('DELETE FROM exchange_rates')
  run("DELETE FROM application_settings WHERE key = 'fx_last_refresh'")
})

const realFetch = global.fetch
// Real v2 API shape (array of one-pair-per-record objects, including the
// base==quote identity record) — see frankfurterProvider.js/its own tests
// for how this was confirmed against the live API.
function stubProviderResponse(rates, date = '2026-09-10') {
  global.fetch = async () => ({
    ok: true,
    json: async () => [
      { date, base: 'EUR', quote: 'EUR', rate: 1 },
      ...Object.entries(rates).map(([quote, rate]) => ({ date, base: 'EUR', quote, rate }))
    ]
  })
}
function stubProviderFailure(message = 'boom') {
  global.fetch = async () => { throw new Error(message) }
}
after(() => { global.fetch = realFetch })

// EUR-based fixture used across tests, covering every SUPPORTED_CURRENCIES
// entry (EUR itself excluded — it's added as 1 by the service).
const EUR_RATES = { USD: 1.08, GBP: 0.86, INR: 90.5, AUD: 1.65, NZD: 1.78, CAD: 1.47 }

test('deriveCrossRates: cross-derives every pair correctly from an EUR-based response (never assumes USD-based)', () => {
  const eurRates = { EUR: 1, ...EUR_RATES }
  const pairs = deriveCrossRates(eurRates)
  const find = (base, target) => pairs.find((p) => p.base === base && p.target === target).rate

  // GBP -> USD: 1 GBP = (1/0.86) EUR = (1/0.86)*1.08 USD
  assert.ok(Math.abs(find('GBP', 'USD') - (1.08 / 0.86)) < 1e-9)
  // INR -> USD
  assert.ok(Math.abs(find('INR', 'USD') - (1.08 / 90.5)) < 1e-9)
  // EUR -> USD is direct
  assert.ok(Math.abs(find('EUR', 'USD') - 1.08) < 1e-9)
  // USD -> GBP
  assert.ok(Math.abs(find('USD', 'GBP') - (0.86 / 1.08)) < 1e-9)
  // USD -> INR
  assert.ok(Math.abs(find('USD', 'INR') - (90.5 / 1.08)) < 1e-9)
  // GBP -> INR
  assert.ok(Math.abs(find('GBP', 'INR') - (90.5 / 0.86)) < 1e-9)
  // INR -> GBP
  assert.ok(Math.abs(find('INR', 'GBP') - (0.86 / 90.5)) < 1e-9)
  // USD -> USD is never generated (same-currency is handled elsewhere as a no-op, rate 1)
  assert.equal(pairs.some((p) => p.base === 'USD' && p.target === 'USD'), false)
})

test('refreshRates writes every derived pair into exchange_rates with the provider label', async () => {
  stubProviderResponse(EUR_RATES)
  const result = await refreshRates({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.rateDate, '2026-09-10')
  const rows = exchangeRateRepo.listRates()
  assert.equal(rows.length, 42, 'expected every directional pair among 7 supported currencies (7*6)')
  assert.ok(rows.every((r) => r.source === FX_PROVIDER_NAME))
  const gbpUsd = rows.find((r) => r.base_currency === 'GBP' && r.target_currency === 'USD')
  assert.ok(Math.abs(gbpUsd.rate - (1.08 / 0.86)) < 1e-9)
})

test('a second refresh the SAME day is skipped (cached) — no repeated provider calls', async () => {
  stubProviderResponse(EUR_RATES)
  const first = await refreshRates({ force: true })
  assert.equal(first.skipped, false)

  let calls = 0
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ base: 'EUR', date: '2026-09-10', rates: EUR_RATES }) } }
  const second = await refreshRates() // not forced — should be skipped
  assert.equal(second.skipped, true)
  assert.equal(calls, 0, 'the provider must not be called again on the same day')
})

test('a manually-overridden rate is never clobbered by an automatic refresh', async () => {
  exchangeRateRepo.setRate({ baseCurrency: 'GBP', targetCurrency: 'USD', rate: 1.5, rateDate: '2026-01-01', source: 'Admin configured' })
  stubProviderResponse(EUR_RATES)
  await refreshRates({ force: true })
  const gbpUsd = exchangeRateRepo.getRate('GBP', 'USD')
  assert.equal(gbpUsd.rate, 1.5, 'the manual override must survive an automatic refresh untouched')
  assert.equal(gbpUsd.source, 'Admin configured')
  // A pair with NO manual override must still be auto-populated in the same run.
  const inrUsd = exchangeRateRepo.getRate('INR', 'USD')
  assert.equal(inrUsd.source, FX_PROVIDER_NAME)
})

test('provider failure: status becomes "error", and any previously stored rate is left completely intact (never zeroed/corrupted)', async () => {
  stubProviderResponse(EUR_RATES)
  await refreshRates({ force: true })
  const before = exchangeRateRepo.getRate('GBP', 'USD')

  stubProviderFailure('ENOTFOUND')
  const result = await refreshRates({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /ENOTFOUND/)

  const afterRow = exchangeRateRepo.getRate('GBP', 'USD')
  assert.deepEqual(afterRow, before, 'a failed refresh must never touch previously stored rates')

  const status = getFxStatus()
  assert.equal(status.status, 'using_last_successful')
  assert.match(status.lastError, /ENOTFOUND/, 'the most recent failure reason must be surfaced alongside the last-successful-rate status')
})

test('getRefreshMeta reflects the most recent attempt, success or failure', async () => {
  stubProviderFailure('temporary outage')
  const result = await refreshRates({ force: true })
  assert.equal(result.ok, false)
  const meta = getRefreshMeta()
  assert.equal(meta.status, 'error')
  assert.match(meta.error, /temporary outage/)
})

test('getFxStatus is "unavailable" when no successful automatic rate has ever been stored', () => {
  const status = getFxStatus()
  assert.equal(status.status, 'unavailable')
  assert.equal(status.provider, FX_PROVIDER_NAME)
})

test('USD -> USD is a same-currency no-op handled by exchangeRateRepo.getRate directly (rate 1), not by the FX provider', () => {
  const same = exchangeRateRepo.getRate('USD', 'USD')
  assert.equal(same.rate, 1)
})
