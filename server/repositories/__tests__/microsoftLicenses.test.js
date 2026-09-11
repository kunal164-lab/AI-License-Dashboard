// Regression coverage for the fix to "microsoft_licenses stored the SAME
// tenant-wide SKU catalog service plans for every holder of a SKU,
// regardless of that specific user's own disabled plans" — needed so
// Copilot entitlement/service-plan display reflects each user's REAL
// current status (assignedPlans, cross-referenced at sync time), not a
// uniform catalog blob. See server/services/microsoft/copilotEntitlement.js.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `microsoft-licenses-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const connectionsRepo = await import('../connectionsRepo.js')
const msRepo = await import('../microsoftRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run("DELETE FROM connections WHERE source = 'microsoft'")
  run('DELETE FROM microsoft_users')
  run('DELETE FROM microsoft_licenses')
})

function makeConnection() {
  const conn = connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS', authType: 'client_credentials', credentials: {}, meta: {} })
  return conn.id
}

const COPILOT_SKU_ID = 'sku-copilot'
const CATALOG_SERVICE_PLANS = [
  { servicePlanId: 'plan-apps', servicePlanName: 'M365_COPILOT_APPS' },
  { servicePlanId: 'plan-chat', servicePlanName: 'M365_COPILOT_BUSINESS_CHAT' }
]

test('two users with the SAME SKU but different assignedPlans get DIFFERENT per-user enabled_service_plans (not a shared catalog blob)', () => {
  const connId = makeConnection()
  const users = [
    {
      ms_id: 'u1',
      assigned_licenses: [{ skuId: COPILOT_SKU_ID }],
      // Both plans enabled for this user.
      assigned_plans: [
        { servicePlanId: 'plan-apps', capabilityStatus: 'Enabled' },
        { servicePlanId: 'plan-chat', capabilityStatus: 'Enabled' }
      ]
    },
    {
      ms_id: 'u2',
      assigned_licenses: [{ skuId: COPILOT_SKU_ID }],
      // Chat plan deleted/disabled for THIS user, despite the same SKU.
      assigned_plans: [
        { servicePlanId: 'plan-apps', capabilityStatus: 'Enabled' },
        { servicePlanId: 'plan-chat', capabilityStatus: 'Deleted' }
      ]
    }
  ]
  const skus = [{ skuId: COPILOT_SKU_ID, skuPartNumber: 'Microsoft_365_Copilot', servicePlans: CATALOG_SERVICE_PLANS }]

  msRepo.upsertLicenses(connId, users, skus)

  const u1Licenses = msRepo.getLicensesForUser('u1')
  const u2Licenses = msRepo.getLicensesForUser('u2')
  assert.equal(u1Licenses[0].enabled_service_plans.find((p) => p.servicePlanId === 'plan-chat').capabilityStatus, 'Enabled')
  assert.equal(u2Licenses[0].enabled_service_plans.find((p) => p.servicePlanId === 'plan-chat').capabilityStatus, 'Deleted')

  // The raw tenant-catalog service_plans field stays identical for both
  // (that one IS supposed to be the uniform SKU catalog) — only the new
  // per-user enabled_service_plans field differs.
  assert.deepEqual(u1Licenses[0].service_plans, u2Licenses[0].service_plans)
})

test('a plan the user has no assignedPlans entry for at all resolves to null capabilityStatus, never fabricated as Enabled', () => {
  const connId = makeConnection()
  const users = [{ ms_id: 'u3', assigned_licenses: [{ skuId: COPILOT_SKU_ID }], assigned_plans: [] }]
  const skus = [{ skuId: COPILOT_SKU_ID, skuPartNumber: 'Microsoft_365_Copilot', servicePlans: CATALOG_SERVICE_PLANS }]
  msRepo.upsertLicenses(connId, users, skus)
  const licenses = msRepo.getLicensesForUser('u3')
  assert.equal(licenses[0].enabled_service_plans.every((p) => p.capabilityStatus === null), true)
})
