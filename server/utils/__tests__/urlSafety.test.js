// Regression coverage for the SSRF guard applied to admin/OAuth-supplied
// connector URLs (Kiro authorizationUrl/tokenUrl/apiBaseUrl, GitHub
// reportUrl) — see server/utils/urlSafety.js's own header comment for the
// finding this resolves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'dns'
import { assertSafeExternalUrl } from '../urlSafety.js'

// IP literals so these don't depend on real DNS/network access being
// available in whatever environment runs the test suite (this sandbox has
// none — see the hostname-resolution test below for that code path,
// exercised instead with a mocked resolver).
test('accepts an ordinary public https URL (IP literal)', async () => {
  await assert.doesNotReject(assertSafeExternalUrl('https://8.8.8.8/v1/data', 'apiBaseUrl'))
})

test('accepts an ordinary public http URL (IP literal)', async () => {
  await assert.doesNotReject(assertSafeExternalUrl('http://8.8.8.8/v1/data', 'apiBaseUrl'))
})

test('accepts a hostname that resolves to a public address', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }])
  await assert.doesNotReject(assertSafeExternalUrl('https://api.example.com/v1/data', 'apiBaseUrl'))
})

test('rejects a hostname that resolves to an internal address', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '10.0.0.5', family: 4 }])
  await assert.rejects(assertSafeExternalUrl('https://internal.corp.example/v1/data', 'apiBaseUrl'), /internal\/private/)
})

test('rejects a non-URL string', async () => {
  await assert.rejects(assertSafeExternalUrl('not a url', 'apiBaseUrl'), /not a valid URL/)
})

test('rejects a non-http(s) scheme', async () => {
  await assert.rejects(assertSafeExternalUrl('file:///etc/passwd', 'apiBaseUrl'), /http:\/\/ or https:\/\//)
  await assert.rejects(assertSafeExternalUrl('gopher://internal:70/x', 'apiBaseUrl'), /http:\/\/ or https:\/\//)
})

test('rejects literal localhost', async () => {
  await assert.rejects(assertSafeExternalUrl('http://localhost:8080/', 'apiBaseUrl'), /internal address/)
})

test('rejects loopback IP literals', async () => {
  await assert.rejects(assertSafeExternalUrl('http://127.0.0.1/', 'apiBaseUrl'), /internal\/private/)
  await assert.rejects(assertSafeExternalUrl('http://[::1]/', 'apiBaseUrl'), /internal\/private/)
})

test('rejects RFC1918 private ranges', async () => {
  await assert.rejects(assertSafeExternalUrl('http://10.1.2.3/', 'apiBaseUrl'), /internal\/private/)
  await assert.rejects(assertSafeExternalUrl('http://172.16.0.5/', 'apiBaseUrl'), /internal\/private/)
  await assert.rejects(assertSafeExternalUrl('http://192.168.1.1/', 'apiBaseUrl'), /internal\/private/)
})

test('rejects the link-local range, including the cloud metadata address', async () => {
  await assert.rejects(assertSafeExternalUrl('http://169.254.169.254/latest/meta-data/', 'apiBaseUrl'), /internal\/private/)
})

test('rejects an IPv4-mapped IPv6 loopback literal', async () => {
  await assert.rejects(assertSafeExternalUrl('http://[::ffff:127.0.0.1]/', 'apiBaseUrl'), /internal\/private/)
})
