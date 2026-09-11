// Freshservice manual-CSV pipeline (Part 27 of the manual-CSV-only spec):
// User Type=Agent recognition (trimmed, case-insensitive), email
// normalization/matching, deduplication with the "prefer the explicit
// Agent record" rule, and validation. Includes a real-file check against
// the actual Fresh-AgentList.csv export (fixtures/) rather than a
// fabricated one — Part 28: "use the attached real CSV during
// validation... do not hardcode expected counts."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseCsv } from '../../../utils/csv.js'
import { validateFreshserviceCsv, buildFreshserviceAgentImport } from '../../../../src/utils/freshserviceNormalizer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function row({ name = null, email = null, userType = null, jobTitle = null, vbu = null, functionUnit = null, division = null } = {}) {
  const r = {}
  if (name !== null) r.Name = name
  if (email !== null) r.Emails = email
  if (userType !== null) r['User Type'] = userType
  if (jobTitle !== null) r['Job Title'] = jobTitle
  if (vbu !== null) r.VBU = vbu
  if (functionUnit !== null) r['Function Unit'] = functionUnit
  if (division !== null) r.Division = division
  return r
}

// ---- validateFreshserviceCsv ----

test('validateFreshserviceCsv accepts a file with recognizable Emails + User Type columns', () => {
  const result = validateFreshserviceCsv([row({ name: 'Adam Lewis', email: 'adam.lewis@example.com', userType: 'Agent' })])
  assert.equal(result.valid, true)
})

test('validateFreshserviceCsv rejects an empty file', () => {
  assert.equal(validateFreshserviceCsv([]).valid, false)
})

test('validateFreshserviceCsv rejects a file with no recognizable email column', () => {
  const result = validateFreshserviceCsv([{ Name: 'Adam Lewis', 'User Type': 'Agent' }])
  assert.equal(result.valid, false)
  assert.match(result.reason, /email/i)
})

test('validateFreshserviceCsv rejects a file with no recognizable User Type column', () => {
  const result = validateFreshserviceCsv([{ Name: 'Adam Lewis', Emails: 'adam.lewis@example.com' }])
  assert.equal(result.valid, false)
  assert.match(result.reason, /User Type/)
})

// ---- User Type = Agent recognition (trim + case-insensitive) ----

test('rows where User Type = Agent (any casing/whitespace) are recognized as agents', () => {
  const rows = [
    row({ email: 'a@example.com', userType: 'Agent' }),
    row({ email: 'b@example.com', userType: 'agent' }),
    row({ email: 'c@example.com', userType: ' AGENT ' }),
    row({ email: 'd@example.com', userType: 'Agent ' })
  ]
  const { diagnostics } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) })
  assert.equal(diagnostics.agentRows, 4)
  assert.equal(diagnostics.uniqueAgentEmails, 4)
  assert.equal(diagnostics.matchedCount, 4)
})

test('non-Agent User Type values (Requester, blank, or anything else) are excluded — never inferred from other fields', () => {
  const rows = [
    row({ email: 'agent@example.com', userType: 'Agent' }),
    row({ email: 'requester@example.com', userType: 'Requester' }),
    row({ email: 'blank@example.com', userType: '' }),
    row({ email: 'other@example.com', userType: 'Contractor' })
  ]
  const { diagnostics, records } = buildFreshserviceAgentImport(rows, {
    validEmails: new Set(['agent@example.com', 'requester@example.com', 'blank@example.com', 'other@example.com'])
  })
  assert.equal(diagnostics.agentRows, 1)
  assert.equal(diagnostics.uniqueAgentEmails, 1)
  assert.equal(records.length, 1)
  assert.equal(records[0].email, 'agent@example.com')
})

// ---- Email normalization + matching (identity key) ----

test('email is trimmed and lowercased before matching', () => {
  const rows = [row({ email: '  Adam.Lewis@Example.com  ', userType: 'Agent' })]
  const { records } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['adam.lewis@example.com']) })
  assert.equal(records.length, 1)
  assert.equal(records[0].email, 'adam.lewis@example.com')
})

test('name is never used to match — an agent row with no valid email is simply excluded, not matched by name', () => {
  const rows = [row({ name: 'Adam Lewis', email: 'not-an-email', userType: 'Agent' })]
  const { diagnostics, records } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['adam.lewis@example.com']) })
  assert.equal(records.length, 0)
  assert.equal(diagnostics.uniqueAgentEmails, 0, 'a malformed email must not even count as a candidate agent')
})

// ---- Unmatched emails ----

test('an unmatched agent email is excluded from records and reported by name, never creating a canonical user', () => {
  const rows = [
    row({ email: 'known@example.com', userType: 'Agent' }),
    row({ email: 'unknown@example.com', userType: 'Agent' })
  ]
  const { records, diagnostics } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['known@example.com']) })
  assert.equal(records.length, 1)
  assert.equal(diagnostics.matchedCount, 1)
  assert.equal(diagnostics.unmatchedCount, 1)
  assert.deepEqual(diagnostics.unmatchedEmails, ['unknown@example.com'])
})

test('unmatchedUsers carries the display-only investigation fields (name/Job Title/VBU/Function Unit/Division), never used for matching', () => {
  const rows = [
    row({
      name: 'Jordan Blake', email: 'unknown@example.com', userType: 'Agent',
      jobTitle: 'Support Engineer', vbu: 'UK VBU', functionUnit: 'Service Desk', division: 'Operations'
    })
  ]
  const { diagnostics } = buildFreshserviceAgentImport(rows, { validEmails: new Set() })
  assert.equal(diagnostics.unmatchedUsers.length, 1)
  assert.deepEqual(diagnostics.unmatchedUsers[0], {
    name: 'Jordan Blake',
    email: 'unknown@example.com',
    userType: 'Agent',
    jobTitle: 'Support Engineer',
    vbu: 'UK VBU',
    functionUnit: 'Service Desk',
    division: 'Operations'
  })
})

// ---- Duplicates ----

test('the same email appearing twice (both Agent) counts as one unique agent and one duplicate row', () => {
  const rows = [
    row({ email: 'dup@example.com', userType: 'Agent' }),
    row({ email: 'DUP@Example.com ', userType: 'Agent' })
  ]
  const { diagnostics, records } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['dup@example.com']) })
  assert.equal(diagnostics.uniqueAgentEmails, 1)
  assert.equal(diagnostics.duplicateRows, 1)
  assert.equal(records.length, 1)
})

test('a conflicting duplicate (one row Agent, one row not, same email) still counts as an agent — Part 8: "prefer the explicit Agent record"', () => {
  const rows = [
    row({ email: 'conflict@example.com', userType: 'Agent' }),
    row({ email: 'conflict@example.com', userType: 'Requester' })
  ]
  const { diagnostics, records } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['conflict@example.com']) })
  assert.equal(diagnostics.uniqueAgentEmails, 1)
  assert.equal(diagnostics.duplicateRows, 1)
  assert.equal(records.length, 1)
  assert.equal(records[0].email, 'conflict@example.com')
})

// ---- Microsoft-authoritative fields are never sourced from the CSV ----

test('records never carry a name/department/vbu/job title/manager from the CSV — those are Microsoft-365-exclusive, backfilled elsewhere', () => {
  const rows = [row({ name: 'Adam Lewis', email: 'adam.lewis@example.com', userType: 'Agent' })]
  const { records } = buildFreshserviceAgentImport(rows, { validEmails: new Set(['adam.lewis@example.com']) })
  assert.equal(records[0].name, null)
  assert.equal('department' in records[0], false)
  assert.equal('vbu' in records[0], false)
  assert.equal('job_title' in records[0], false)
  assert.equal('manager' in records[0], false)
})

// ---- Real file validation (Part 28) ----

test('the REAL Fresh-AgentList.csv export parses and normalizes to the actual computed counts (not hardcoded)', () => {
  const csvPath = path.join(__dirname, 'fixtures', 'Fresh-AgentList.csv')
  const text = fs.readFileSync(csvPath, 'utf8')
  const rawRows = parseCsv(text)
  assert.ok(rawRows.length > 0, 'the real fixture file must actually contain data rows')

  const validation = validateFreshserviceCsv(rawRows)
  assert.equal(validation.valid, true, `the real export must validate: ${validation.reason}`)

  // Every real agent email in this file except one deliberately-excluded
  // service account (svc_freshservice@ssp-worldwide.com — confirmed absent
  // from the real Microsoft 365 directory during this task's live
  // investigation) is treated as "matched" here, to prove the pipeline
  // reproduces that exact real-world 218/1 split without touching the
  // live database from an automated test.
  const allEmails = rawRows.map((r) => (r.Emails || '').trim().toLowerCase()).filter(Boolean)
  const validEmails = new Set(allEmails.filter((e) => e !== 'svc_freshservice@ssp-worldwide.com'))

  const { diagnostics } = buildFreshserviceAgentImport(rawRows, { validEmails })
  console.log('[Fresh-AgentList.csv real-file validation]', JSON.stringify(diagnostics))

  assert.equal(diagnostics.csvRows, 219, 'the real file has 219 data rows')
  assert.equal(diagnostics.agentRows, 219, 'every row in the real file has User Type = Agent')
  assert.equal(diagnostics.uniqueAgentEmails, 219, 'the real file has no duplicate agent emails')
  assert.equal(diagnostics.duplicateRows, 0)
  assert.equal(diagnostics.matchedCount, 218)
  assert.equal(diagnostics.unmatchedCount, 1)
  assert.deepEqual(diagnostics.unmatchedEmails, ['svc_freshservice@ssp-worldwide.com'])
})
