// VBU-aware Dashboard View resolution (branding/theme/sidebar-page-
// visibility spec) — resolves a signed-in user's own VBU (Microsoft 365
// directory-sourced, never client-supplied) to an administrator-configured
// Dashboard View, with safe, never-throwing fallbacks at every step. This
// is the DISPLAY/CONFIG layer only — real VBU DATA isolation (Users/
// Products/Cost/Microsoft/Kiro/Claude/etc) is enforced separately, in
// server/auth/vbuScope.js, applied at each business-data route.
import * as microsoftRepo from '../repositories/microsoftRepo.js'
import * as dashboardViewsRepo from '../repositories/dashboardViewsRepo.js'
import * as vbuViewAssignmentsRepo from '../repositories/vbuViewAssignmentsRepo.js'
import { PAGE_KEYS, PAGE_BY_KEY } from '../auth/pages.js'
import { LOGO_REGISTRY, DEFAULT_LOGO_KEY } from '../../src/utils/dashboardViewAssets.js'
import { belongsToVbu, belongsToAnyVbu } from '../auth/vbuScope.js'

// The built-in view every unmapped/unknown VBU (and every local-admin
// session, which has no Microsoft identity at all) falls back to — this is
// literally "today's one fixed experience," so falling back to it is a
// zero-visible-change default until an administrator deliberately assigns
// a VBU to one of the other views.
export const DEFAULT_VIEW_ID = 'SSP'

// A hardcoded, in-code neutral default — used ONLY if the DB genuinely has
// no SSP row at all (a corrupt/fresh database that somehow skipped the
// startup seed). Resolution must never throw or block login, even then.
const HARDCODED_FALLBACK_VIEW = {
  id: DEFAULT_VIEW_ID,
  displayName: 'SSP Central Services',
  description: '',
  logoKey: DEFAULT_LOGO_KEY,
  theme: {},
  pages: [...PAGE_KEYS],
  allowedVbuIds: [],
  isActive: true,
  isBuiltin: true
}

function normalizeIdentifier(v) {
  return v ? String(v).trim().toLowerCase() : null
}

// Resolves the signed-in Microsoft user's own VBU by matching their upn/
// mail against the Microsoft directory (server/repositories/microsoftRepo.js
// #listAllUsers) — the same upn/mail matching convention
// src/utils/userModel.js#buildMicrosoftDirectory already uses client-side.
// A local-admin session (no Microsoft identity) always resolves to null.
export function resolveVbuForUpn(upn) {
  const norm = normalizeIdentifier(upn)
  if (!norm) return null
  const users = microsoftRepo.listAllUsers()
  const match = users.find((u) => normalizeIdentifier(u.upn) === norm || normalizeIdentifier(u.mail) === norm)
  return match?.vbu || null
}

function activeViewOrNull(id) {
  const view = dashboardViewsRepo.getView(id)
  return view && view.isActive ? view : null
}

// vbu -> the one active, NON-DEFAULT view whose OWN allowedVbuIds claims
// it -> built-in SSP fallback -> hardcoded in-code fallback. Never throws,
// never returns null/undefined — every caller can render immediately.
//
// A Dashboard View's "configured VBU(s)" is a SINGLE business concept (a
// view has a display name, configured VBU(s), pages, theme — Dashboard
// View VBU Data Assignment spec) — this must be the exact same field
// computeAllowedVbusForUser below already uses for BUSINESS-DATA scope,
// never a second, independently-maintained mapping. This used to consult a
// separate vbu_view_assignments table (branding-only, see
// migrateVbuAssignmentsIntoAllowedVbuIds's own comment for the concrete bug
// that caused: an administrator could check a view's "VBU Data" boxes
// (allowedVbuIds) — the only VBU control visible while editing that view —
// without realizing a SEPARATE "VBU Assignment" elsewhere in the admin UI
// also had to be created before login-time branding resolution would ever
// pick that view up, so the view's data scope was configured but the user
// still landed on the default view every time). Resolving directly from
// allowedVbuIds makes that impossible: there is only one thing to
// configure, and it can never drift out of sync with itself.
//
// The DEFAULT (SSP Central Services) view is deliberately EXCLUDED from the
// claim search below — confirmed live against the real database: an
// administrator had already configured Central Services' OWN allowedVbuIds
// with several VBUs (including SSP UK & Ireland's and SSP Worldwide's own)
// purely to give the central/admin catch-all view a broader BUSINESS-DATA
// aggregate, with no intention of that also rerouting real UK & Ireland/
// Worldwide users' BRANDING to Central Services. The default view's own
// allowedVbuIds still fully governs ITS OWN data scope (computeAllowedVbusForUser
// below, and applyLocalAdminPreview when an admin explicitly selects it) —
// only its participation in THIS claim search is excluded, exactly because
// "the catch-all default" and "a specific branding claim" are different
// things. server/auth/dashboardViewsAdminRoutes.js's conflict check mirrors
// this same exclusion when validating a save.
export function resolveDashboardView(vbu) {
  if (vbu) {
    const claimed = dashboardViewsRepo.listActiveViews()
      .filter((v) => v.id !== DEFAULT_VIEW_ID)
      .find((v) => belongsToAnyVbu(vbu, v.allowedVbuIds))
    if (claimed) return claimed
  }
  const fallback = activeViewOrNull(DEFAULT_VIEW_ID)
  return fallback || HARDCODED_FALLBACK_VIEW
}

// One-time (idempotent, safe every boot): merges any pre-existing
// vbu_view_assignments row into its dashboard view's OWN allowedVbuIds, so
// nothing an administrator already configured through the old, separate
// "VBU Assignments" admin UI is silently lost now that resolveDashboardView
// above resolves entirely from allowedVbuIds instead. Purely additive
// (never removes a VBU an administrator already added directly) and a
// permanent no-op once every assignment's VBU is already present on its
// view — safe to keep calling on every startup.
export function migrateVbuAssignmentsIntoAllowedVbuIds() {
  for (const a of vbuViewAssignmentsRepo.listAssignments()) {
    const view = dashboardViewsRepo.getView(a.dashboardViewId)
    if (!view) continue
    if (belongsToAnyVbu(a.vbu, view.allowedVbuIds)) continue
    dashboardViewsRepo.updateView(view.id, { allowedVbuIds: [...view.allowedVbuIds, a.vbu] })
  }
}

// The shape sent to the client — never exposes dashboard_json (nothing
// consumes it client-side yet, per the "build only the foundation" scope).
export function toPublicViewConfig(view) {
  return {
    id: view.id,
    displayName: view.displayName,
    logoKey: LOGO_REGISTRY[view.logoKey] ? view.logoKey : DEFAULT_LOGO_KEY,
    theme: view.theme || {},
    pages: view.pages || [],
    // Informational only (Part 5 of the VBU Data Assignment spec: "the
    // frontend can display the current scope... but must not be
    // responsible for enforcing it") — the real enforcement is
    // access.allowedVbus, computed server-side in withDashboardView/
    // applyLocalAdminPreview below and never derived from this field by
    // any client-trusted path.
    allowedVbuIds: view.allowedVbuIds || []
  }
}

// A Dashboard View can only ever NARROW RBAC's allowedPages, never widen
// them (Part 6 of the spec: "Dashboard View Configuration... do not let
// View Configuration grant permissions that RBAC does not allow").
//
// One exception, in the OPPOSITE direction: an adminOnly page key (e.g.
// 'admin-access', 'admin-dashboard-views') present in `allowedPages`
// always survives, regardless of the view's own page list. This can never
// grant anything RBAC didn't already decide — server/auth/adminRoutes.js's
// validAllowedPages already guarantees an adminOnly key only ever reaches
// `allowedPages` for a mapping that also has canWrite — so this exists
// purely to stop a Dashboard View's page list from accidentally locking an
// administrator out of Administration itself (VBU-aware-views spec,
// section 10: "Do not allow the Dashboard View configuration to
// accidentally lock administrators out of Dashboard Views administration").
export function effectivePages(allowedPages, view) {
  const viewPages = new Set(view?.pages || [])
  return (allowedPages || []).filter((key) => viewPages.has(key) || PAGE_BY_KEY[key]?.adminOnly)
}

// Dashboard View VBU Data Assignment spec, Part D: "the final accessible
// data must be the intersection of User authorization + User's permitted
// VBU scope + Dashboard View's configured VBU data scope." For a REAL
// (Microsoft-authenticated) user that reduces to a single value — their
// own authoritative vbu (resolveVbuForUpn) is the one thing RBAC/VBU
// authorization already grants them; a Dashboard View can only ever
// NARROW that, never widen it (same non-negotiable rule effectivePages
// above already applies to page visibility). Two cases:
//   - the view has NO configured allowedVbuIds yet (every view before an
//     administrator explicitly opts in, including the SSP Central
//     Services default) -> defers entirely to the user's own vbu, i.e.
//     TODAY'S EXACT PRE-EXISTING BEHAVIOR ("do not silently overwrite
//     existing administrator configuration" / "existing UK & Ireland and
//     Worldwide configurations remain intact").
//   - the view HAS a configured list -> the user's own vbu must actually
//     be a member of it, or they see nothing (fail closed, never fail
//     open) — this is what stops a view's own generous multi-VBU
//     configuration from ever WIDENING what a specific real user is
//     allowed to see (Part J's own worked example).
// A user with no resolvable vbu at all gets an empty scope regardless —
// unchanged from vbuScope.js's own pre-existing `!access?.vbu` fail-closed
// branches.
export function computeAllowedVbusForUser(vbu, view) {
  if (!vbu) return []
  const configured = view?.allowedVbuIds
  if (!configured || !configured.length) return [vbu]
  return configured.some((v) => belongsToVbu(v, vbu)) ? [vbu] : []
}

// One-time, idempotent (safe on every startup) seed of the three initial
// built-in views — called from server/index.js alongside
// rolesRepo.migrateLegacyRoleMappings(). Each starts with the FULL current
// page-key list and an empty theme override, so nothing visibly changes
// for any user until an administrator edits/assigns a view (Part 24: real
// logos/themes come later). No VBU assignment rows are seeded — an
// administrator must explicitly map a VBU to WORLDWIDE/UK_I.
const BUILTIN_VIEWS = [
  { id: 'SSP', displayName: 'SSP', description: 'The current SSP dashboard experience.', logoKey: 'ssp' },
  { id: 'SSP_WORLDWIDE', displayName: 'SSP Worldwide', description: 'The SSP Worldwide dashboard experience.', logoKey: 'ssp_worldwide' },
  { id: 'SSP_UK_I', displayName: 'SSP UK & I', description: 'The SSP UK & I dashboard experience.', logoKey: 'ssp_uk_i' }
]

export function seedDefaultDashboardViews() {
  for (const def of BUILTIN_VIEWS) {
    if (dashboardViewsRepo.getView(def.id)) continue
    dashboardViewsRepo.createViewWithId({
      id: def.id,
      displayName: def.displayName,
      description: def.description,
      logoKey: def.logoKey,
      theme: {},
      pages: [...PAGE_KEYS],
      dashboard: {},
      isBuiltin: true
    })
  }
}

// One-time, idempotent rename of the built-in 'SSP' view's DISPLAY NAME
// only, to "SSP Central Services" (Dashboard View VBU Data Assignment
// spec — an explicit, deliberate name change, not a new view: "Do not
// rename unrelated technical IDs unless actually necessary" — the id stays
// 'SSP' everywhere, including the existing vbu_view_assignments fallback
// (resolveDashboardView's DEFAULT_VIEW_ID) and every existing reference to
// it). Same `_configVersion` guard as the UK & Ireland/Worldwide config
// functions below (see UK_IRELAND_CONFIG_VERSION's own comment for why
// field-presence alone isn't safe) — merges into whatever theme already
// exists (never replaces it) so a real administrator's own later theme
// edit, or their own allowedVbuIds/pages/logo choice, is never clobbered
// by this rename running again on a later restart. v2: SSP Central
// Services visual-refinement spec ("Option 3") — a subtle warm cream/
// ivory palette (contentBackground/contentBorderColor, both reused
// existing app-wide tokens, never a second background mechanism) plus the
// restrained "Global People / Stronger Together" header treatment,
// reusing the EXISTING small SVG headerGraphicKey component (see
// styles.css's .header-graphic — resized back down to a compact size
// specifically because SSP Worldwide no longer uses it at all, having
// moved to a real background image instead) rather than duplicating a
// second graphic. Accent/sidebar-active/header-accent are left UNSET —
// explicitly keeps the existing professional blue/navy treatment, no
// sidebar decoration key is set (no sidebar artwork), and no header
// height override is added (stays compact/content-driven, exactly as
// before this bump). v3: v2's cream was too strong ("makes the entire
// dashboard look overly yellow/cream" — real user feedback against the
// live app) — every content-area color is pulled MUCH closer to white
// (barely-there warm reflection, not a cream dashboard); adds a single
// new touch, sidebarGradientEnd only (sidebarGradientStart stays UNSET,
// i.e. the exact same cool navy top it always had) — a very dark warm
// tone at the BOTTOM of the sidebar only, a subtle tonal transition, never
// a full sidebar recolor and nowhere near actual yellow (still near-black).
export const CENTRAL_SERVICES_CONFIG_VERSION = 3

export function applyInitialCentralServicesConfig() {
  const view = dashboardViewsRepo.getView(DEFAULT_VIEW_ID)
  if (!view) return
  const currentVersion = Number(view.theme?._configVersion) || 0
  if (currentVersion < CENTRAL_SERVICES_CONFIG_VERSION) {
    dashboardViewsRepo.updateView(DEFAULT_VIEW_ID, {
      displayName: 'SSP Central Services',
      description: 'The SSP Central Services dashboard experience.',
      theme: {
        ...view.theme,
        _configVersion: CENTRAL_SERVICES_CONFIG_VERSION,
        // Barely-there warm reflection — reuses the app's existing
        // --bg/--border tokens (already read by body background, hover
        // states, badges, insight cards, etc.), so this tints all of them
        // consistently rather than a full recolor of any one surface. Kept
        // deliberately close to white/neutral gray — "a white dashboard
        // with a very slight warm reflection," never a visibly cream one.
        contentBackground: '#fdfcf8',
        contentBorderColor: '#e8e4db',
        // Very light warm neutral header background — a flat, barely-
        // perceptible tint, not a large illustrated banner.
        headerBackground: '#fdfcf9',
        // Restrained "Global People / Stronger Together" treatment —
        // reuses the existing small SVG component (HeaderGraphic.jsx),
        // resized compact in styles.css; never a large image/banner.
        headerGraphicKey: 'globe-network',
        // A very dark, warm-toned bottom stop for the sidebar gradient —
        // sidebarGradientStart is deliberately left UNSET (falls back to
        // the base cool navy top, unchanged) so this reads as a subtle
        // tonal transition down the sidebar, never a full recolor and
        // never anywhere close to yellow (still near-black).
        sidebarGradientEnd: '#171310'
      }
    })
  }
}

// One-time, idempotent (safe on every startup) application of the FIRST
// real, fully-designed Dashboard View — SSP UK & Ireland — using the
// approved reference design (charcoal/mauve sidebar with a large official
// logo and flowing blush decoration, a blush header wash, a light active-
// nav pill with dark text) and the official logo (public/
// ssp-uk-ireland-logo.png).
//
// Guarded by an explicit VERSION NUMBER (`theme._configVersion`), not by
// "does some field already exist" — an earlier version of this guard
// checked field presence alone, which meant a later revision of this same
// function (e.g. bumping the logo from 128px to 160px) silently failed to
// re-apply on restart, because the OLD value already satisfied "the field
// exists." Bump UK_IRELAND_CONFIG_VERSION whenever the values below change
// and they need to actually reach an already-configured real database; an
// administrator's own later edit through Administration -> Dashboard Views
// is still respected as long as it sets `_configVersion` to this same
// (or a higher) number — see dashboardViewsAdminRoutes.js, which passes
// the CURRENT version through untouched on every save so a manual edit
// never gets silently re-clobbered on the next restart.
//
// The VBU assignment uses the REAL raw string confirmed against the live
// Microsoft directory ("VBU - SSP UK & Ireland", 166 users at the time of
// this change) — never guessed from the display name, since Microsoft's
// onPremisesExtensionAttributes.extensionAttribute3 values don't
// necessarily match a view's own display name.
// The one approved sidebar logo width — confirmed correct against the
// reference and must NOT be changed again. Shared (not duplicated as a
// literal string) so every Dashboard View that wants "the same prominent
// logo treatment" uses the exact same value, never a per-view variant.
const APPROVED_SIDEBAR_LOGO_WIDTH = '160px'

const UK_IRELAND_VBU = 'VBU - SSP UK & Ireland'
// v3: strengthened header/sidebar decoration (5-layer composition, fixed
// preserveAspectRatio letterboxing bug, dedicated softer mauve/blush
// decoration colors) — logo/position/size are UNCHANGED and approved,
// never touched by this bump. v4: Dashboard View VBU Data Assignment spec
// — seeds allowedVbuIds with this view's own real VBU (the intended
// default: "SSP UK & Ireland -> UK & Ireland VBU"), a genuinely new
// capability that changes nothing observable for a real UK & Ireland user
// (their own vbu was always the only thing they could see anyway —
// computeAllowedVbusForUser's own comment) while giving an administrator
// something to actually edit afterward.
export const UK_IRELAND_CONFIG_VERSION = 4

export function applyInitialUkIrelandConfig() {
  const view = dashboardViewsRepo.getView('SSP_UK_I')
  if (!view) return
  const currentVersion = Number(view.theme?._configVersion) || 0
  if (currentVersion < UK_IRELAND_CONFIG_VERSION) {
    dashboardViewsRepo.updateView('SSP_UK_I', {
      displayName: 'SSP UK & Ireland',
      description: 'The SSP UK & Ireland dashboard experience.',
      logoKey: 'ssp_uk_i',
      allowedVbuIds: [UK_IRELAND_VBU],
      theme: {
        _configVersion: UK_IRELAND_CONFIG_VERSION,
        accent: '#e4002b',
        accentDark: '#b8001f',
        sidebarGradientStart: '#2f2a27',
        sidebarGradientEnd: '#1a1614',
        sidebarActive: '#e4002b',
        // A light blush active-nav pill needs dark text for contrast —
        // these two always travel together (see styles.css's comment on
        // --sidebar-active-bg).
        sidebarActiveBg: '#f6d9dc',
        sidebarActiveText: '#3a1216',
        headerAccent: '#e4002b',
        contentBackgroundWash: '#fbe3e5',
        // APPROVED — do not change size/position again (confirmed
        // correct against the reference). Height is never set explicitly
        // (AppLogo), so aspect ratio is always preserved.
        sidebarLogoWidth: APPROVED_SIDEBAR_LOGO_WIDTH,
        headerDecorationKey: 'blush-curves',
        sidebarDecorationKey: 'blush-flow',
        // Softer mauve/blush tones for the decorative artwork itself,
        // distinct from the crisp #e4002b brand accent used for nav/
        // buttons/borders — matches the reference's softer background
        // artwork vs. sharper accent treatment.
        sidebarDecorationColor: '#d88a9a',
        headerDecorationColor: '#e98a9c'
      }
    })
  }
}

// Same one-time, idempotent pattern for the second real Dashboard View —
// SSP Worldwide. Visually close to the app's own existing base theme
// already (dark navy sidebar, blue accent — confirmed against the
// approved reference screenshot), so only a light theme touch plus the
// official logo and the two new decorative branding fields (Part 3 of the
// spec: header graphic + sidebar tagline, centralized here rather than
// hardcoded into Header.jsx/Sidebar.jsx).
const WORLDWIDE_VBU = 'VBU - SSP Worldwide'
// Same version-marker guard as UK_IRELAND_CONFIG_VERSION above (see its
// comment for why field-presence alone isn't a safe guard) — bump this
// whenever the values below change and must reach an already-configured
// real database. v2: adopted the same approved sidebar logo width as SSP
// UK & Ireland (APPROVED_SIDEBAR_LOGO_WIDTH) — "do not create a different
// sizing rule for Worldwide." v3: visual-alignment pass against the
// approved design — a lighter-blue active-nav pill (was the default
// dark-tint-over-navy treatment), a wider sidebar, a taller header with a
// subtle light-blue wash to give the enlarged header-graphic room, and the
// sidebar tagline restated as three real stacked lines with a horizontal
// accent line above it (styles.css's .sidebar-tagline, via
// white-space:pre-line) rather than the previous single-line/left-border
// treatment. Logo/position/size are UNCHANGED — still
// APPROVED_SIDEBAR_LOGO_WIDTH, never a separate rule. v4: the header was
// visually too dominant at 132px — reduced ~18% to 108px (the header
// graphic's own SVG/tagline sizing in styles.css was scaled down to match,
// since min-height is a floor, not a cap: content taller than it would
// still force the header open regardless of this value). Sidebar/logo/KPI
// grid are untouched by this bump. v5: real, provided artwork (public/
// Worldwide_Deciration.png, cropped to public/assets/dashboard/header-bg-
// worldwide.png + sidebar-bg-worldwide.png) replaces both the SVG-
// recreated header graphic (headerGraphicKey removed — the real header
// artwork already has "Global People Stronger Together" baked in, so the
// separate component would just duplicate it) and the flat CSS gradient
// header wash (headerBackground removed — fully covered by the new opaque
// image anyway). Sidebar/header height/logo/active-nav treatment from v3/
// v4 are unchanged. v6: Dashboard View VBU Data Assignment spec — seeds
// allowedVbuIds with this view's own real VBU (the intended default: "SSP
// Worldwide -> Worldwide VBU"), same as UK & Ireland's own v4 bump —
// changes nothing observable for a real Worldwide user.
export const WORLDWIDE_CONFIG_VERSION = 6

export function applyInitialWorldwideConfig() {
  const view = dashboardViewsRepo.getView('SSP_WORLDWIDE')
  if (!view) return
  const currentVersion = Number(view.theme?._configVersion) || 0
  if (currentVersion < WORLDWIDE_CONFIG_VERSION) {
    dashboardViewsRepo.updateView('SSP_WORLDWIDE', {
      displayName: 'SSP Worldwide',
      description: 'The SSP Worldwide dashboard experience.',
      logoKey: 'ssp_worldwide',
      allowedVbuIds: [WORLDWIDE_VBU],
      theme: {
        _configVersion: WORLDWIDE_CONFIG_VERSION,
        accent: '#0b5fff',
        accentDark: '#0847c4',
        sidebarGradientStart: '#0b1c33',
        sidebarGradientEnd: '#050d1a',
        sidebarActive: '#0b5fff',
        // A lighter blue active-nav pill (approved design calls the
        // previous dark-tint-over-navy default "too dark") needs dark
        // navy text for contrast — these two always travel together (see
        // styles.css's comment on --sidebar-active-bg).
        sidebarActiveBg: '#dbe9ff',
        sidebarActiveText: '#0b1f3a',
        headerAccent: '#0b5fff',
        sidebarTagline: 'A Better\nTomorrow\nTogether.',
        sidebarLogoWidth: APPROVED_SIDEBAR_LOGO_WIDTH,
        // Wider sidebar + taller header, matching the approved reference's
        // more spacious proportions — most other views keep the defaults
        // (236px / auto) via styles.css's :root fallback.
        sidebarWidth: '268px',
        // ~18% shorter than the original 132px — the header no longer
        // reads as the page's dominant visual element while still leaving
        // comfortable room for the real header artwork below.
        headerMinHeight: '108px',
        // Real, provided artwork — a dark-navy world/network globe for the
        // sidebar, a pale-blue world-map banner (with "Global People
        // Stronger Together" already part of the image) for the header.
        // See src/utils/dashboardViewAssets.js#DECORATION_IMAGE_REGISTRY.
        headerDecorationKey: 'globe-header',
        sidebarDecorationKey: 'globe-sidebar'
      }
    })
  }
}

// Local-administrator-only Dashboard View preview (VBU-aware-views spec,
// "Local Administrator" section; scope source updated by the Dashboard
// View VBU Data Assignment spec) — lets the local admin select any
// configured view after login to preview its BRANDING (logo/theme/
// visible pages, via dashboardView/effectiveAllowedPages below) as
// themselves. Deliberately GENERIC — reads the view's own config, never
// hardcoded to one specific view.
//
// IMPORTANT — vbu/allowedVbus/isPreviewingVbu below are informational
// only (surfaced to the client for display, e.g. the profile menu's own
// VBU line) and are NEVER consulted by server/auth/vbuScope.js's
// isAdminAccess any more: an admin's actual business-data access stays
// fully global regardless of which view is selected here. This was a
// deliberate reversal of an earlier design that DID gate real data access
// on `isPreviewingVbu` — see isAdminAccess's own comment for the concrete
// bug that caused (a previewing admin randomly losing access to real
// users' detail pages depending on which view happened to be selected).
// RBAC (role/canWrite/allowedPages) was never touched by this function
// either way.
export function applyLocalAdminPreview(viewId, access) {
  const view = activeViewOrNull(viewId)
  if (!view) return null
  const allowedVbus = view.allowedVbuIds || []
  return {
    ...access,
    // Singular display value only when unambiguous (mirrors a real user's
    // own single vbu) — a multi-VBU preview (e.g. SSP Central Services
    // configured with several) has no single "the" vbu to show; the
    // frontend should read the allowedVbus list instead (Part 5: "VBU:
    // [configured selected VBUs]").
    vbu: allowedVbus.length === 1 ? allowedVbus[0] : null,
    allowedVbus: allowedVbus.length ? allowedVbus : null,
    dashboardView: toPublicViewConfig(view),
    effectiveAllowedPages: effectivePages(access.allowedPages, view),
    isPreviewingVbu: allowedVbus.length > 0,
    selectedDashboardViewId: viewId
  }
}
