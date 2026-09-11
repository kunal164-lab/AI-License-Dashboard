import React from 'react'
import { Package } from 'lucide-react'
import { resolveBrand, resolveBrandForPublisher } from '../utils/brandRegistry'

// Pixel size of the outer logo container per named size (Part 22/23) — the
// mark inside is scaled proportionally so different logos (square vs.
// wordmark-shaped) still sit in a visually consistent container instead of
// stretching to fill it.
const CONTAINER_PX = { xs: 18, sm: 24, md: 32, lg: 48 }

// The ONE component every page uses to show a provider/product mark
// (Products, Data Sources, Cost, Users, User Detail, Application,
// Microsoft 365, Freshservice) — resolves product -> provider -> generic
// fallback via the centralized registry (src/utils/brandRegistry.js), so
// no page ever hardcodes a logo path itself.
//
// provider/product: canonical names from the app's existing provider/
// product model (either or both may be given; product wins if it has its
// own mark). size: 'xs'|'sm'|'md'|'lg'. label: also render the resolved
// name as text next to the mark. bordered: wrap in the standard subtle
// card container (default true) — pass false for a bare mark (e.g. inside
// a chart legend where a bordered box would look out of place).
export default function BrandLogo({ provider, product, publisher, size = 'md', label = false, bordered = true, className = '' }) {
  // `publisher`: free-text vendor string (Application Inventory's
  // Microsoft Graph/Intune data) — resolved via a separate, deliberately
  // non-fuzzy keyword match rather than the canonical provider/product
  // lookup (see brandRegistry.js#resolveBrandForPublisher).
  const brand = publisher ? resolveBrandForPublisher(publisher) : resolveBrand({ provider, product })
  const box = CONTAINER_PX[size] || CONTAINER_PX.md
  const markSize = Math.round(box * 0.62)
  const name = label ? (product || provider || publisher || brand.alt) : null

  let mark
  if (brand.svg) {
    mark = (
      <span
        className="brand-logo-mark"
        style={{ width: markSize, height: markSize }}
        // Decorative when a visible/adjacent text label already names the
        // brand; otherwise this IS the accessible name (Part 26).
        role={label ? undefined : 'img'}
        aria-label={label ? undefined : brand.alt}
        aria-hidden={label ? 'true' : undefined}
        dangerouslySetInnerHTML={{ __html: brand.svg }}
      />
    )
  } else if (brand.monogram) {
    mark = (
      <span
        className="brand-logo-monogram"
        style={{ width: markSize, height: markSize, background: brand.color, fontSize: Math.round(box * 0.34) }}
        role={label ? undefined : 'img'}
        aria-label={label ? undefined : brand.alt}
        aria-hidden={label ? 'true' : undefined}
        title={`${brand.alt} (no official mark available)`}
      >
        {brand.monogram}
      </span>
    )
  } else {
    mark = <Package size={markSize} className="brand-logo-generic" aria-hidden="true" />
  }

  return (
    <span className={`brand-logo ${className}`}>
      <span
        className={bordered ? 'brand-logo-box' : 'brand-logo-box brand-logo-box-bare'}
        style={{ width: box, height: box }}
        title={!label ? brand.alt : undefined}
      >
        {mark}
      </span>
      {label && <span className="brand-logo-label">{name}</span>}
    </span>
  )
}
