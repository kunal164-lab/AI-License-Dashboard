// Regression coverage for the fix to "a user scoped to only e.g. 'kiro'
// could pull the full company-wide dashboard" (GET /api/dashboard) and the
// matching gap on GET /api/users/:id/detail's `provider` query param —
// both previously sat behind only the blanket requireAuth (any
// authenticated user with SOME access at all), with no per-page check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasCrossProviderAccess,
  filterConnectionsForAccess,
  canSeeMicrosoftDirectory,
  canAccessDetailProvider
} from '../dashboardAccess.js'

function access(allowedPages) {
  return { allowedPages, canWrite: false }
}

test('a user scoped to only "kiro" does not have cross-provider access', () => {
  assert.equal(hasCrossProviderAccess(access(['kiro'])), false)
})

test('any of the cross-provider page keys grants full access', () => {
  for (const key of ['dashboard', 'users', 'products', 'applications', 'cost', 'optimization', 'reports']) {
    assert.equal(hasCrossProviderAccess(access([key])), true, `${key} should grant cross-provider access`)
  }
})

test('a kiro-only caller only sees kiro connections, never microsoft/freshservice/claude/github', () => {
  const connections = [
    { id: '1', source: 'kiro' },
    { id: '2', source: 'microsoft' },
    { id: '3', source: 'freshservice' },
    { id: '4', source: 'claude' },
    { id: '5', source: 'github' }
  ]
  const result = filterConnectionsForAccess(connections, access(['kiro']))
  assert.deepEqual(result.map((c) => c.id), ['1'])
})

test('a caller with a cross-provider page key sees every connection unfiltered', () => {
  const connections = [
    { id: '1', source: 'kiro' },
    { id: '2', source: 'microsoft' },
    { id: '3', source: 'github' }
  ]
  const result = filterConnectionsForAccess(connections, access(['users']))
  assert.deepEqual(result.map((c) => c.id), ['1', '2', '3'])
})

test('a caller with only an unrelated page (e.g. data-sources) sees zero connections', () => {
  const connections = [{ id: '1', source: 'kiro' }, { id: '2', source: 'microsoft' }]
  const result = filterConnectionsForAccess(connections, access(['data-sources']))
  assert.deepEqual(result, [])
})

test('github connections are only visible via a cross-provider page — it has no dedicated page key', () => {
  const connections = [{ id: '1', source: 'github' }]
  assert.deepEqual(filterConnectionsForAccess(connections, access(['github'])), [])
  assert.deepEqual(filterConnectionsForAccess(connections, access(['products'])).map((c) => c.id), ['1'])
})

test('the Microsoft directory is only included for microsoft-365 or a cross-provider page', () => {
  assert.equal(canSeeMicrosoftDirectory(access(['microsoft-365'])), true)
  assert.equal(canSeeMicrosoftDirectory(access(['cost'])), true)
  assert.equal(canSeeMicrosoftDirectory(access(['kiro'])), false)
  assert.equal(canSeeMicrosoftDirectory(access(['freshservice'])), false)
})

test('per-provider user detail: a kiro-only caller can read kiro detail but not microsoft/freshservice/claude/github', () => {
  const a = access(['kiro'])
  assert.equal(canAccessDetailProvider(a, 'kiro'), true)
  assert.equal(canAccessDetailProvider(a, 'copilot'), false)
  assert.equal(canAccessDetailProvider(a, 'freshservice'), false)
  assert.equal(canAccessDetailProvider(a, 'claude'), false)
  assert.equal(canAccessDetailProvider(a, 'github'), false)
})

test('per-provider user detail: provider matching is case-insensitive', () => {
  assert.equal(canAccessDetailProvider(access(['kiro']), 'KIRO'), true)
})

test('per-provider user detail: an unknown provider is only reachable via a cross-provider page', () => {
  assert.equal(canAccessDetailProvider(access(['kiro']), 'not-a-real-provider'), false)
  assert.equal(canAccessDetailProvider(access(['users']), 'not-a-real-provider'), true)
})

test('a caller with any cross-provider page key can read any provider detail', () => {
  const a = access(['users'])
  for (const provider of ['kiro', 'copilot', 'freshservice', 'claude', 'github']) {
    assert.equal(canAccessDetailProvider(a, provider), true, `${provider} should be readable via 'users'`)
  }
})
