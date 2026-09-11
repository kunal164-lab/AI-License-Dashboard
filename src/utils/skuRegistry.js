// SKU part number -> friendly product name, for DISPLAY only. The
// underlying `product` field used for filtering/matching throughout the
// app stays exactly 'Microsoft Copilot' (unchanged, zero regression risk
// to existing filters/colors/pages) — this registry only affects labels
// shown next to the real SKU data, never invents a SKU that wasn't
// actually returned by Microsoft Graph. Unmapped SKUs fall back to their
// own real skuPartNumber rather than a fabricated name.
const SKU_PART_TO_LABEL = {
  Microsoft_365_Copilot: 'Microsoft 365 Copilot'
}

export function labelForSkuPartNumber(skuPartNumber) {
  if (!skuPartNumber) return null
  return SKU_PART_TO_LABEL[skuPartNumber] || skuPartNumber
}
