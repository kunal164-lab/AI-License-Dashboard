// License-centric data for Microsoft 365 -> Licenses. Deliberately simple
// (Part 8 of the spec this implements: "do not over-engineer") — a single
// allowlist of the paid/meaningful licenses IT actually cares about, and a
// plain current-assignment count per license, straight from Microsoft
// Graph's own real assignedLicenses data (microsoft_licenses, refreshed on
// every sync). No Cost Engine, no usage classification, no per-record cost
// resolution is involved in this page at all — those calculations still
// exist for Products/Cost (server/services/costEngine.js, costAnalytics.js)
// and are untouched; this page simply doesn't need them anymore.
import * as msRepo from '../repositories/microsoftRepo.js'
import { businessLicenseIdFor, COPILOT_BUSINESS_LICENSE_ID } from './microsoft/copilotEntitlement.js'

// THE single place the "which licenses does IT actually want to monitor"
// rule lives (Part 1 of the spec) — a future Microsoft sync can bring back
// any number of free/trial/preview SKUs or component-only SKUs (like
// EXCHANGESTANDARD, bundled inside E3) and none of them will ever reappear
// here, because this list is checked, never inferred from what Graph
// happens to return. `license` is the specific SKU's real, human-recognized
// Microsoft product name; `product` is the broader product family it
// belongs to (both real Microsoft terminology, never invented) — used for
// the Licenses page's "License" / "Product" columns, never as a second
// identity: the SKU part number (the object's own key) stays the internal
// match key everywhere.
// Microsoft Copilot is deliberately keyed here by COPILOT_BUSINESS_LICENSE_ID
// (== 'Microsoft_365_Copilot'), NOT by every real SKU part number found in
// /subscribedSkus — every recognized Copilot SKU (Microsoft_365_Copilot,
// MICROSOFT_365_COPILOT_DEPT, and any future one isCopilotSku recognizes)
// rolls up into this ONE business row (Part 5/6 of the spec this
// implements: the business user must see one "Microsoft Copilot / Premium"
// product, never a separate row per real SKU). `licenseOverview`/
// `licenseDetail` below group by businessLicenseIdFor(sku), which maps
// every Copilot SKU to this same key — see
// server/services/microsoft/copilotEntitlement.js.
export const MONITORED_LICENSES = {
  SPE_E3: { license: 'Microsoft 365 E3', product: 'Microsoft 365' },
  [COPILOT_BUSINESS_LICENSE_ID]: { license: 'Microsoft 365 Copilot', product: 'Microsoft Copilot' },
  MCOEV: { license: 'Microsoft Teams Phone Standard', product: 'Microsoft Teams' },
  Microsoft_Teams_Audio_Conferencing_select_dial_out: { license: 'Microsoft Teams Audio Conferencing (dial-out)', product: 'Microsoft Teams' },
  PROJECT_P1: { license: 'Project Plan 1', product: 'Project' },
  PROJECTPROFESSIONAL: { license: 'Project Plan 3', product: 'Project' },
  VISIOCLIENT: { license: 'Visio Plan 2', product: 'Visio' },
  PBI_PREMIUM_PER_USER: { license: 'Power BI Premium Per User', product: 'Power BI' },
  PBI_PREMIUM_PER_USER_ADDON: { license: 'Power BI Premium Per User Add-On', product: 'Power BI' },
  POWER_BI_PRO: { license: 'Power BI Pro', product: 'Power BI' },
  POWERAUTOMATE_ATTENDED_RPA: { license: 'Power Automate Premium (Attended RPA)', product: 'Power Automate' },
  EMSPREMIUM: { license: 'Enterprise Mobility + Security E5', product: 'Enterprise Mobility + Security' },
  MCOPSTN1: { license: 'Domestic Calling Plan', product: 'Microsoft Teams' },
  MCOMEETADV: { license: 'Microsoft 365 Audio Conferencing', product: 'Microsoft Teams' }
}

// Category filters are multi-select in this app (ColumnFilterPopover) and
// arrive here as a comma-joined query param — matches costAnalytics.js's
// own applyRowFilters convention so a multi-select Department/VBU/License
// pick narrows to ANY of the chosen values, not silently just the first.
function matchesAny(value, raw) {
  if (!raw) return true
  const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean)
  return values.includes(value)
}

// GET /api/microsoft/licenses — one row per monitored BUSINESS license
// that currently has at least one assignment in the filtered scope.
// "Assigned" counts DISTINCT USERS, not raw license rows — every
// recognized Copilot SKU maps to the SAME business id
// (businessLicenseIdFor), so a person could in principle hold more than
// one of them at once; they must still count as exactly one Copilot seat,
// never two (Part 6 of the spec this implements: "do not double-count
// users who have multiple Copilot-related SKU records"). For every other
// (non-Copilot) license this is a no-op change: the DB's own
// (connection, user, sku) UNIQUE constraint already guarantees one row per
// user per SKU, so distinct-user counting and raw-row counting were always
// identical there.
export function licenseOverview(filters = {}) {
  const users = msRepo.listAllUsers()
  const userByMsId = new Map(users.map((u) => [u.ms_id, u]))
  const usersByBusinessId = new Map()
  for (const lic of msRepo.listAllLicenses()) {
    const sku = lic.sku_part_number
    const businessId = businessLicenseIdFor(sku)
    if (!MONITORED_LICENSES[businessId]) continue
    const user = userByMsId.get(lic.user_ms_id)
    if (!matchesAny(user?.department || null, filters.department)) continue
    if (!matchesAny(user?.vbu || null, filters.vbu)) continue
    if (!usersByBusinessId.has(businessId)) usersByBusinessId.set(businessId, new Set())
    usersByBusinessId.get(businessId).add(lic.user_ms_id)
  }
  const rows = Array.from(usersByBusinessId.entries()).map(([businessId, userIds]) => ({
    licenseId: businessId,
    license: MONITORED_LICENSES[businessId].license,
    product: MONITORED_LICENSES[businessId].product,
    assigned: userIds.size
  }))
  return rows.filter((r) => matchesAny(r.license, filters.license)).sort((a, b) => b.assigned - a.assigned)
}

// GET /api/microsoft/licenses/:licenseId — every user currently assigned to
// one monitored BUSINESS license, for the license detail's user table.
// `licenseId` is the business id (== the real SKU part number for every
// non-Copilot license, since those map 1:1 — see businessLicenseIdFor).
// Department/VBU filters scope this the same way they'd scope the overview
// row this was opened from. Deduplicated by user first (never one row per
// SKU per person) — the real SKU(s) each person actually holds are kept as
// `skuPartNumbers`, secondary/technical detail (Part 5: "SKU-level
// technical information... may be shown as secondary/detail information,
// but must not become separate product cards"), never lost.
export function licenseDetail(licenseId, filters = {}) {
  const meta = MONITORED_LICENSES[licenseId]
  if (!meta) return null
  const users = msRepo.listAllUsers()
  const userByMsId = new Map(users.map((u) => [u.ms_id, u]))
  const licenseRows = msRepo.listAllLicenses().filter((l) => businessLicenseIdFor(l.sku_part_number) === licenseId)
  if (!licenseRows.length) return null

  const skusByUserId = new Map()
  for (const l of licenseRows) {
    if (!skusByUserId.has(l.user_ms_id)) skusByUserId.set(l.user_ms_id, new Set())
    skusByUserId.get(l.user_ms_id).add(l.sku_part_number)
  }

  const scoped = Array.from(skusByUserId.entries())
    .map(([userMsId, skuSet]) => ({ userMsId, skuPartNumbers: Array.from(skuSet), user: userByMsId.get(userMsId) }))
    .filter((r) => matchesAny(r.user?.department || null, filters.department))
    .filter((r) => matchesAny(r.user?.vbu || null, filters.vbu))

  return {
    license: { licenseId, license: meta.license, product: meta.product },
    assigned: scoped.length,
    users: scoped.map((r) => ({
      ms_id: r.userMsId,
      name: r.user?.display_name || null,
      email: r.user?.upn || r.user?.mail || null,
      department: r.user?.department || null,
      vbu: r.user?.vbu || null,
      // Technical/audit detail only — the real Graph SKU(s) this person
      // actually holds. Always exactly one entry except in the rare case
      // someone is assigned more than one recognized Copilot SKU at once.
      skuPartNumbers: r.skuPartNumbers
    }))
  }
}
