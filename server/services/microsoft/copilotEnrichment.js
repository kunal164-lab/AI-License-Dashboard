// Cross-references already-synced Microsoft 365 Copilot USAGE records
// (from usage_records, product='Microsoft Copilot' - the working
// getMicrosoft365CopilotUsageUserDetail report, untouched by this file)
// against the ALSO-already-synced Users & Directory / Licenses capability
// data (microsoft_users / microsoft_licenses), to attach real SKU/service
// plan/account-status fields onto the SAME usage record.
//
// This is a pure, additive READ-time join — it does not touch the Copilot
// usage fetch, its endpoint, or its permission, and it never blocks on or
// fails because of the Users/Licenses capabilities: if those capabilities
// aren't enabled/synced for a connection, every added field is simply left
// null (N/A), never fabricated, and the Copilot usage data itself is
// returned exactly as-is.
//
// Cost is intentionally NOT computed here — see server/services/
// costEngine.js, the single centralized cost engine applied once, for
// every provider, in server/index.js's dashboard route. This file only
// ever attaches SKU/service-plan/account-status fields; costEngine.js
// reads those same fields (sku_id/sku_part_number/plan) for SKU-level
// cost matching afterward.
import { isCopilotSku, resolveCopilotEntitlement } from './copilotEntitlement.js'

export function enrichCopilotRecords(records, { users, licenses }) {
  // Keyed by BOTH upn and mail (when they differ), not just upn with mail as
  // a same-slot fallback — a Copilot usage record's own `email` field may be
  // either variant (some SSP entities have a `mail` on a different domain
  // than their `upn`), and a single-key map silently missed the join
  // whenever it was the non-preferred one (found via a real data audit —
  // see src/utils/userModel.js#buildMicrosoftDirectory for the identical
  // fix and full explanation).
  const userByEmail = new Map()
  for (const u of users || []) {
    const upn = (u.upn || '').toLowerCase()
    const mail = (u.mail || '').toLowerCase()
    if (upn) userByEmail.set(upn, u)
    if (mail && mail !== upn) userByEmail.set(mail, u)
  }
  const licensesByUserId = new Map()
  for (const lic of licenses || []) {
    if (!licensesByUserId.has(lic.user_ms_id)) licensesByUserId.set(lic.user_ms_id, [])
    licensesByUserId.get(lic.user_ms_id).push(lic)
  }

  return (records || []).map((r) => {
    const email = (r.email || '').toLowerCase()
    const user = email ? userByEmail.get(email) : null
    const userLicenses = user ? (licensesByUserId.get(user.ms_id) || []) : []
    const copilotLicense = userLicenses.find((l) => isCopilotSku(l.sku_part_number))
    // `users` only ever contains the SSP-company population (msRepo's
    // upsertUsers/isSspCompany — see server/services/microsoft/sync.js).
    // If the directory HAS data (this connection's Users & Directory
    // capability is genuinely synced) and this email simply isn't in it,
    // that's now a DEFINITIVE answer — either they're not an SSP-company
    // user or they've left the org — not an "unverifiable" one, so it must
    // resolve the same as a real, confirmed non-assignment (false), or a
    // historical usage row would otherwise slip back into the current
    // Copilot population as "unknown" instead of being excluded. `null`
    // (genuinely unverifiable) is reserved for when the directory hasn't
    // been synced at all for this connection.
    const directorySynced = Array.isArray(users) && users.length > 0

    return {
      ...r,
      has_copilot_license: user ? !!copilotLicense : (directorySynced ? false : null),
      sku_id: copilotLicense?.sku_id || null,
      sku_part_number: copilotLicense?.sku_part_number || null,
      // The business plan — 'Premium' for every recognized Copilot SKU
      // (confirmed business rule, see copilotEntitlement.js), regardless of
      // which real SKU (Microsoft_365_Copilot, MICROSOFT_365_COPILOT_DEPT,
      // ...) actually matched. Written to the SAME generic `plan` field
      // every other provider already uses (Products.jsx's plan breakdown,
      // userDetail.js's licensePayload, reports) — not a separate
      // Copilot-only field — so this is the ONE centralized place that
      // decides it, and every existing plan-aware view picks it up for
      // free. Never derived from usage/activity or from individual
      // service-plan enabled/disabled state.
      plan: copilotLicense ? resolveCopilotEntitlement(copilotLicense.sku_part_number) : null,
      // The real, per-USER enabled/disabled service plans for this SKU
      // (cross-referenced from assignedPlans at sync time — see
      // microsoftRepo.js#upsertLicenses) — NOT the raw tenant-wide SKU
      // catalog, which would show the same list for every holder
      // regardless of their own disabled plans.
      service_plans: copilotLicense?.enabled_service_plans || copilotLicense?.service_plans || null,
      license_status: copilotLicense ? 'assigned' : (user ? 'unassigned' : (directorySynced ? 'unassigned' : r.license_status)),
      account_enabled: user ? !!user.account_enabled : null,
      job_title: user?.job_title || null,
      // Real Graph fields, surfaced onto the record so the canonical-user
      // identity merge (src/utils/userModel.js) has genuine Microsoft-side
      // data to prioritize — Graph has no separate "role" concept, so
      // job_title is the closest real analogue. Never fabricated: left
      // null when Graph itself has no value or the Users & Directory
      // capability isn't synced.
      department: user?.department || null,
      role: user?.job_title || null,
      source: 'Microsoft Graph',
      source_endpoint: 'Copilot Usage User Detail (getMicrosoft365CopilotUsageUserDetail)',
      license_source: copilotLicense ? 'Microsoft Graph (/subscribedSkus + assignedLicenses)' : (user ? 'Microsoft Graph — no Microsoft 365 Copilot SKU assigned' : null)
    }
  })
}

// The dashboard's product/license population is CURRENT ASSIGNMENT, not
// "appeared in a usage report" — Microsoft's Copilot usage report can (and
// does) contain historical activity from a user who no longer has the
// license, and that must never create a current Microsoft Copilot product/
// license relationship (Copilot Users/Assigned Licenses/Cost/Optimization
// all read whatever this returns). enrichCopilotRecords above stays a pure
// 1:1 annotate-only map (every usage-report row keeps its
// has_copilot_license verdict); this is the separate, explicit step both
// callers (server/index.js's /api/dashboard, recordsPipeline.js) apply
// afterward to actually EXCLUDE the ones enrichment definitively confirmed
// are unassigned (has_copilot_license === false — this now also covers a
// person no longer found in the SSP-company-filtered directory, once that
// directory actually has data; see enrichCopilotRecords' directorySynced
// check above) from the current population. A record whose assignment
// couldn't be verified AT ALL (has_copilot_license === null — the Users &
// Directory/Licenses capabilities aren't synced for this connection yet)
// is deliberately left in — we never exclude someone we have no way to
// confirm one way or the other. The raw historical usage row itself is
// untouched in usage_records; only whether it's treated as a CURRENT
// license relationship changes here.
export function excludeUnlicensedCopilotUsage(records) {
  return (records || []).filter((r) => !(r.product === 'Microsoft Copilot' && r.has_copilot_license === false))
}
