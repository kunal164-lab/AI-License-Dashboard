// Local administrator authentication tests (Part 17 of the local-admin auth
// spec's 20-item test list). Runs against an isolated temp SQLite file —
// never the real app.sqlite.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `local-admin-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run, get } = await import('../../db/index.js')
const localAuth = await import('../localAuth.js')
const { computeEffectiveAccess } = await import('../authorize.js')
const { PAGE_KEYS } = await import('../pages.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => { run('DELETE FROM local_admin') })

test('fresh install: no local admin exists', () => {
  assert.equal(localAuth.hasLocalAdmin(), false)
  assert.equal(localAuth.getLocalAdminInfo(), null)
})

test('initial admin creation works and signs the account up with a safe view (no hash)', async () => {
  const result = await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  assert.equal(result.ok, true, `expected success: ${result.error}`)
  assert.equal(result.admin.username, 'admin')
  assert.equal(result.admin.passwordHash, undefined, 'the safe view must never include the password hash')
  assert.equal(localAuth.hasLocalAdmin(), true)
})

test('password is stored only as a bcrypt hash — never in plaintext', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const row = get('SELECT * FROM local_admin WHERE id = ?', ['default'])
  assert.notEqual(row.password_hash, 'correct-horse-battery')
  assert.ok(row.password_hash.startsWith('$2'), 'expected a bcrypt hash prefix')
})

test('a second createInitialLocalAdmin call is refused once an admin exists', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const result = await localAuth.createInitialLocalAdmin({ username: 'someone-else', password: 'another-strong-pass' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
})

test('getPublicStatus exposes only existence/enabled — never username, hash, or anything else', async () => {
  assert.deepEqual(localAuth.getPublicStatus(), { exists: false, enabled: false })
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  assert.deepEqual(localAuth.getPublicStatus(), { exists: true, enabled: true })
  localAuth.setLocalAdminEnabled(false)
  assert.deepEqual(localAuth.getPublicStatus(), { exists: true, enabled: false })
})

test('two concurrent createInitialLocalAdmin calls on a fresh install: exactly one succeeds (DB-enforced atomicity)', async () => {
  const [r1, r2] = await Promise.all([
    localAuth.createInitialLocalAdmin({ username: 'racer-a', password: 'strong-password-one' }),
    localAuth.createInitialLocalAdmin({ username: 'racer-b', password: 'strong-password-two' })
  ])
  const results = [r1, r2]
  const succeeded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  assert.equal(succeeded.length, 1, 'exactly one of the two concurrent requests must succeed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0].status, 409)
})

test('createInitialLocalAdmin rejects a weak password', async () => {
  const result = await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'short' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.equal(localAuth.hasLocalAdmin(), false)
})

test('local login succeeds with correct credentials', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const admin = await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' })
  assert.ok(admin)
  assert.equal(admin.username, 'admin')
})

test('local login is case-insensitive on username but not on password', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'Admin', password: 'correct-horse-battery' })
  assert.ok(await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' }))
  assert.equal(await localAuth.verifyLocalLogin({ username: 'admin', password: 'Correct-Horse-Battery' }), null)
})

test('local login fails with incorrect password', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const admin = await localAuth.verifyLocalLogin({ username: 'admin', password: 'wrong-password' })
  assert.equal(admin, null)
})

test('local login fails with incorrect username', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const admin = await localAuth.verifyLocalLogin({ username: 'nobody', password: 'correct-horse-battery' })
  assert.equal(admin, null)
})

test('a disabled local admin cannot log in even with the correct password', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  localAuth.setLocalAdminEnabled(false)
  const admin = await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' })
  assert.equal(admin, null)
})

test('re-enabling restores login', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  localAuth.setLocalAdminEnabled(false)
  localAuth.setLocalAdminEnabled(true)
  const admin = await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' })
  assert.ok(admin)
})

test('changing the password invalidates the old one and accepts the new one', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const result = await localAuth.changeLocalAdminPassword('a-brand-new-strong-password')
  assert.equal(result.ok, true)
  assert.equal(await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' }), null)
  assert.ok(await localAuth.verifyLocalLogin({ username: 'admin', password: 'a-brand-new-strong-password' }))
})

test('changePassword rejects a weak new password without touching the old one', async () => {
  await localAuth.createInitialLocalAdmin({ username: 'admin', password: 'correct-horse-battery' })
  const result = await localAuth.changeLocalAdminPassword('weak')
  assert.equal(result.ok, false)
  assert.ok(await localAuth.verifyLocalLogin({ username: 'admin', password: 'correct-horse-battery' }))
})

// ---- Authorization integration (Part 5/9/14): a local admin identity gets
// full admin access, synchronously, with no Microsoft Graph dependency ----

test('a local-provider identity resolves to full admin access on every page, synchronously', async () => {
  const access = await computeEffectiveAccess({ username: 'admin', authenticationProvider: 'local' })
  assert.equal(access.role, 'admin')
  assert.equal(access.canWrite, true)
  for (const key of PAGE_KEYS) assert.ok(access.allowedPages.includes(key), `missing page key: ${key}`)
})

test('local admin access does not depend on any Microsoft 365 connection or role_group_mappings existing', async () => {
  // No connections, no mappings configured at all in this isolated DB —
  // a Microsoft-provider user would get empty access (see authorize.test.js);
  // the local-provider branch must still grant everything.
  const access = await computeEffectiveAccess({ username: 'admin', authenticationProvider: 'local' })
  assert.equal(access.canWrite, true)
  assert.ok(access.allowedPages.length > 0)
})
