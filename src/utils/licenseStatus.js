// Canonical LICENSE STATUS helper — deliberately separate from usage/
// activity classification (src/utils/activityScore.js's activityStatusFor,
// which answers "how much are they using it," never "do they have it").
//
// "Does this person currently have the license assigned/enabled?" is
// answered ONLY from whatever a provider's normalizer/enrichment already
// established as `record.license_status` (e.g. Microsoft Graph's real
// license assignment via server/services/microsoft/copilotEnrichment.js,
// or an explicit Freshservice CSV status column) — never from
// activity_count/last_activity, which several places in this app used to
// treat as a proxy for "inactive license." That conflation was the bug:
// a license with zero recorded usage is not the same as a license that
// was revoked/unassigned.
//
// The raw `license_status` value differs by provider ('assigned'/
// 'unassigned' from Microsoft/generic normalizers, 'Active'/'Inactive'
// from a Freshservice CSV's own status column) — this file normalizes
// across that vocabulary for classification/display without renaming the
// stored value itself, so existing filters/exports that already match on
// the raw string keep working unchanged.
const NEGATIVE_VALUES = new Set(['unassigned', 'inactive', 'disabled', 'revoked', 'removed', 'expired', 'suspended', 'deactivated'])

// Missing/unknown status is NEVER treated as inactive — Part 2 of the spec
// this implements is explicit: "Inactive" only when the source EXPLICITLY
// establishes it. A record with no status information at all is assumed
// active (matching every normalizer's own default of 'assigned').
export function isLicenseActive(record) {
  const v = record?.license_status
  if (v === null || v === undefined || v === '') return true
  return !NEGATIVE_VALUES.has(String(v).trim().toLowerCase())
}

// Display-only normalized label — 'Active' / 'Inactive' / 'Unknown' — used
// wherever the UI shows a human-readable license status distinct from the
// raw stored value (which stays whatever the source provider produced).
export function licenseStatusLabel(record) {
  const v = record?.license_status
  if (v === null || v === undefined || v === '') return 'Unknown'
  return isLicenseActive(record) ? 'Active' : 'Inactive'
}
