// Microsoft Entra ID SSO configuration storage tests — the admin-session-
// gated replacement for the old one-time setup-token flow. Covers the
// encrypted round-trip, the safe view never exposing the secret, and
// env-vars-always-win precedence (server/auth/config.js). Runs against an
// isolated temp SQLite file — never the real app.sqlite — and restores
// every ENTRA_SSO_* env var it touches afterward.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `entra-config-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const entraConfig = await import('../entraConfig.js')
const config = await import('../config.js')

const ENV_KEYS = ['ENTRA_SSO_TENANT_ID', 'ENTRA_SSO_CLIENT_ID', 'ENTRA_SSO_CLIENT_SECRET', 'BOOTSTRAP_ADMIN_GROUP']
const savedEnv = {}

before(async () => {
  await initDb()
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})
after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  try { fs.unlinkSync(tmpDbPath) } catch (e) {}
})
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  run("DELETE FROM application_settings WHERE key = 'entra_setup_config'")
})

test('fresh install: nothing saved yet', () => {
  assert.equal(entraConfig.getSavedEntraConfig(), null)
  assert.deepEqual(entraConfig.getSavedEntraConfigSafeView(), {
    configured: false, tenantId: '', clientId: '', bootstrapAdminGroup: '', clientSecretConfigured: false
  })
  assert.equal(config.isSsoConfigured(), false)
})

test('saveEntraConfig requires tenantId, clientId and a client secret', () => {
  assert.equal(entraConfig.saveEntraConfig({ tenantId: '', clientId: 'c', clientSecret: 's' }).ok, false)
  assert.equal(entraConfig.saveEntraConfig({ tenantId: 't', clientId: 'c', clientSecret: '' }).ok, false)
})

test('a saved config round-trips through encryption correctly and is reflected by getEffectiveEntraConfig', () => {
  const result = entraConfig.saveEntraConfig({ tenantId: 'tid-123', clientId: 'cid-456', clientSecret: 'super-secret-value', bootstrapAdminGroup: 'IT Dashboard Admins' })
  assert.equal(result.ok, true)

  const saved = entraConfig.getSavedEntraConfig()
  assert.equal(saved.tenantId, 'tid-123')
  assert.equal(saved.clientId, 'cid-456')
  assert.equal(saved.clientSecret, 'super-secret-value')
  assert.equal(saved.bootstrapAdminGroup, 'IT Dashboard Admins')
  assert.equal(config.isSsoConfigured(), true)
})

test('the safe view never includes the client secret, only whether one is configured', () => {
  entraConfig.saveEntraConfig({ tenantId: 'tid-123', clientId: 'cid-456', clientSecret: 'super-secret-value' })
  const safe = entraConfig.getSavedEntraConfigSafeView()
  assert.equal(safe.clientSecretConfigured, true)
  assert.equal(JSON.stringify(safe).includes('super-secret-value'), false)
})

test('updating without a new client secret keeps the previously stored one', () => {
  entraConfig.saveEntraConfig({ tenantId: 'tid-123', clientId: 'cid-456', clientSecret: 'original-secret' })
  entraConfig.saveEntraConfig({ tenantId: 'tid-123', clientId: 'cid-456', clientSecret: '', bootstrapAdminGroup: 'New Group' })
  const saved = entraConfig.getSavedEntraConfig()
  assert.equal(saved.clientSecret, 'original-secret')
  assert.equal(saved.bootstrapAdminGroup, 'New Group')
})

test('env-configured SSO takes precedence over a saved config', () => {
  entraConfig.saveEntraConfig({ tenantId: 'db-tenant', clientId: 'db-client', clientSecret: 'db-secret', bootstrapAdminGroup: 'DB Admins' })
  process.env.ENTRA_SSO_TENANT_ID = 'env-tenant'
  process.env.ENTRA_SSO_CLIENT_ID = 'env-client'
  process.env.ENTRA_SSO_CLIENT_SECRET = 'env-secret'

  const effective = config.getEffectiveEntraConfig()
  assert.equal(effective.tenantId, 'env-tenant', 'env vars must win over a saved config, e.g. to fix a mistake without touching the database')
})

test('testEntraConfig requires all three fields', async () => {
  const result = await entraConfig.testEntraConfig({ tenantId: '', clientId: 'c', clientSecret: 's' })
  assert.equal(result.ok, false)
})
