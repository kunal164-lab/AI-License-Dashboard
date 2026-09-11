// Source-level guard tests for the profile dropdown's name/VBU display —
// this codebase has no component-render test harness (see
// dashboardViewsAdminRoutes.test.js's own comment for the established
// convention), so these read the real source and assert the
// security/correctness-relevant shape directly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../')
const menuSrc = fs.readFileSync(path.join(repoRoot, 'src/components/UserProfileMenu.jsx'), 'utf8')
const appSrc = fs.readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8')

test('a Local Administrator never displays a VBU value at all — gated on isLocal, not on whether a value happens to be present', () => {
  assert.match(menuSrc, /const vbuLine = isLocal \? null : \(vbu \|\| 'VBU: Not Assigned'\)/, 'expected the vbuLine computation to unconditionally hide VBU for a local-admin identity')
})

test('a real user with no resolvable VBU gets an honest neutral label, never a silently-hidden or fabricated one', () => {
  assert.match(menuSrc, /'VBU: Not Assigned'/)
})

test('the display name comes from the real authenticated user object, never a hardcoded/example name', () => {
  assert.match(menuSrc, /const displayName = isLocal \? \(user\.name \|\| user\.username \|\| 'Administrator'\) : \(user\.name \|\| user\.upn \|\| 'Signed in'\)/)
})

test('App.jsx passes only the raw server-resolved vbu through — no client-side widening/joining logic that could show a Dashboard View\'s VBU as if it were the user\'s own', () => {
  assert.match(appSrc, /const vbuLabel = auth\.vbu \|\| null/)
  assert.doesNotMatch(appSrc, /allowedVbus\.join/, 'must not reconstruct a joined multi-VBU label for display — that pattern is exactly what let a preview be shown as a personal VBU')
})

test('VBU display is never sourced from query/body/localStorage — App.jsx reads only from the session-derived `auth` object', () => {
  const start = appSrc.indexOf('const vbuLabel')
  const end = appSrc.indexOf('\n', start + 200)
  const block = appSrc.slice(Math.max(0, start - 400), end)
  assert.doesNotMatch(block, /localStorage/)
  assert.doesNotMatch(block, /req\.query/)
  assert.doesNotMatch(block, /window\.location/)
})

test('the profile dropdown VBU/role lines truncate rather than stretch the dropdown — text-safety for long VBU names', () => {
  assert.match(menuSrc, /profile-dropdown-meta/, 'expected the truncating class to be applied to the vbu/role lines')
})
