// server/services/freshservice/sync.js#importFreshserviceCsv and
// runFreshserviceSync's manual_csv dispatch — the manual-CSV commit path
// (Part 15: validate -> normalize -> filter -> match -> dedupe -> commit,
// never touching the previous successful dataset on failure) and Part 19
// ("Refresh All must not attempt to refresh Freshservice from
// SharePoint... may simply skip Freshservice as a manual source").
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `freshservice-import-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../../db/index.js')
const { importFreshserviceCsv, runFreshserviceSync, upsertFreshserviceConnection } = await import('../sync.js')
const connectionsRepo = await import('../../../repositories/connectionsRepo.js')
const msRepo = await import('../../../repositories/microsoftRepo.js')
const recordsRepo = await import('../../../repositories/recordsRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => {
  run("DELETE FROM connections WHERE source IN ('freshservice','microsoft')")
  run('DELETE FROM microsoft_users')
})

// Seeds one connected Microsoft 365 connection and one canonical Microsoft
// user with the given email — the minimum real population the matching
// step needs, without a live Graph call.
function seedMicrosoftUser(email) {
  const msConn = connectionsRepo.createConnection({ source: 'microsoft', kind: 'api', label: 'SSP Azure', authType: 'client_credentials', credentials: { tenantId: 't', clientId: 'c', clientSecret: 's' }, meta: {} })
  connectionsRepo.updateConnection(msConn.id, { status: 'connected' })
  run(
    `INSERT INTO microsoft_users (connection_id, ms_id, upn, mail, display_name, account_enabled, synced_at) VALUES (?,?,?,?,?,?,?)`,
    [msConn.id, 'ms-1', email, email, 'Test User', 1, new Date().toISOString()]
  )
  return msConn
}

function makeManualCsvConnection(msConnId) {
  return upsertFreshserviceConnection({ label: 'Freshservice', authType: 'delegated_graph', meta: { sourceMethod: 'manual_csv', msConnectionId: msConnId, enabled: true } }).connection
}

test('importFreshserviceCsv commits matched agents and stores accurate diagnostics', () => {
  const msConn = seedMicrosoftUser('matched@example.com')
  const conn = makeManualCsvConnection(msConn.id)

  const rows = [
    { Name: 'Matched Person', Emails: 'matched@example.com', 'User Type': 'Agent' },
    { Name: 'Unmatched Person', Emails: 'unmatched@example.com', 'User Type': 'Agent' },
    { Name: 'Not An Agent', Emails: 'notagent@example.com', 'User Type': 'Requester' }
  ]
  const result = importFreshserviceCsv(conn, rows, 'Fresh-AgentList.csv')
  assert.equal(result.ok, true)
  assert.equal(result.recordCount, 1)
  assert.equal(result.diagnostics.csvRows, 3)
  assert.equal(result.diagnostics.agentRows, 2)
  assert.equal(result.diagnostics.matchedCount, 1)
  assert.equal(result.diagnostics.unmatchedCount, 1)
  assert.deepEqual(result.diagnostics.unmatchedEmails, ['unmatched@example.com'])

  const updated = connectionsRepo.getConnection(conn.id)
  assert.equal(updated.status, 'connected')
  assert.equal(updated.stats.records, 1)
  assert.equal(updated.meta.lastManualImport.fileName, 'Fresh-AgentList.csv')
  assert.equal(updated.meta.lastManualImport.matchedCount, 1)

  const records = recordsRepo.getRecordsForConnection(conn.id)
  assert.equal(records.length, 1)
  assert.equal(records[0].email, 'matched@example.com')
})

test('an invalid CSV is rejected and the previous successful import is completely preserved', () => {
  const msConn = seedMicrosoftUser('keep@example.com')
  const conn = makeManualCsvConnection(msConn.id)

  const goodResult = importFreshserviceCsv(conn, [{ Name: 'Keep', Emails: 'keep@example.com', 'User Type': 'Agent' }], 'good.csv')
  assert.equal(goodResult.ok, true)

  const badResult = importFreshserviceCsv(conn, [{ Foo: 'bar' }], 'bad.csv')
  assert.equal(badResult.ok, false)
  assert.match(badResult.reason, /email|User Type/i)

  const records = recordsRepo.getRecordsForConnection(conn.id)
  assert.equal(records.length, 1, 'the previously imported agent must still be there')
  assert.equal(records[0].email, 'keep@example.com')
  const conn2 = connectionsRepo.getConnection(conn.id)
  assert.equal(conn2.meta.lastManualImport.fileName, 'good.csv', 'the connection must still reflect the last SUCCESSFUL import, not the rejected one')
})

test('runFreshserviceSync on a manual_csv connection is a no-op skip — never attempts an automatic sync', async () => {
  const msConn = seedMicrosoftUser('user@example.com')
  const conn = makeManualCsvConnection(msConn.id)
  const result = await runFreshserviceSync(conn)
  assert.equal(result.ok, true)
  assert.equal(result.body.skipped, true)
  assert.match(result.body.reason, /manual/i)
})
