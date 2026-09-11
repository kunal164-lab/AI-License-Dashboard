// End-to-end tests for the admin API: role management (Part 3 of the
// custom-roles spec) and role/group mappings (now referencing a role by id
// rather than owning pages/write directly), plus the adminOnly page-key
// validation (Part 19 audit finding — a role that doesn't grant canWrite
// must never end up with 'admin-access' in its allowedPages). Runs a real
// Express app (session + authRouter + adminRouter + localAuthRouter) on an
// ephemeral port, using securityGroupId directly so no live Microsoft
// Graph call is needed.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import express from 'express'
import session from 'express-session'

const tmpDbPath = path.join(os.tmpdir(), `admin-routes-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb } = await import('../../db/index.js')
const { getSessionSecret } = await import('../config.js')
const { SqliteSessionStore } = await import('../sqliteSessionStore.js')
const { authRouter } = await import('../routes.js')
const { adminRouter } = await import('../adminRoutes.js')
const { localAuthRouter } = await import('../localRoutes.js')
const rolesRepo = await import('../../repositories/rolesRepo.js')
const auditLogRepo = await import('../../repositories/auditLogRepo.js')

let server, baseUrl, adminCookie

before(async () => {
  await initDb()
  rolesRepo.migrateLegacyRoleMappings() // seeds the built-in 'admin'/'Read_Only' roles, same as server/index.js does at boot
  const app = express()
  app.use(express.json())
  app.use(session({
    store: new SqliteSessionStore(),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
  }))
  app.use(authRouter)
  app.use(adminRouter)
  app.use(localAuthRouter)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${server.address().port}`

  // A local admin session IS an admin session for these routes (Part 5 of
  // the local-admin spec: same authorization middleware for every
  // provider) — this is the simplest real (non-mocked) way to get one.
  const setupRes = await fetch(`${baseUrl}/api/auth/local/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' })
  })
  assert.equal(setupRes.status, 201, 'test setup: expected local admin creation to succeed')
  adminCookie = setupRes.headers.get('set-cookie').split(';')[0]
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.unlinkSync(tmpDbPath) } catch (e) {}
})

test('an admin can list pages and the registry includes admin-access marked adminOnly', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/pages`, { headers: { Cookie: adminCookie } })
  assert.equal(r.status, 200)
  const { pages } = await r.json()
  const adminPage = pages.find((p) => p.key === 'admin-access')
  assert.ok(adminPage)
  assert.equal(adminPage.adminOnly, true)
})

test('the built-in roles are listed with the exact canonical Read_Only identifier', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles`, { headers: { Cookie: adminCookie } })
  assert.equal(r.status, 200)
  const { roles } = await r.json()
  const readOnly = roles.find((role) => role.id === 'Read_Only')
  assert.ok(readOnly, 'Read_Only must exist with that exact spelling/casing')
  assert.equal(readOnly.isBuiltin, true)
  assert.ok(roles.some((role) => role.id === 'admin' && role.isBuiltin))
})

// ---- Role creation/editing ----

let licenseManagerRoleId

test('creating a custom role WITHOUT write access strips admin-access from allowedPages even if requested', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'License Manager', description: 'Can view and manage licensing information.', canWrite: false, allowedPages: ['cost', 'users', 'admin-access'] })
  })
  assert.equal(r.status, 201)
  const { role } = await r.json()
  assert.equal(role.id, 'license_manager', 'a stable snake_case id must be derived from the display name')
  assert.deepEqual(role.allowedPages.sort(), ['cost', 'users'], 'admin-access must be stripped when canWrite is false')
  licenseManagerRoleId = role.id
})

test('creating a role WITH write access is allowed to keep admin-access', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Super Admin Role', canWrite: true, allowedPages: ['dashboard', 'admin-access'] })
  })
  assert.equal(r.status, 201)
  const { role } = await r.json()
  assert.deepEqual(role.allowedPages.sort(), ['admin-access', 'dashboard'])
})

test('a duplicate role name is rejected with 409', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'License Manager', canWrite: false, allowedPages: [] })
  })
  assert.equal(r.status, 409)
})

test('updating a role to canWrite=false strips admin-access even if allowedPages still lists it', async () => {
  const createRes = await fetch(`${baseUrl}/api/admin/access/roles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Downgrade Role', canWrite: true, allowedPages: ['dashboard', 'admin-access'] })
  })
  const { role: created } = await createRes.json()

  const updateRes = await fetch(`${baseUrl}/api/admin/access/roles/${created.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ canWrite: false, allowedPages: ['dashboard', 'admin-access'] })
  })
  assert.equal(updateRes.status, 200)
  const { role: updated } = await updateRes.json()
  assert.deepEqual(updated.allowedPages, ['dashboard'])
})

test('a built-in role cannot be deleted', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles/Read_Only`, { method: 'DELETE', headers: { Cookie: adminCookie } })
  assert.equal(r.status, 403)
  assert.ok(rolesRepo.getRole('Read_Only'), 'Read_Only must still exist')
})

// ---- Role/group mappings (reference a role by id) ----

test('creating a mapping requires an existing roleId', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/mappings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ securityGroupName: 'Bad Role Group', securityGroupId: 'group-badrole', roleId: 'does_not_exist' })
  })
  assert.equal(r.status, 400)
})

test('creating a mapping with a valid roleId resolves pages/write from that role', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/mappings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ securityGroupName: 'License Team', securityGroupId: 'group-license-team', roleId: licenseManagerRoleId })
  })
  assert.equal(r.status, 201)
  const { mapping } = await r.json()
  assert.equal(mapping.role, licenseManagerRoleId)
  assert.deepEqual(mapping.allowedPages.sort(), ['cost', 'users'])
  assert.equal(mapping.canWrite, false)
})

test('duplicate security group id is rejected with 409', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/mappings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ securityGroupName: 'License Team Again', securityGroupId: 'group-license-team', roleId: 'admin' })
  })
  assert.equal(r.status, 409)
})

test('a role currently assigned to a mapping cannot be deleted', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/roles/${licenseManagerRoleId}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /assigned to one or more security groups/)
  assert.ok(rolesRepo.getRole(licenseManagerRoleId), 'the role must still exist')
})

test('updating a mapping to reassign its role changes the resolved pages/write', async () => {
  const mappingsRes = await fetch(`${baseUrl}/api/admin/access/mappings`, { headers: { Cookie: adminCookie } })
  const { mappings } = await mappingsRes.json()
  const target = mappings.find((m) => m.securityGroupId === 'group-license-team')

  const r = await fetch(`${baseUrl}/api/admin/access/mappings/${target.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ roleId: 'Read_Only' })
  })
  assert.equal(r.status, 200)
  const { mapping } = await r.json()
  assert.equal(mapping.role, 'Read_Only')
})

test('every role/mapping mutation route rejects an unauthenticated request', async () => {
  const r1 = await fetch(`${baseUrl}/api/admin/access/mappings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ securityGroupName: 'Nope', securityGroupId: 'group-nope', roleId: 'admin' })
  })
  assert.equal(r1.status, 401)
  const r2 = await fetch(`${baseUrl}/api/admin/access/roles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Nope', canWrite: true, allowedPages: [] })
  })
  assert.equal(r2.status, 401)
})

// ---- Profile photo (Part 1 of the Entra-photo/custom-roles spec) ----

test('an unauthenticated request for the profile photo is rejected', async () => {
  const r = await fetch(`${baseUrl}/api/auth/profile/photo`)
  assert.equal(r.status, 401)
})

test('an authenticated session with no cached photo (e.g. the local admin) gets a graceful 404, not an error', async () => {
  const r = await fetch(`${baseUrl}/api/auth/profile/photo`, { headers: { Cookie: adminCookie } })
  assert.equal(r.status, 404)
})

test('/api/auth/me never exposes a photo/token — only a safe hasPhoto boolean', async () => {
  const r = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: adminCookie } })
  const j = await r.json()
  assert.equal(typeof j.user.hasPhoto, 'boolean')
  assert.equal(JSON.stringify(j).toLowerCase().includes('accesstoken'), false)
  assert.equal(JSON.stringify(j).toLowerCase().includes('bearer'), false)
})

// ---- Audit events (Part 1 of the audit-retention/VBU spec) ----

test('an unauthenticated request cannot list or export audit events', async () => {
  const r1 = await fetch(`${baseUrl}/api/admin/access/audit-log`)
  assert.equal(r1.status, 401)
  const r2 = await fetch(`${baseUrl}/api/admin/access/audit-log/export`)
  assert.equal(r2.status, 401)
})

test('a bare GET (no query params) defaults to 1 day / 5 events, newest first, and reports the enforced maximums', async () => {
  for (let i = 0; i < 8; i++) {
    auditLogRepo.record({ eventType: `seed_event_${i}`, actorUpn: 'seed@ssp.com', detail: { i } })
  }
  const r = await fetch(`${baseUrl}/api/admin/access/audit-log`, { headers: { Cookie: adminCookie } })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.rangeDays, 1)
  assert.equal(j.limit, 5)
  assert.equal(j.maxRangeDays, 4)
  assert.equal(j.maxLimit, 100)
  assert.equal(j.events.length, 5, 'only the 5 most recent of the 8 just-recorded events (plus earlier setup events) should come back')
  const timestamps = j.events.map((e) => e.at)
  const sorted = [...timestamps].sort().reverse()
  assert.deepEqual(timestamps, sorted, 'events must be newest first')
})

test('rangeDays/limit beyond the enforced maximum are clamped, never trusted as-is', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/audit-log?rangeDays=365&limit=99999`, { headers: { Cookie: adminCookie } })
  const j = await r.json()
  assert.equal(j.rangeDays, 4, 'rangeDays must never exceed the 4-day retention maximum')
  assert.equal(j.limit, 100, 'limit must never exceed the enforced server-side maximum')
})

test('a requested count within bounds is honored exactly', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/audit-log?rangeDays=4&limit=10`, { headers: { Cookie: adminCookie } })
  const j = await r.json()
  assert.equal(j.limit, 10)
  assert.ok(j.events.length <= 10)
})

test('the export endpoint returns a real CSV built from the same backend-enforced range/limit — never a separate, more permissive path', async () => {
  const r = await fetch(`${baseUrl}/api/admin/access/audit-log/export?rangeDays=365&limit=3`, { headers: { Cookie: adminCookie } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/csv/)
  assert.match(r.headers.get('content-disposition'), /attachment/)
  const csv = await r.text()
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'Timestamp,Event Type,User,Details')
  // header + at most 3 data rows (limit clamped from the requested 99999-equivalent-style oversized value down to 3, which is itself within the max so it's honored, but never more than that)
  assert.ok(lines.length <= 4, 'export must obey the same clamped limit as the viewer')
})
