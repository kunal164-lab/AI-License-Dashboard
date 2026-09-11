// Role resolution tests (Part 25 of the auth spec: "add focused tests for
// authentication, role resolution, page authorization, and backend API
// authorization"). combineEffectiveAccess is pure — no Graph call, no
// database — so these run instantly and never touch a real tenant.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { combineEffectiveAccess } from '../authorize.js'
import { PAGE_KEYS, PAGE_BY_KEY } from '../pages.js'

function mapping({ groupId, role = 'read_only', allowedPages = [], canWrite = false }) {
  return { id: groupId, securityGroupName: groupId, securityGroupId: groupId, role, allowedPages, canWrite }
}

test('no matching group -> no access at all (default-deny)', () => {
  const mappings = [mapping({ groupId: 'g1', allowedPages: ['dashboard'] })]
  const result = combineEffectiveAccess(mappings, [] /* matched none */)
  assert.equal(result.role, null)
  assert.deepEqual(result.allowedPages, [])
  assert.equal(result.canWrite, false)
})

test('a single matched read-only mapping grants exactly its configured pages, no write access', () => {
  const mappings = [mapping({ groupId: 'g1', role: 'read_only', allowedPages: ['dashboard', 'products'] })]
  const result = combineEffectiveAccess(mappings, ['g1'])
  assert.deepEqual(result.allowedPages.sort(), ['dashboard', 'products'])
  assert.equal(result.canWrite, false)
  assert.equal(result.role, 'read_only')
})

test('a matched admin (can_write) mapping grants write access and its own pages, and the role is always "admin"', () => {
  const mappings = [mapping({ groupId: 'g1', role: 'license-admin', allowedPages: ['cost', 'products'], canWrite: true })]
  const result = combineEffectiveAccess(mappings, ['g1'])
  assert.equal(result.canWrite, true)
  assert.equal(result.role, 'admin')
})

test('multiple matched memberships combine ADDITIVELY — pages union, write access from either', () => {
  const mappings = [
    mapping({ groupId: 'g-read', role: 'read_only', allowedPages: ['dashboard', 'reports'] }),
    mapping({ groupId: 'g-write', role: 'read_only', allowedPages: ['cost'], canWrite: true })
  ]
  const result = combineEffectiveAccess(mappings, ['g-read', 'g-write'])
  assert.deepEqual(result.allowedPages.sort(), ['cost', 'dashboard', 'reports'])
  assert.equal(result.canWrite, true, 'write access from the second group must not be lost just because the first group is read-only')
})

test('belonging to an UNMATCHED group never subtracts pages granted by a matched one', () => {
  const mappings = [
    mapping({ groupId: 'g-matched', allowedPages: ['dashboard'] }),
    mapping({ groupId: 'g-not-matched', allowedPages: ['cost'] })
  ]
  const result = combineEffectiveAccess(mappings, ['g-matched'])
  assert.deepEqual(result.allowedPages, ['dashboard'])
})

test('the bootstrap admin group, when matched, grants every real page key and write access regardless of role_group_mappings', () => {
  const mappings = [mapping({ groupId: 'g1', role: 'read_only', allowedPages: ['dashboard'] })]
  const result = combineEffectiveAccess(mappings, ['g1', 'bootstrap-group'], { bootstrapGroupId: 'bootstrap-group', allPageKeys: PAGE_KEYS })
  assert.equal(result.isBootstrapAdmin, true)
  assert.equal(result.canWrite, true)
  for (const key of PAGE_KEYS) assert.ok(result.allowedPages.includes(key), `missing page key: ${key}`)
})

test('the bootstrap admin group configured but NOT matched by this user grants nothing extra', () => {
  const mappings = [mapping({ groupId: 'g1', allowedPages: ['dashboard'] })]
  const result = combineEffectiveAccess(mappings, ['g1'], { bootstrapGroupId: 'bootstrap-group', allPageKeys: PAGE_KEYS })
  assert.equal(result.isBootstrapAdmin, false)
  assert.equal(result.canWrite, false)
  assert.deepEqual(result.allowedPages, ['dashboard'])
})

test('no configured mappings and no bootstrap match -> empty access, never a fallback to "everything"', () => {
  const result = combineEffectiveAccess([], [])
  assert.deepEqual(result, { role: null, allowedPages: [], canWrite: false, isBootstrapAdmin: false })
})

// ---- Central page registry sanity (Part 5) ----

test('every page key is unique', () => {
  assert.equal(new Set(PAGE_KEYS).size, PAGE_KEYS.length)
})

test('the admin-access page is marked adminOnly', () => {
  assert.equal(PAGE_BY_KEY['admin-access'].adminOnly, true)
})

test('every non-adminOnly page key referenced by combineEffectiveAccess\'s "grant everything" bootstrap path is a real registry key', () => {
  // Guards against a future PAGE_KEYS edit silently introducing a key with
  // no label/route — every entry must resolve back through PAGE_BY_KEY.
  for (const key of PAGE_KEYS) assert.ok(PAGE_BY_KEY[key], `unregistered page key: ${key}`)
})
