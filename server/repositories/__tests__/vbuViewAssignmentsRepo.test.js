// VBU -> Dashboard View assignment storage — CRUD, unique-VBU constraint,
// trimmed/case-insensitive lookup. Runs against an isolated temp SQLite
// file (never the real app.sqlite).
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDbPath = path.join(os.tmpdir(), `vbu-view-assignments-repo-test-${Date.now()}.sqlite`)
process.env.DATABASE_URL = `file:${tmpDbPath}`

const { initDb, run } = await import('../../db/index.js')
const dashboardViewsRepo = await import('../dashboardViewsRepo.js')
const vbuViewAssignmentsRepo = await import('../vbuViewAssignmentsRepo.js')

let viewId

before(async () => {
  await initDb()
  viewId = dashboardViewsRepo.createView({ displayName: 'Assignment Target View' }).view.id
})
after(() => { try { fs.unlinkSync(tmpDbPath) } catch (e) {} })
beforeEach(() => { run('DELETE FROM vbu_view_assignments') })

test('createAssignment creates a VBU -> view mapping', () => {
  const result = vbuViewAssignmentsRepo.createAssignment({ vbu: 'SSP Worldwide', dashboardViewId: viewId })
  assert.equal(result.ok, true)
  assert.equal(result.assignment.vbu, 'SSP Worldwide')
  assert.equal(result.assignment.dashboardViewId, viewId)
})

test('createAssignment rejects a blank VBU', () => {
  const result = vbuViewAssignmentsRepo.createAssignment({ vbu: '   ', dashboardViewId: viewId })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
})

test('createAssignment rejects a second assignment for the same VBU (case/whitespace-insensitive)', () => {
  vbuViewAssignmentsRepo.createAssignment({ vbu: 'SSP UK & I', dashboardViewId: viewId })
  const dup = vbuViewAssignmentsRepo.createAssignment({ vbu: '  ssp uk & i  ', dashboardViewId: viewId })
  assert.equal(dup.ok, false)
  assert.equal(dup.status, 409)
})

test('getAssignmentByVbu matches trimmed and case-insensitively', () => {
  vbuViewAssignmentsRepo.createAssignment({ vbu: 'SSP Worldwide', dashboardViewId: viewId })
  const found = vbuViewAssignmentsRepo.getAssignmentByVbu('  ssp worldwide  ')
  assert.ok(found)
  assert.equal(found.dashboardViewId, viewId)
})

test('getAssignmentByVbu returns null for an unmapped VBU', () => {
  assert.equal(vbuViewAssignmentsRepo.getAssignmentByVbu('Nonexistent VBU'), null)
  assert.equal(vbuViewAssignmentsRepo.getAssignmentByVbu(null), null)
})

test('updateAssignment changes the VBU/target view without changing the id', () => {
  const { assignment } = vbuViewAssignmentsRepo.createAssignment({ vbu: 'Original VBU', dashboardViewId: viewId })
  const updated = vbuViewAssignmentsRepo.updateAssignment(assignment.id, { vbu: 'Renamed VBU' })
  assert.equal(updated.id, assignment.id)
  assert.equal(updated.vbu, 'Renamed VBU')
})

test('deleteAssignment removes the mapping', () => {
  const { assignment } = vbuViewAssignmentsRepo.createAssignment({ vbu: 'Deletable VBU', dashboardViewId: viewId })
  const existed = vbuViewAssignmentsRepo.deleteAssignment(assignment.id)
  assert.equal(existed, true)
  assert.equal(vbuViewAssignmentsRepo.getAssignment(assignment.id), null)
})
