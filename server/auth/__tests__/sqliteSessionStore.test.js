// invalidateAllCachedAccess — the fix for a real bug: sessions are
// persisted in SQLite (not an in-memory store), so a session's cached
// `access` (role/VBU/Dashboard View/theme — server/auth/middleware.js)
// survives a server restart. Without this, an administrator's Dashboard
// View/theme/role change could still render stale to an already-signed-in
// session for up to 15 minutes AFTER a restart specifically meant to pick
// it up. Same real-temp-SQLite-DB pattern as
// server/services/__tests__/dashboardViews.test.js.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `sqlite-session-store-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run, all } = await import('../../db/index.js')
const { invalidateAllCachedAccess } = await import('../sqliteSessionStore.js')

beforeEach(async () => {
  await initDb()
  run('DELETE FROM sessions')
})

function insertSession(sid, data) {
  run('INSERT INTO sessions (sid, data_json, expires_at, updated_at) VALUES (?,?,?,?)', [
    sid, JSON.stringify(data), new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString()
  ])
}

test('invalidateAllCachedAccess strips only the cached access field, leaving the rest of the session (identity, selectedDashboardViewId) untouched', () => {
  insertSession('sess-1', {
    user: { username: 'Administrator', authenticationProvider: 'local' },
    selectedDashboardViewId: 'SSP_WORLDWIDE',
    access: { computedAt: Date.now(), dashboardView: { id: 'SSP_WORLDWIDE', theme: { headerGraphicKey: 'globe-network' } } }
  })
  const cleared = invalidateAllCachedAccess()
  assert.equal(cleared, 1)
  const row = all('SELECT data_json FROM sessions WHERE sid = ?', ['sess-1'])[0]
  const session = JSON.parse(row.data_json)
  assert.equal(session.access, undefined, 'the stale cached access must be gone so the next request recomputes it fresh')
  assert.equal(session.user.username, 'Administrator', 'signing-in state must be untouched — nobody is signed out')
  assert.equal(session.selectedDashboardViewId, 'SSP_WORLDWIDE', 'the local-admin\'s chosen preview must be untouched')
})

test('invalidateAllCachedAccess is a safe no-op for a session that has no cached access yet', () => {
  insertSession('sess-2', { user: { username: 'Administrator', authenticationProvider: 'local' } })
  const cleared = invalidateAllCachedAccess()
  assert.equal(cleared, 0)
  const row = all('SELECT data_json FROM sessions WHERE sid = ?', ['sess-2'])[0]
  assert.equal(JSON.parse(row.data_json).user.username, 'Administrator')
})

test('invalidateAllCachedAccess clears every session, not just one', () => {
  insertSession('sess-3', { access: { computedAt: Date.now() } })
  insertSession('sess-4', { access: { computedAt: Date.now() } })
  const cleared = invalidateAllCachedAccess()
  assert.equal(cleared, 2)
  for (const sid of ['sess-3', 'sess-4']) {
    const row = all('SELECT data_json FROM sessions WHERE sid = ?', [sid])[0]
    assert.equal(JSON.parse(row.data_json).access, undefined)
  }
})
