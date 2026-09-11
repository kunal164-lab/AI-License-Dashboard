import React from 'react'
import { resolveDecorationImage } from '../utils/dashboardViewAssets'

// Centralized sidebar BACKGROUND artwork for Dashboard View branding. SSP
// UK & Ireland's own artwork is a REAL image asset cropped from the
// approved design reference (public/assets/dashboard/
// sidebar-bg-ukireland.png) — deliberately a plain <img>, not a CSS/SVG
// recreation, per the explicit instruction that the provided image IS the
// visual source of truth. Absolutely positioned to fill the sidebar,
// behind the sidebar's real content (see .sidebar-decoration in
// styles.css: position:absolute, inset:0, z-index:0, pointer-events:none
// — the logo/subtitle/nav/footer are all separately given
// position:relative + a higher z-index, see Sidebar.jsx), so it can never
// intercept clicks or sit above nav/branding text. Renders nothing for
// every view that doesn't set a sidebarDecorationKey.
export default function SidebarDecoration({ sidebarDecorationKey }) {
  const src = resolveDecorationImage(sidebarDecorationKey)
  if (!src) return null
  // Per-key modifier class, mirroring HeaderDecoration.jsx's own pattern —
  // lets a specific view's artwork override its own crop position later
  // without touching the shared base rule other views rely on.
  return (
    <img className={`sidebar-decoration sidebar-decoration-${sidebarDecorationKey}`} src={src} alt="" aria-hidden="true" />
  )
}
