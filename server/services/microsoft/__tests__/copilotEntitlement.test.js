// Regression coverage for Microsoft 365 Copilot entitlement classification
// — see copilotEntitlement.js's own header comment for the live-tenant
// investigation and the confirmed business rule: every recognized Copilot
// SKU in this tenant is classified 'Premium', a business decision, never
// derived from service-plan enabled/disabled state or usage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCopilotSku, resolveCopilotEntitlement, businessLicenseIdFor, COPILOT_SKU_PART_NUMBERS, COPILOT_ENTITLEMENT_LABEL, COPILOT_PRODUCT_NAME, COPILOT_BUSINESS_LICENSE_ID } from '../copilotEntitlement.js'

test('recognizes both real Copilot SKU part numbers found in the live tenant', () => {
  assert.equal(isCopilotSku('Microsoft_365_Copilot'), true)
  assert.equal(isCopilotSku('MICROSOFT_365_COPILOT_DEPT'), true)
})

test('does not recognize an unrelated SKU as Copilot', () => {
  assert.equal(isCopilotSku('SPE_E3'), false)
  assert.equal(isCopilotSku(null), false)
  assert.equal(isCopilotSku(undefined), false)
})

test('Microsoft_365_Copilot classifies as exactly "Premium"', () => {
  assert.equal(resolveCopilotEntitlement('Microsoft_365_Copilot'), 'Premium')
})

test('MICROSOFT_365_COPILOT_DEPT classifies as exactly "Premium" too — confirmed business rule: every recognized Copilot SKU is Premium', () => {
  assert.equal(resolveCopilotEntitlement('MICROSOFT_365_COPILOT_DEPT'), 'Premium')
})

test('a hypothetical THIRD Copilot SKU also classifies as Premium as soon as it is recognized — no separate per-SKU label entry needed', () => {
  const fakeSku = 'MICROSOFT_365_COPILOT_FRONTLINE_TEST_ONLY'
  assert.equal(resolveCopilotEntitlement(fakeSku), null, 'not yet recognized, so no entitlement — this is the "before adding it" baseline')
  COPILOT_SKU_PART_NUMBERS.push(fakeSku)
  try {
    assert.equal(resolveCopilotEntitlement(fakeSku), 'Premium', 'the moment a SKU is recognized, it classifies as Premium automatically — proving this is "any recognized Copilot SKU", not a hardcoded per-SKU lookup table')
  } finally {
    COPILOT_SKU_PART_NUMBERS.pop() // leave the shared exported array exactly as every other test found it
  }
})

test('resolveCopilotEntitlement returns exactly the string "Premium" — never "Premium Plan", "M365 Copilot Premium", or "Unknown"', () => {
  const result = resolveCopilotEntitlement('Microsoft_365_Copilot')
  assert.equal(result, 'Premium')
  assert.notEqual(result, 'Premium Plan')
  assert.notEqual(result, 'M365 Copilot Premium')
  assert.doesNotMatch(result, /Unknown/)
  assert.equal(COPILOT_ENTITLEMENT_LABEL, 'Premium')
})

test('resolveCopilotEntitlement returns null for a non-Copilot SKU (no license, nothing to report an entitlement for) — never automatically becomes Premium', () => {
  assert.equal(resolveCopilotEntitlement('SPE_E3'), null)
  assert.equal(resolveCopilotEntitlement(null), null)
})

test('COPILOT_SKU_PART_NUMBERS is the exact real set found live — exactly two entries, no more, no less', () => {
  assert.deepEqual([...COPILOT_SKU_PART_NUMBERS].sort(), ['MICROSOFT_365_COPILOT_DEPT', 'Microsoft_365_Copilot'].sort())
})

test('businessLicenseIdFor maps every recognized Copilot SKU to the SAME business id — this is what lets multiple real SKUs aggregate into one product row', () => {
  assert.equal(businessLicenseIdFor('Microsoft_365_Copilot'), COPILOT_BUSINESS_LICENSE_ID)
  assert.equal(businessLicenseIdFor('MICROSOFT_365_COPILOT_DEPT'), COPILOT_BUSINESS_LICENSE_ID)
})

test('businessLicenseIdFor maps a non-Copilot SKU to itself — unaffected, still one row per real SKU', () => {
  assert.equal(businessLicenseIdFor('SPE_E3'), 'SPE_E3')
})

test('COPILOT_PRODUCT_NAME is the one user-facing business product name', () => {
  assert.equal(COPILOT_PRODUCT_NAME, 'Microsoft Copilot')
})
