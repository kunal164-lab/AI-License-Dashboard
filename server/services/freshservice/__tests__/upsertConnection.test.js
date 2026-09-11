// Regression test for the actual confirmed root cause of "Freshservice
// appears connected twice": the connection-create route used to call
// connectionsRepo.createConnection() unconditionally on every submit, so a
// failed attempt followed by a retry (or the frontend's own bug — see
// DataSourcesFreshservice.jsx's submitConnect — of never refreshing after
// a failed create, which left the Connect form visible for an indefinite
// number of retries) left one row per attempt. upsertFreshserviceConnection
// is the fix: Freshservice is a singleton-per-app connection, and
// reconfiguring (same method or a method switch) must always resolve to
// exactly one row.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `freshservice-upsert-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run, all } = await import('../../../db/index.js')
const { upsertFreshserviceConnection } = await import('../sync.js')
const connectionsRepo = await import('../../../repositories/connectionsRepo.js')

before(async () => { await initDb() })
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => { run("DELETE FROM connections WHERE source = 'freshservice'") })

test('first call with no existing Freshservice connection creates exactly one row', () => {
  const { connection, created } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  assert.equal(created, true)
  assert.equal(connectionsRepo.listConnections('freshservice').length, 1)
  assert.equal(connection.meta.securityGroupId, 'g1')
})

test('calling it again (the exact "retry after a failed attempt" scenario) updates the SAME row instead of creating a second one', () => {
  const first = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  const second = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents (retry)', securityGroupId: 'g1', enabled: true }
  })
  assert.equal(second.created, false)
  assert.equal(second.connection.id, first.connection.id, 'must reuse the same connection id, never insert a second row')
  const all = connectionsRepo.listConnections('freshservice')
  assert.equal(all.length, 1, 'exactly one Freshservice connection must exist no matter how many times the form is submitted')
  assert.equal(all[0].meta.securityGroupName, 'Agents (retry)', 'the row must reflect the LATEST submitted config')
})

test('switching from ms_group to manual_csv clears the old method\'s fields — no stale cross-method config', () => {
  upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  const { connection } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'manual_csv', msConnectionId: 'ms1', enabled: true }
  })
  assert.equal(connection.meta.sourceMethod, 'manual_csv')
  assert.equal(connection.meta.securityGroupName, null, 'the abandoned ms_group config must not linger')
  assert.equal(connection.meta.securityGroupId, null)
  assert.equal(connectionsRepo.listConnections('freshservice').length, 1)
})

test('switching from manual_csv back to ms_group works symmetrically', () => {
  upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'manual_csv', msConnectionId: 'ms1', enabled: true }
  })
  const { connection } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g2', enabled: true }
  })
  assert.equal(connection.meta.sourceMethod, 'ms_group')
  assert.equal(connection.meta.securityGroupId, 'g2')
})

test('reconfiguring resets stats to 0 so a failed sync under the new config never displays the previous config\'s agent count', () => {
  const first = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  connectionsRepo.updateConnection(first.connection.id, { stats: { users: 50, records: 50 } })
  assert.equal(connectionsRepo.getConnection(first.connection.id).stats.records, 50)

  const { connection } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'manual_csv', msConnectionId: 'ms1', enabled: true }
  })
  assert.equal(connection.stats.records, 0)
  assert.equal(connection.stats.users, 0)
})

test('disconnecting (DELETE) removes both the connection row and its freshservice_agents rows — no orphaned agent data', () => {
  const { connection } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  run(
    `INSERT INTO freshservice_agents (connection_id, record_key, name, email, synced_at) VALUES (?,?,?,?,?)`,
    [connection.id, 'k1', 'Test Agent', 'agent@example.com', new Date().toISOString()]
  )
  assert.equal(all('SELECT * FROM freshservice_agents WHERE connection_id = ?', [connection.id]).length, 1)

  const existed = connectionsRepo.deleteConnection(connection.id)
  assert.equal(existed, true, 'deleteConnection must report that a real connection was actually removed')
  assert.equal(connectionsRepo.getConnection(connection.id), null, 'the connection must actually be gone from the database')
  assert.equal(all('SELECT * FROM freshservice_agents WHERE connection_id = ?', [connection.id]).length, 0, 'its agent rows must not be left orphaned')
})

test('toSafeView never exposes credentials — Freshservice has none of its own, but the safe view must never carry the field at all', () => {
  const { connection } = upsertFreshserviceConnection({
    label: 'Freshservice', authType: 'delegated_graph',
    meta: { sourceMethod: 'ms_group', msConnectionId: 'ms1', securityGroupName: 'Agents', securityGroupId: 'g1', enabled: true }
  })
  const safe = connectionsRepo.toSafeView(connection)
  assert.equal('credentials' in safe, false)
  assert.equal('credentials_enc' in safe, false)
  assert.equal(JSON.stringify(safe).toLowerCase().includes('secret'), false)
})
