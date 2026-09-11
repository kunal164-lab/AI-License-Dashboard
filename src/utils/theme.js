import { THEME_TOKEN_KEYS } from './dashboardViewAssets'

// Maps a Dashboard View's theme token key (dashboardViewAssets.js) to the
// actual CSS custom property it overrides. Kept as an explicit map (not a
// naming convention) so the base defaults in src/styles.css's :root stay
// the single source of truth for what "no override" looks like.
const CSS_VAR_BY_TOKEN = {
  accent: '--accent',
  accentDark: '--accent-dark',
  sidebarGradientStart: '--sidebar-gradient-start',
  sidebarGradientEnd: '--sidebar-gradient-end',
  sidebarActive: '--sidebar-active',
  sidebarActiveBg: '--sidebar-active-bg',
  sidebarActiveText: '--sidebar-active-text',
  headerAccent: '--header-accent',
  contentBackgroundWash: '--content-background-wash',
  sidebarLogoWidth: '--sidebar-logo-width',
  sidebarDecorationColor: '--sidebar-decoration-color',
  headerDecorationColor: '--header-decoration-color',
  sidebarWidth: '--sidebar-width',
  headerMinHeight: '--header-min-height',
  headerBackground: '--header-background',
  contentBackground: '--bg',
  contentBorderColor: '--border'
}

// Applies a Dashboard View's sparse theme override on top of the base
// tokens already declared in :root (src/styles.css) — a view with an empty
// (or partially-filled) theme object leaves every other token exactly as
// the base stylesheet defines it (Part 10 of the VBU-aware-views spec:
// "subtle differences... centralized theme tokens", never a full re-skin).
// Called once from App.jsx in a useEffect keyed on the resolved view.
export function applyDashboardTheme(theme) {
  const root = document.documentElement.style
  for (const key of THEME_TOKEN_KEYS) {
    const cssVar = CSS_VAR_BY_TOKEN[key]
    if (!cssVar) continue
    if (theme && theme[key]) root.setProperty(cssVar, theme[key])
    else root.removeProperty(cssVar) // no override -> falls back to :root's base value
  }
}
