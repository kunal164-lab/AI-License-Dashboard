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
const { requireAuth, requirePage, requireWrite } = await import('../middleware.js')

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
