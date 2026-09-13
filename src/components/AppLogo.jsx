import React from 'react'
import { resolveLogo, LOGO_REGISTRY, DEFAULT_LOGO_KEY } from '../utils/dashboardViewAssets'

// THE single place a Dashboard View's logo_key is turned into an <img> —
// mirrors BrandLogo.jsx's "one central resolver" pattern (used for
// provider marks) so Sidebar.jsx/SignIn.jsx never hardcode a path
// themselves. Falls back to the base SSP logo (the one asset guaranteed to
// exist, per LOGO_REGISTRY's own DEFAULT_LOGO_KEY) in case the resolved
// file is briefly unavailable (e.g. mid-deploy) — asset audit fix: this
// used to fall back to '/ssp-logo.svg', a file that has never existed in
// public/ (a leftover from an earlier SVG-placeholder iteration), so a
// failed load previously fell back to another broken image.
export default function AppLogo({ logoKey, alt = 'Internal IT Dashboard', className, style }) {
  return (
    <img
      src={resolveLogo(logoKey)}
      alt={alt}
      className={className}
      style={style}
      onError={(e) => { try { e.target.onerror = null; e.target.src = LOGO_REGISTRY[DEFAULT_LOGO_KEY] } catch (err) {} }}
    />
  )
}
