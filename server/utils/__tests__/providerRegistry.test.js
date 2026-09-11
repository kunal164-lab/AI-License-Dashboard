import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capabilitiesForProduct } from '../../../src/utils/providerRegistry.js'

test('Freshservice is cost-tracked but not usage-tracked or optimization-eligible', () => {
  const c = capabilitiesForProduct('Freshservice')
  assert.equal(c.usageTrackingSupported, false)
  assert.equal(c.optimizationEligible, false)
  assert.equal(c.costTrackingSupported, true)
})

test('every other product defaults to fully usage-tracked/optimization-eligible/cost-tracked (no regression to existing behavior)', () => {
  for (const product of ['Kiro', 'Claude', 'Microsoft Copilot', 'GitHub Copilot', 'Some Future Product']) {
    const c = capabilitiesForProduct(product)
    assert.deepEqual(c, { usageTrackingSupported: true, optimizationEligible: true, costTrackingSupported: true }, product)
  }
})
