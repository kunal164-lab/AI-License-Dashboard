// Regression coverage for the CSV/Excel formula-injection fix (security
// audit, 2026-09-12, CWE-1236) — neutralizeFormula is the one function
// every export path (csvReport.js, excelReport.js, datasetExport.js,
// costRowsExport.js, server/auth/adminRoutes.js's audit-log CSV export)
// now runs every string cell through before it reaches a CSV/XLSX writer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neutralizeFormula } from '../formulaSafety.js'

test('neutralizeFormula prefixes a leading apostrophe onto a value starting with =, +, -, or @ — the characters Excel/Sheets treat as the start of a formula', () => {
  assert.equal(neutralizeFormula('=cmd|\'/c calc\'!A1'), "'=cmd|'/c calc'!A1")
  assert.equal(neutralizeFormula('=HYPERLINK("http://evil.example")'), '\'=HYPERLINK("http://evil.example")')
  assert.equal(neutralizeFormula('+1234'), "'+1234")
  assert.equal(neutralizeFormula('-1234'), "'-1234")
  assert.equal(neutralizeFormula('@SUM(A1:A2)'), "'@SUM(A1:A2)")
})

test('neutralizeFormula also catches a leading tab or carriage return, another way spreadsheets can be tricked into treating a cell as a formula', () => {
  assert.equal(neutralizeFormula('\t=1+1'), "'\t=1+1")
  assert.equal(neutralizeFormula('\r=1+1'), "'\r=1+1")
})

test('neutralizeFormula leaves an ordinary value completely unchanged — this must never alter legitimate data', () => {
  assert.equal(neutralizeFormula('Sunny Mahaveer'), 'Sunny Mahaveer')
  assert.equal(neutralizeFormula('sunny.mahaveer@ssp-worldwide.com'), 'sunny.mahaveer@ssp-worldwide.com')
  assert.equal(neutralizeFormula(''), '')
  assert.equal(neutralizeFormula('Insurer Business Consultancy'), 'Insurer Business Consultancy')
})

test('neutralizeFormula passes non-string values through untouched (numbers, booleans, null, undefined) — only string cells can carry a formula', () => {
  assert.equal(neutralizeFormula(42), 42)
  assert.equal(neutralizeFormula(0), 0)
  assert.equal(neutralizeFormula(true), true)
  assert.equal(neutralizeFormula(null), null)
  assert.equal(neutralizeFormula(undefined), undefined)
})

test('a value that merely CONTAINS = elsewhere (not at the start) is left alone — only a genuinely leading formula-trigger character is neutralized', () => {
  assert.equal(neutralizeFormula('Total=Cost'), 'Total=Cost')
  assert.equal(neutralizeFormula('user+tag@example.com'), 'user+tag@example.com')
})
