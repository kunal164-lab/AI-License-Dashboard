// Recognizes real Microsoft 365 Copilot license SKUs and classifies their
// business entitlement/plan label ("Premium"). THE one authoritative place
// this mapping lives — every consumer (copilotEnrichment.js, detail.js,
// userDetail.js, and everything downstream of them) calls into this file
// rather than re-deriving the rule.
//
// INVESTIGATION (2026-09-10, live against the real connected SSP tenant):
// /subscribedSkus currently lists TWO distinct Copilot-related SKUs:
//   - Microsoft_365_Copilot        (178 assigned seats at investigation time)
//   - MICROSOFT_365_COPILOT_DEPT   (1 assigned seat at investigation time)
// Both carry the IDENTICAL 10 service plans (M365_COPILOT_APPS,
// M365_COPILOT_BUSINESS_CHAT, M365_COPILOT_TEAMS, M365_COPILOT_SHAREPOINT,
// M365_COPILOT_CONNECTORS, M365_COPILOT_INTELLIGENT_SEARCH,
// GRAPH_CONNECTORS_COPILOT, COPILOT_STUDIO_IN_COPILOT_FOR_M365,
// WORKPLACE_ANALYTICS_INSIGHTS_USER/BACKEND) — confirmed by comparing a
// real holder of EACH SKU's own live assignedPlans: every one of those
// plans showed capabilityStatus "Enabled" for both people, with no
// difference at all. Graph's service-plan data cannot be used to derive a
// Basic/Premium/Chat-tier split on its own.
//
// BUSINESS RULE (confirmed 2026-09-10, superseding the earlier per-SKU
// "only report Premium for the one independently-verified SKU, Unknown for
// the rest" policy): the business has since confirmed directly that EVERY
// Microsoft Copilot license currently in use in this tenant — every SKU
// variant `isCopilotSku` recognizes — is a Copilot Premium plan. This is a
// business classification decision, not something re-derived from Graph
// service-plan data (which, per the investigation above, cannot express
// it) — so any SKU added to COPILOT_SKU_PART_NUMBERS below is classified
// Premium automatically, with no separate per-SKU label table to maintain.
// If that business fact ever changes (a genuine Basic/Chat-tier SKU is
// introduced), update the rule here — the one place it lives — rather than
// adding conditionals elsewhere.
export const COPILOT_SKU_PART_NUMBERS = ['Microsoft_365_Copilot', 'MICROSOFT_365_COPILOT_DEPT']

export const COPILOT_ENTITLEMENT_LABEL = 'Premium'

// The ONE user-facing business product name every recognized Copilot SKU
// rolls up into — never the raw SKU string. Used by the Microsoft 365
// Licenses page to aggregate multiple real SKU rows into a single business
// product/plan row (Part 5/6 of the spec this implements: "the dashboard
// should present Microsoft Copilot as ONE product," never
// "Microsoft Copilot - Microsoft_365_Copilot" / "... - DEPT"). Also reused
// as the stable business "license id" that aggregation groups by, so a
// business SKU id and a real Microsoft SKU part number are never confused
// with each other.
export const COPILOT_PRODUCT_NAME = 'Microsoft Copilot'
export const COPILOT_BUSINESS_LICENSE_ID = 'Microsoft_365_Copilot'

export function isCopilotSku(skuPartNumber) {
  return COPILOT_SKU_PART_NUMBERS.includes(skuPartNumber)
}

// Returns 'Premium' for any recognized Copilot SKU (the confirmed business
// rule above), or null if `skuPartNumber` isn't a Copilot SKU at all (no
// license, nothing to report an entitlement for). Never derived from
// service-plan enabled/disabled state or usage — SKU recognition alone
// decides this.
export function resolveCopilotEntitlement(skuPartNumber) {
  if (!isCopilotSku(skuPartNumber)) return null
  return COPILOT_ENTITLEMENT_LABEL
}

// The stable business identifier a license/product view should group a
// recognized Copilot SKU under — every real Copilot SKU maps to the SAME
// id (COPILOT_BUSINESS_LICENSE_ID) regardless of which one it actually is,
// so multiple real SKU rows aggregate into one business product row rather
// than appearing as separate products. A non-Copilot SKU maps to itself
// (unchanged, 1:1 — this only ever affects Copilot SKUs).
export function businessLicenseIdFor(skuPartNumber) {
  return isCopilotSku(skuPartNumber) ? COPILOT_BUSINESS_LICENSE_ID : skuPartNumber
}
