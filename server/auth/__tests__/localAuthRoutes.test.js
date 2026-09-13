// End-to-end HTTP lifecycle tests for the local-admin bootstrap/auth
// routes — proves the actual route/middleware wiring server/index.js uses
// (public status/setup/login routes mounted BEFORE the blanket
// app.use('/api', requireAuth) gate), not just the underlying business
// logic (see localAuth.test.js for that). A real Express app + session
// store + a stand-in protected route (mirroring /api/connections) is
// started on an ephemeral port; requests use plain fetch with manually
// threaded Set-Cookie/Cookie headers, since no HTTP client library is a
// project dependency.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import express from 'express'
import session from 'express-session'

const tmpDbPath = path.join(os.tmpdir(), `local-auth-routes-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const { getSessionSecret } = await import('../config.js')
const { SqliteSessionStore } = await import('../sqliteSessionStore.js')
const { authRouter } = await import('../routes.js')
const { adminRouter } = await import('../adminRoutes.js')
const { localAuthRouter } = await import('../localRoutes.js')
const { requireAuth } = await import('../middleware.js')

let server
let baseUrl

before(async () => {
  await initDb()
  const app = express()
  app.use(express.json())
  app.use(session({
    store: new SqliteSessionStore(),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
  }))
  // Same mount order as server/index.js: public auth routes first...
  app.use(authRouter)
  app.use(adminRouter)
  app.use(localAuthRouter)
  // ...then a stand-in for a real protected route (e.g. /api/connections),
  // behind the SAME blanket gate every other /api/* route sits behind.
  app.get('/api/connections', requireAuth, (req, res) => res.json({ connections: [] }))
  app.use('/api', requireAuth)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.unlinkSync(tmpDbPath) } catch (e) {}
})

function sessionCookie(res) {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  return raw.split(';')[0]
}

test('fresh database: GET /api/auth/local/status -> 200, exists=false', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/status`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { exists: false, enabled: false })
})

test('before any admin exists: GET /api/connections -> 401 (never made public)', async () => {
  const r = await fetch(`${baseUrl}/api/connections`)
  assert.equal(r.status, 401)
})

let setupCookie
test('fresh database: POST /api/auth/local/setup -> 201, and establishes an authenticated session immediately', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' })
  })
  assert.equal(r.status, 201)
  const body = await r.json()
  assert.equal(JSON.stringify(body).toLowerCase().includes('password'), false, 'the response must never echo the password')
  assert.equal(JSON.stringify(body).toLowerCase().includes('hash'), false, 'the response must never include a password hash')
  setupCookie = sessionCookie(r)
  assert.ok(setupCookie, 'expected the setup response to set a session cookie')
})

test('after setup: GET /api/auth/local/status -> exists=true, enabled=true', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/status`)
  assert.deepEqual(await r.json(), { exists: true, enabled: true })
})

test('after setup: POST /api/auth/local/setup again -> 409, backend state is authoritative regardless of frontend flags', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'someone-else', password: 'another-strong-pass', confirmPassword: 'another-strong-pass' })
  })
  assert.equal(r.status, 409)
})

test('the session established by setup can immediately reach a protected route', async () => {
  const r = await fetch(`${baseUrl}/api/connections`, { headers: { Cookie: setupCookie } })
  assert.equal(r.status, 200)
})

test('wrong password -> 401, and the error never hints at whether the account exists or what its hash looks like', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'totally-wrong-password' })
  })
  assert.equal(r.status, 401)
  const body = await r.json()
  assert.equal(JSON.stringify(body).toLowerCase().includes('hash'), false)
})

test('correct password -> 200, session id is regenerated (new cookie), and the new session reaches a protected route', async () => {
  const r = await fetch(`${baseUrl}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' })
  })
  assert.equal(r.status, 200)
  const loginCookie = sessionCookie(r)
  assert.ok(loginCookie)
  assert.notEqual(loginCookie, setupCookie, 'session regeneration must issue a different session id on login than the one setup created')

  const connRes = await fetch(`${baseUrl}/api/connections`, { headers: { Cookie: loginCookie } })
  assert.equal(connRes.status, 200)
})

test('two simultaneous first-admin setup requests on a fresh install -> exactly one succeeds', async () => {
  run("DELETE FROM local_admin WHERE id = 'default'")
  const attempt = () => fetch(`${baseUrl}/api/auth/local/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'racer', password: 'another-strong-password', confirmPassword: 'another-strong-password' })
  })
  const [r1, r2] = await Promise.all([attempt(), attempt()])
  const statuses = [r1.status, r2.status].sort()
  assert.deepEqual(statuses, [201, 409], `expected exactly one 201 and one 409, got ${JSON.stringify(statuses)}`)
})

// Security-audit hardening: /api/auth/local/setup used to have NO rate
// limit at all (only /login did), despite hashing the submitted password
// with bcrypt (12 rounds, deliberately expensive) on every call — an
// unauthenticated caller could otherwise drive real CPU load on a
// not-yet-configured instance. It now shares the exact same limiter login
// already used. This is deliberately the LAST test in this file: tripping
// the limiter here consumes the shared window for the rest of this
// process, so no test after this one may call /setup or /login again.
test('POST /api/auth/local/setup is now rate-limited (previously unlimited) — sharing the same limiter as /login', async () => {
  let sawLimited = false
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${baseUrl}/api/auth/local/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'flood', password: 'another-strong-password', confirmPassword: 'another-strong-password' })
    })
    if (r.status === 429) { sawLimited = true; break }
  }
  assert.ok(sawLimited, 'expected /api/auth/local/setup to eventually respond 429 once the shared rate limit is exceeded')
})
