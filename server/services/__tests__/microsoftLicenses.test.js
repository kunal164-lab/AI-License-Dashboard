// Regression coverage for "the dashboard must present Microsoft Copilot as
// ONE business product/plan, never a separate row per real Graph SKU" —
// see server/services/microsoft/copilotEntitlement.js's businessLicenseIdFor
// for the centralized mapping this relies on. Uses a real temp SQLite DB
// (matches server/repositories/__tests__/microsoftLicenses.test.js's own
// pattern) since licenseOverview/licenseDetail read from the real repo
// functions, not a mock.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `microsoft-licenses-service-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const connectionsRepo = await import('../../repositories/connectionsRepo.js')
const msRepo = await import('../../repositories/microsoftRepo.js')
const { licenseOverview, licenseDetail, MONITORED_LICENSES } = await import('../microsoftLicenses.js')
const { COPILOT_BUSINESS_LICENSE_ID } = await import('../microsoft/copilotEntitlement.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run("DELETE FROM connections WHERE source = 'microsoft'")
  run('DELETE FROM microsoft_users')
  run('DELETE FROM microsoft_licenses')
})

function makeConnection() {
  return connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'Test MS', authType: 'client_credentials', credentials: {}, meta: {} }).id
}

function graphUser({ id, displayName, upn }) {
  return { id, displayName, userPrincipalName: upn, mail: upn, companyName: 'SSP', accountEnabled: true, assignedLicenses: [] }
}

test('two different real Copilot SKUs aggregate into ONE "Microsoft Copilot" business row, not two', () => {
  const connId = makeConnection()
  msRepo.upsertUsers(connId, [
    graphUser({ id: 'u1', displayName: 'Alice', upn: 'alice@ssp-worldwide.com' }),
    graphUser({ id: 'u2', displayName: 'Bob', upn: 'bob@ssp-worldwide.com' })
  ])
  const users = [
    { ms_id: 'u1', assigned_licenses: [{ skuId: 'sku-premium' }], assigned_plans: [] },
    { ms_id: 'u2', assigned_licenses: [{ skuId: 'sku-dept' }], assigned_plans: [] }
  ]
  const skus = [
    { skuId: 'sku-premium', skuPartNumber: 'Microsoft_365_Copilot', servicePlans: [] },
    { skuId: 'sku-dept', skuPartNumber: 'MICROSOFT_365_COPILOT_DEPT', servicePlans: [] }
  ]
  msRepo.upsertLicenses(connId, users, skus)

  const overview = licenseOverview()
  const copilotRows = overview.filter((r) => r.product === 'Microsoft Copilot')
  assert.equal(copilotRows.length, 1, 'must be exactly ONE Microsoft Copilot row, never one per real SKU')
  assert.equal(copilotRows[0].licenseId, COPILOT_BUSINESS_LICENSE_ID)
  assert.equal(copilotRows[0].license, 'Microsoft 365 Copilot')
  assert.equal(copilotRows[0].assigned, 2, 'both real SKU holders must be counted in the one aggregated row')
})

test('the aggregated Copilot license detail lists both users, each showing their OWN real SKU as secondary technical data', () => {
  const connId = makeConnection()
  msRepo.upsertUsers(connId, [
    graphUser({ id: 'u1', displayName: 'Alice', upn: 'alice@ssp-worldwide.com' }),
    graphUser({ id: 'u2', displayName: 'Bob', upn: 'bob@ssp-worldwide.com' })
  ])
  const users = [
    { ms_id: 'u1', assigned_licenses: [{ skuId: 'sku-premium' }], assigned_plans: [] },
    { ms_id: 'u2', assigned_licenses: [{ skuId: 'sku-dept' }], assigned_plans: [] }
  ]
  const skus = [
    { skuId: 'sku-premium', skuPartNumber: 'Microsoft_365_Copilot', servicePlans: [] },
    { skuId: 'sku-dept', skuPartNumber: 'MICROSOFT_365_COPILOT_DEPT', servicePlans: [] }
  ]
  msRepo.upsertLicenses(connId, users, skus)

  const detail = licenseDetail(COPILOT_BUSINESS_LICENSE_ID)
  assert.equal(detail.license.product, 'Microsoft Copilot')
  assert.equal(detail.assigned, 2)
  const alice = detail.users.find((u) => u.name === 'Alice')
  const bob = detail.users.find((u) => u.name === 'Bob')
  assert.deepEqual(alice.skuPartNumbers, ['Microsoft_365_Copilot'])
  assert.deepEqual(bob.skuPartNumbers, ['MICROSOFT_365_COPILOT_DEPT'])
})

test('a user holding BOTH recognized Copilot SKUs at once is counted as ONE seat, never two — no double-counting', () => {
  const connId = makeConnection()
  msRepo.upsertUsers(connId, [graphUser({ id: 'u1', displayName: 'Alice', upn: 'alice@ssp-worldwide.com' })])
  const users = [{ ms_id: 'u1', assigned_licenses: [{ skuId: 'sku-premium' }, { skuId: 'sku-dept' }], assigned_plans: [] }]
  const skus = [
    { skuId: 'sku-premium', skuPartNumber: 'Microsoft_365_Copilot', servicePlans: [] },
    { skuId: 'sku-dept', skuPartNumber: 'MICROSOFT_365_COPILOT_DEPT', servicePlans: [] }
  ]
  msRepo.upsertLicenses(connId, users, skus)

  const overview = licenseOverview()
  const copilotRow = overview.find((r) => r.product === 'Microsoft Copilot')
  assert.equal(copilotRow.assigned, 1, 'one real person with two Copilot SKUs is still exactly one Copilot seat')

  const detail = licenseDetail(COPILOT_BUSINESS_LICENSE_ID)
  assert.equal(detail.assigned, 1)
  assert.deepEqual(detail.users[0].skuPartNumbers.sort(), ['MICROSOFT_365_COPILOT_DEPT', 'Microsoft_365_Copilot'].sort(), 'both real SKUs remain visible as technical detail even though this is one seat')
})

test('a non-Copilot SKU (e.g. Microsoft 365 E3) remains its own separate license row, unaffected by Copilot aggregation', () => {
  const connId = makeConnection()
  msRepo.upsertUsers(connId, [
    graphUser({ id: 'u1', displayName: 'Alice', upn: 'alice@ssp-worldwide.com' }),
    graphUser({ id: 'u2', displayName: 'Carol', upn: 'carol@ssp-worldwide.com' })
  ])
  const users = [
    { ms_id: 'u1', assigned_licenses: [{ skuId: 'sku-premium' }], assigned_plans: [] },
    { ms_id: 'u2', assigned_licenses: [{ skuId: 'sku-e3' }], assigned_plans: [] }
  ]
  const skus = [
    { skuId: 'sku-premium', skuPartNumber: 'Microsoft_365_Copilot', servicePlans: [] },
    { skuId: 'sku-e3', skuPartNumber: 'SPE_E3', servicePlans: [] }
  ]
  msRepo.upsertLicenses(connId, users, skus)

  const overview = licenseOverview()
  assert.equal(overview.length, 2, 'Copilot and E3 must remain two distinct rows')
  const e3Row = overview.find((r) => r.licenseId === 'SPE_E3')
  assert.equal(e3Row.product, 'Microsoft 365')
  assert.equal(e3Row.assigned, 1)

  const e3Detail = licenseDetail('SPE_E3')
  assert.deepEqual(e3Detail.users[0].skuPartNumbers, ['SPE_E3'])
})

test('MONITORED_LICENSES has exactly one Copilot entry, keyed by the business id, not by any individual real SKU', () => {
  assert.ok(MONITORED_LICENSES[COPILOT_BUSINESS_LICENSE_ID])
  assert.equal(MONITORED_LICENSES.MICROSOFT_365_COPILOT_DEPT, undefined, 'the DEPT SKU must not have its own separate MONITORED_LICENSES entry')
})
