// Regression coverage for the fix to "Copilot license detection only
// recognized ONE SKU string, with no entitlement/plan distinction at all"
// — see copilotEntitlement.js for the live-tenant investigation this is
// based on. Entitlement is derived strictly from the matched SKU, never
// from usage/activity fields on the record.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichCopilotRecords } from '../copilotEnrichment.js'

function user({ upn, mail, msId }) {
  return { ms_id: msId, upn, mail, department: 'IT', job_title: 'Engineer', account_enabled: true }
}

function license({ userMsId, skuId, skuPartNumber, enabledServicePlans }) {
  return { user_ms_id: userMsId, sku_id: skuId, sku_part_number: skuPartNumber, enabled_service_plans: enabledServicePlans, service_plans: enabledServicePlans }
}

test('a Microsoft_365_Copilot holder is enriched with the confirmed "Premium" entitlement, and their real per-user service plans are preserved untouched', () => {
  const records = [{ email: 'premium@ssp-worldwide.com', product: 'Microsoft Copilot' }]
  const users = [user({ upn: 'premium@ssp-worldwide.com', mail: 'premium@ssp-worldwide.com', msId: 'u1' })]
  const licenses = [license({
    userMsId: 'u1', skuId: 'sku-premium', skuPartNumber: 'Microsoft_365_Copilot',
    enabledServicePlans: [
      { servicePlanId: 'p1', servicePlanName: 'M365_COPILOT_APPS', capabilityStatus: 'Enabled' },
      { servicePlanId: 'p2', servicePlanName: 'M365_COPILOT_TEAMS', capabilityStatus: 'Deleted' }
    ]
  })]
  const [enriched] = enrichCopilotRecords(records, { users, licenses })
  assert.equal(enriched.has_copilot_license, true)
  assert.equal(enriched.sku_part_number, 'Microsoft_365_Copilot')
  assert.equal(enriched.plan, 'Premium')
  // Entitlement is a business classification layered ON TOP — it must
  // never replace or flatten the real, per-user enabled/disabled service
  // plan data underneath it.
  assert.equal(enriched.service_plans.length, 2)
  assert.equal(enriched.service_plans[0].capabilityStatus, 'Enabled')
  assert.equal(enriched.service_plans[1].capabilityStatus, 'Deleted')
})

test('a MICROSOFT_365_COPILOT_DEPT holder is recognized as having Copilot and classified "Premium" too — confirmed business rule: every recognized Copilot SKU is Premium', () => {
  const records = [{ email: 'dept@ssp-worldwide.com', product: 'Microsoft Copilot' }]
  const users = [user({ upn: 'dept@ssp-worldwide.com', mail: 'dept@ssp-worldwide.com', msId: 'u2' })]
  const licenses = [license({ userMsId: 'u2', skuId: 'sku-dept', skuPartNumber: 'MICROSOFT_365_COPILOT_DEPT', enabledServicePlans: [] })]
  const [enriched] = enrichCopilotRecords(records, { users, licenses })
  assert.equal(enriched.has_copilot_license, true)
  assert.equal(enriched.sku_part_number, 'MICROSOFT_365_COPILOT_DEPT')
  assert.equal(enriched.plan, 'Premium')
  assert.doesNotMatch(enriched.plan, /^Basic$/)
})

test('a user with no Copilot SKU at all gets no entitlement, never a fabricated one', () => {
  const records = [{ email: 'none@ssp-worldwide.com', product: 'Microsoft Copilot', activity_count: 500 }]
  const users = [user({ upn: 'none@ssp-worldwide.com', mail: 'none@ssp-worldwide.com', msId: 'u3' })]
  const licenses = []
  const [enriched] = enrichCopilotRecords(records, { users, licenses })
  assert.equal(enriched.has_copilot_license, false)
  assert.equal(enriched.plan, null, 'high activity_count must never be used to infer an entitlement — entitlement comes from the SKU only')
})
