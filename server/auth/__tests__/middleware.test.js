// Backend API authorization tests (Part 25 of the auth spec — "backend API
// authorization"). Exercises requireAuth/requirePage/requireWrite as plain
// functions against fake req/res objects: a fresh (computedAt: Date.now())
// req.session.access is pre-populated, which is exactly what a real request
// has after the first computeEffectiveAccess call of a session, so none of
// these ever trigger a real Microsoft Graph call — these tests only check
// the DECISION each middleware makes from that cached value, matching
// exactly what server/index.js wires onto every real route. A denied
// request DOES write an audit-log row (server/repositories/auditLogRepo.js),
// so an isolated temp database is initialized below purely so that write
// has somewhere real to go — never the actual app.sqlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `middleware-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb } = await import('../../db/index.js')
const { requireAuth, requirePage, requireWrite, getOrRefreshAccess } = await import('../middleware.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })

function fakeReq({ user, access } = {}) {
  return { session: user ? { user, access } : null, originalUrl: '/api/test' }
}

function fakeRes() {
  const res = { statusCode: null, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

test('requireAuth: no session at all -> 401, handler never called', async () => {
  const req = fakeReq()
  const res = fakeRes()
  let called = false
  await requireAuth(req, res, () => { called = true })
  assert.equal(res.statusCode, 401)
  assert.equal(called, false)
})

test('requireAuth: authenticated but zero configured access -> 403 (default-deny, Part 17)', async () => {
  const req = fakeReq({ user: { oid: 'u1', upn: 'a@b.com' }, access: { allowedPages: [], canWrite: false, computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireAuth(req, res, () => { called = true })
  assert.equal(res.statusCode, 403)
  assert.equal(called, false)
})

test('requireAuth: authenticated with at least one page -> passes through', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['dashboard'], canWrite: false, vbu: 'SSP', computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireAuth(req, res, () => { called = true })
  assert.equal(called, true)
  assert.equal(res.statusCode, null)
})

test('requirePage: user lacks the specific page -> 403 even though they have other access', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['dashboard'], canWrite: false, vbu: 'SSP', computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requirePage('cost')(req, res, () => { called = true })
  assert.equal(res.statusCode, 403)
  assert.equal(called, false)
})

test('requirePage: user has the specific page -> passes through', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['cost', 'dashboard'], canWrite: false, vbu: 'SSP', computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requirePage('cost')(req, res, () => { called = true })
  assert.equal(called, true)
})

test('requireWrite: a Read Only user (canWrite: false) gets a real 403, not just a hidden button (Part 3)', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['data-sources'], canWrite: false, vbu: 'SSP', computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireWrite(req, res, () => { called = true })
  assert.equal(res.statusCode, 403)
  assert.equal(called, false)
})

// ---- VBU data-scope default-deny (VBU-aware-views spec, section 6/8) ----
// Real VBU data isolation (server/auth/vbuScope.js) can only be enforced
// for someone whose own VBU is known — a non-admin with none is blocked
// at the door here, with the SAME existing "contact your administrator"
// response every other access denial already uses, never a silently-empty
// dashboard.

test('requireAuth: non-admin with configured pages but NO resolvable VBU -> 403, same message as no-access', async () => {
  const req = fakeReq({ user: { oid: 'u1', upn: 'a@b.com' }, access: { allowedPages: ['dashboard', 'cost'], canWrite: false, vbu: null, computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireAuth(req, res, () => { called = true })
  assert.equal(res.statusCode, 403)
  assert.equal(called, false)
  assert.match(res.body.error, /contact your administrator/i)
})

test('requireAuth: an admin (canWrite: true) with NO vbu still passes through — admins are global regardless of their own VBU', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['dashboard'], canWrite: true, vbu: null, computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireAuth(req, res, () => { called = true })
  assert.equal(called, true)
  assert.equal(res.statusCode, null)
})

test('requireWrite: an admin (canWrite: true) passes through', async () => {
  const req = fakeReq({ user: { oid: 'u1' }, access: { allowedPages: ['data-sources'], canWrite: true, computedAt: Date.now() } })
  const res = fakeRes()
  let called = false
  await requireWrite(req, res, () => { called = true })
  assert.equal(called, true)
})

test('requireWrite: unauthenticated request (no session) still 401s, never reaches the write check', async () => {
  const req = fakeReq()
  const res = fakeRes()
  let called = false
  await requireWrite(req, res, () => { called = true })
  assert.equal(res.statusCode, 401)
  assert.equal(called, false)
})

// ---- getOrRefreshAccess (real Access Denied bug regression) ----
// A real, live-confirmed bug: server/auth/routes.js's GET /api/auth/me used
// to fall back to a hardcoded EMPTY access object whenever
// req.session.access was merely missing — indistinguishable, in the
// browser, from a genuine "not authorized" result. req.session.access goes
// missing on every server restart (server/auth/sqliteSessionStore.js#
// invalidateAllCachedAccess, by design), and /api/auth/me is very often the
// very first request after one (it's the frontend's own boot-time check) —
// an already-authorized user whose first post-restart request happened to
// be /api/auth/me got stuck on a permanent, incorrect "Access Denied,"
// confirmed live: a real admin session's cached access was cleared by a
// restart, and /api/auth/me never recomputed it. getOrRefreshAccess is the
// fix: the ONE recompute-or-reuse-cache function every protected route
// (including /api/auth/me now) shares.

test('getOrRefreshAccess: session with NO cached access at all (simulates invalidateAllCachedAccess having just run) recomputes it fresh via computeEffectiveAccess, rather than staying empty', async () => {
  // A local-admin identity resolves synchronously with no Graph/network
  // dependency (server/auth/authorize.js), so this exercises the exact
  // same "access is missing -> recompute" path a real Microsoft user hits,
  // without needing a live Microsoft 365 connection.
  const req = { session: { user: { username: 'admin', name: 'admin', authenticationProvider: 'local' } } }
  assert.equal(req.session.access, undefined, 'sanity: no cached access present, exactly like a session invalidateAllCachedAccess just touched')
  const access = await getOrRefreshAccess(req)
  assert.equal(access.canWrite, true, 'must recompute REAL access, never the old hardcoded empty fallback')
  assert.ok(access.allowedPages.length > 0)
  assert.equal(req.session.access, access, 'the recomputed access must be written back to the session, so it self-heals — the exact thing the old /api/auth/me fallback never did')
})

test('getOrRefreshAccess: a fresh, not-yet-expired cached access is reused as-is, never recomputed', async () => {
  const cached = { role: 'admin', allowedPages: ['dashboard'], canWrite: true, computedAt: Date.now() }
  const req = { session: { user: { username: 'admin', authenticationProvider: 'local' }, access: cached } }
  const access = await getOrRefreshAccess(req)
  assert.equal(access, cached, 'must reuse the exact same cached object, not recompute needlessly on every call')
})

test('getOrRefreshAccess: an expired cached access (older than the 15-minute refresh window) is recomputed, not reused', async () => {
  const stale = { role: 'admin', allowedPages: ['dashboard'], canWrite: true, computedAt: Date.now() - 16 * 60 * 1000 }
  const req = { session: { user: { username: 'admin', authenticationProvider: 'local' }, access: stale } }
  const access = await getOrRefreshAccess(req)
  assert.notEqual(access, stale, 'a stale cache must be recomputed, not returned as-is')
  assert.equal(access.canWrite, true)
})
