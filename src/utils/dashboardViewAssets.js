// Centralized logo resolution for VBU-aware Dashboard Views — THE single
// place a dashboard view's logo_key maps to a real asset path (Part 9 of
// the VBU-aware-views spec: "do not duplicate logo paths throughout the
// code... create centralized logo mapping"). Mirrors the existing
// BrandLogo.jsx/brandRegistry.js pattern used for provider marks (Microsoft/
// GitHub/Claude/etc) — one resolver, called from the couple of places that
// need it, rather than each hardcoding a path.
//
// SSP temporarily points at the base logo (Part 24 of the spec: "do not
// wait for the logos to build the architecture... I will provide the
// official logos after the foundation is implemented"). SSP Worldwide and
// SSP UK & Ireland's official logos have both been provided. Once SSP's
// own dedicated logo is provided too, drop it under public/ and update
// ONLY the path below — no component needs to change.
export const LOGO_REGISTRY = {
  ssp: '/ssp-logo.png',
  ssp_worldwide: '/ssp-worldwide-logo.png', // official SSP Worldwide logo
  ssp_uk_i: '/ssp-uk-ireland-logo.png' // official SSP UK & Ireland logo
}

export const DEFAULT_LOGO_KEY = 'ssp'

export const LOGO_KEYS = Object.keys(LOGO_REGISTRY)

export function resolveLogo(logoKey) {
  return LOGO_REGISTRY[logoKey] || LOGO_REGISTRY[DEFAULT_LOGO_KEY]
}

// The fixed set of CSS custom properties a Dashboard View's theme may
// override (Part 10 of the spec: "subtle differences... centralized theme
// tokens", not a full re-skin). Any key a view's theme_json omits keeps
// the base value already declared in :root (src/styles.css) — see
// src/utils/theme.js#applyDashboardTheme, which reads this same list.
export const THEME_TOKEN_KEYS = [
  'accent',
  'accentDark',
  'sidebarGradientStart',
  'sidebarGradientEnd',
  'sidebarActive',
  // Solid active-nav-item BACKGROUND override (e.g. SSP UK & Ireland's
  // light blush pill) — omitted entirely for every other view, which
  // falls back to the original translucent-tint-over-dark-sidebar look
  // (see styles.css's var() fallback). Always set TOGETHER with
  // sidebarActiveText below — a light background needs dark text.
  'sidebarActiveBg',
  // Text color for the ACTIVE nav item specifically — most views keep the
  // default white (nav text everywhere else), but a light/blush active
  // background (e.g. SSP UK & Ireland's approved design) needs dark text
  // over it for readability, so this is separately overridable rather than
  // baked into the same --sidebar-active color used for the background.
  'sidebarActiveText',
  'headerAccent',
  // Subtle top-of-content blush/pink wash (SSP UK & Ireland's approved
  // reference design) — defaults to fully transparent for every other
  // view, so it's an opt-in embellishment, never a base-theme change.
  'contentBackgroundWash',
  // Sidebar logo width override (CSS length, e.g. "120px") — most views
  // keep the default (72px); a view whose approved design calls for a
  // visually prominent, larger logo can override just this one value.
  // Height is never set explicitly (src/components/AppLogo.jsx), so the
  // logo's aspect ratio is always preserved regardless of this override.
  'sidebarLogoWidth',
  // Decorative-artwork colors — deliberately SEPARATE from
  // sidebarActive/headerAccent (the sharp brand accent used for nav/
  // buttons/borders): the approved SSP UK & Ireland reference uses a
  // softer mauve/blush tone for the background artwork itself. Falls back
  // to the accent color (CSS var() fallback, see styles.css) for any view
  // that sets a decoration key without its own dedicated decoration color.
  'sidebarDecorationColor',
  'headerDecorationColor',
  // Sidebar width override (CSS length, e.g. "268px") — most views keep
  // the default (236px); a view whose approved design calls for a wider,
  // more spacious sidebar (e.g. SSP Worldwide) can override just this one
  // value, mirroring sidebarLogoWidth's own pattern.
  'sidebarWidth',
  // Header minimum-height override (CSS length) — most views leave the
  // header's height implicit (content-driven); a view with substantially
  // larger header artwork/branding (e.g. SSP Worldwide's world-map
  // graphic) can reserve more vertical space via this token.
  'headerMinHeight',
  // Raw CSS `background` value for the header itself (e.g. a subtle
  // light-blue-to-white gradient) — defaults to a plain white so every
  // view besides one that explicitly sets it looks exactly as before.
  'headerBackground',
  // Main content area background (SSP Central Services' subtle warm
  // cream/ivory palette) — maps straight onto the app's existing --bg
  // token (body background, hover states, badges, insight cards, etc.
  // already all read var(--bg)), so one override tints all of them
  // consistently instead of introducing a second, parallel background
  // mechanism. Defaults to the existing cool gray for every other view.
  'contentBackground',
  // Same idea for the app's existing --border token (a "slightly warmer
  // neutral" border tone) — subtle, optional, defaults to the existing
  // cool border color for every view that doesn't set it.
  'contentBorderColor'
]

// Decorative header/sidebar graphics (Part 3 of the SSP Worldwide spec —
// "keep decorative graphics centralized as part of the Dashboard View
// branding ... rather than hardcoding them separately into individual
// pages", reaffirmed for SSP UK & Ireland's own header/sidebar decoration).
// These are just the lists of valid keys, used for admin-side validation
// (server/auth/dashboardViewsAdminRoutes.js#validTheme).
//
// headerGraphicKey: a foreground decorative graphic WITH content (e.g.
// SSP Worldwide's globe + "Global People Stronger Together" text),
// rendered inline in the header's normal layout flow
// (src/components/HeaderGraphic.jsx) — a real component, not an image.
export const HEADER_GRAPHIC_KEYS = ['globe-network']

// headerDecorationKey / sidebarDecorationKey: a background wash sitting
// BEHIND the header/sidebar's real content — never interactive, never
// affects layout or navigation. SSP UK & Ireland's own artwork ('blush-
// curves'/'blush-flow') is a REAL, provided image asset (cropped from the
// approved design reference), rendered via src/components/HeaderDecoration
// .jsx/SidebarDecoration.jsx as a plain <img>, never recreated with CSS/
// SVG — see DECORATION_IMAGE_REGISTRY below, the single place each key
// resolves to its real asset path (mirrors LOGO_REGISTRY's own pattern:
// centralized, never a path hardcoded into a component).
// SSP Worldwide's own artwork ('globe-header'/'globe-sidebar') is likewise
// a REAL, provided image asset (cropped from the approved SSP Worldwide
// design reference, public/Worldwide_Deciration.png) — a dark-navy world/
// network globe for the sidebar, a pale-blue world-map banner with the
// "Global People Stronger Together" script text already baked into the
// artwork for the header. Because that text is already part of the image,
// SSP Worldwide's theme no longer sets a headerGraphicKey (the separate
// SVG-recreated globe+text component) — the real image IS the graphic now.
export const HEADER_DECORATION_KEYS = ['blush-curves', 'globe-header']
export const SIDEBAR_DECORATION_KEYS = ['blush-flow', 'globe-sidebar']

export const DECORATION_IMAGE_REGISTRY = {
  'blush-curves': '/assets/dashboard/header-bg-ukireland.png',
  'blush-flow': '/assets/dashboard/sidebar-bg-ukireland.png',
  'globe-header': '/assets/dashboard/header-bg-worldwide.png',
  'globe-sidebar': '/assets/dashboard/sidebar-bg-worldwide.png'
}

export function resolveDecorationImage(decorationKey) {
  return DECORATION_IMAGE_REGISTRY[decorationKey] || null
}
