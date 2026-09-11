import React from 'react'
import { resolveDecorationImage } from '../utils/dashboardViewAssets'

// Centralized header BACKGROUND artwork for Dashboard View branding. SSP UK
// & Ireland's own artwork is a REAL image asset cropped from the approved
// design reference (public/assets/dashboard/header-bg-ukireland.png) —
// deliberately a plain <img>, not a CSS/SVG recreation, per the explicit
// instruction that the provided image IS the visual source of truth.
// Absolutely positioned to fill the header, behind the header's real
// content (see .header-decoration in styles.css: position:absolute,
// inset:0, z-index:0, pointer-events:none — the header's title/buttons/
// profile menu are all separately given position:relative + a higher
// z-index, see Header.jsx), so it can never overlap clicks. Renders
// nothing for every view that doesn't set a headerDecorationKey.
export default function HeaderDecoration({ headerDecorationKey }) {
  const src = resolveDecorationImage(headerDecorationKey)
  if (!src) return null
  // A per-key modifier class (e.g. header-decoration-globe-header) lets one
  // view's artwork override just its own object-position in styles.css —
  // e.g. SSP Worldwide's banner needs a top-biased crop to keep its baked-
  // in "Global People Stronger Together" text in frame inside the compact
  // header — without touching the shared base rule other views rely on.
  return (
    <img className={`header-decoration header-decoration-${headerDecorationKey}`} src={src} alt="" aria-hidden="true" />
  )
}
