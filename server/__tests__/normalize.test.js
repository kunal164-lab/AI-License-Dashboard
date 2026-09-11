// Regression test for the fix to a real gap: server/normalize.js's 'kiro'
// dispatch used to silently drop the `validEmails` argument before calling
// src/utils/kiroNormalizer.js#normalizeKiro, even though runSync (server/
// index.js) already builds it from msRepo.listAllUsers() — meaning a live
// Kiro OAuth/API sync (unlike the manual CSV import route, or every other
// provider) could create canonical users for emails outside the Microsoft
// 365 directory. Part of "a provider must never silently increase the
// canonical user population" (see src/utils/userModel.js's matching fix).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBySource } from '../normalize.js'

function kiroRow(email) {
  return {
    Date: '2026-09-01', UserId: email, Client_Type: 'KIRO_IDE', Chat_Conversations: '1',
    Credits_Used: '1', Subscription_Tier: 'PRO', Total_Messages: '1', right_PrimaryEmail: email
  }
}

test('normalizeBySource forwards validEmails through to Kiro, gating out unmatched emails', () => {
  const rows = [kiroRow('known@ssp-worldwide.com'), kiroRow('unknown@ssp-worldwide.com')]
  const validEmails = new Set(['known@ssp-worldwide.com'])
  const records = normalizeBySource('kiro', rows, { validEmails })
  assert.equal(records.length, 1, 'the unmatched Kiro row must be excluded, matching the manual CSV import gate')
  assert.equal(records[0].email, 'known@ssp-worldwide.com')
})

test('normalizeBySource kiro dispatch is ungated when no validEmails is supplied (back-compat)', () => {
  const rows = [kiroRow('anyone@ssp-worldwide.com')]
  const records = normalizeBySource('kiro', rows, {})
  assert.equal(records.length, 1)
})
