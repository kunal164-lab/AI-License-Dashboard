// server/services/microsoft/__tests__/profilePhoto.test.js established the
// stub/restore global.fetch pattern this file reuses — no live network
// call, hermetic in any environment. Fixtures match the REAL v2 API shape
// (confirmed live against api.frankfurter.dev and its own openapi.json
// during implementation — an array of one-pair-per-record objects, not a
// single object with a `rates` map like the older v1 /latest endpoint).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fetchLatestRates } from '../frankfurterProvider.js'

const realFetch = global.fetch
function stubFetch(impl) { global.fetch = impl }
function restoreFetch() { global.fetch = realFetch }

after(() => restoreFetch())

function realShapeResponse(date, base, quotePairs) {
  return [
    { date, base, quote: base, rate: 1 }, // the real API always includes this identity record
    ...Object.entries(quotePairs).map(([quote, rate]) => ({ date, base, quote, rate }))
  ]
}

test('returns { date, base, rates } reshaped from the real array-of-records v2 response, dropping the base==quote identity record', async () => {
  stubFetch(async () => ({
    ok: true,
    json: async () => realShapeResponse('2026-09-10', 'EUR', { USD: 1.08, GBP: 0.86, INR: 90.5 })
  }))
  const result = await fetchLatestRates('EUR', ['USD', 'GBP', 'INR'])
  assert.deepEqual(result, { date: '2026-09-10', base: 'EUR', rates: { USD: 1.08, GBP: 0.86, INR: 90.5 } })
})

test('throws a clear error on a non-OK HTTP status', async () => {
  stubFetch(async () => ({ ok: false, status: 503 }))
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /HTTP 503/)
})

test('throws on a network failure', async () => {
  stubFetch(async () => { throw new Error('getaddrinfo ENOTFOUND') })
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /Could not reach the FX provider/)
})

test('throws when the response is not an array at all', async () => {
  stubFetch(async () => ({ ok: true, json: async () => ({ base: 'EUR', date: '2026-09-10', rates: { USD: 1.08 } }) }))
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /not an array/)
})

test('throws on an empty array response', async () => {
  stubFetch(async () => ({ ok: true, json: async () => [] }))
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /no rate records/)
})

test('throws on a record with an unexpected base currency', async () => {
  stubFetch(async () => ({ ok: true, json: async () => [{ date: '2026-09-10', base: 'USD', quote: 'GBP', rate: 0.8 }] }))
  await assert.rejects(fetchLatestRates('EUR', ['GBP']), /unexpected base currency/)
})

test('throws on a record with a non-numeric/invalid rate — never trusts external JSON blindly', async () => {
  stubFetch(async () => ({ ok: true, json: async () => [{ date: '2026-09-10', base: 'EUR', quote: 'USD', rate: 'not-a-number' }] }))
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /invalid rate/)
})

test('throws on a response that is not valid JSON', async () => {
  stubFetch(async () => ({ ok: true, json: async () => { throw new Error('Unexpected token') } }))
  await assert.rejects(fetchLatestRates('EUR', ['USD']), /not valid JSON/)
})
