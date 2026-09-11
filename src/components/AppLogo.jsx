import React from 'react'
import { resolveLogo } from '../utils/dashboardViewAssets'

// THE single place a Dashboard View's logo_key is turned into an <img> —
// mirrors BrandLogo.jsx's "one central resolver" pattern (used for
// provider marks) so Sidebar.jsx/SignIn.jsx never hardcode a path
// themselves. Falls back to the SSP asset's own onError swap (kept from
// the original hardcoded <img>) in case the resolved file is briefly
// unavailable (e.g. mid-deploy).
export default function AppLogo({ logoKey, alt = 'Internal IT Dashboard', className, style }) {
  return (
    <img
      src={resolveLogo(logoKey)}
      alt={alt}
      className={className}
      style={style}
      onError={(e) => { try { e.target.onerror = null; e.target.src = '/ssp-logo.svg' } catch (err) {} }}
    />
  )
}
