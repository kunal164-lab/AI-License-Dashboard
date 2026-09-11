// Centralized brand/logo registry — the SINGLE source every page reads
// provider/product logos from (Products, Data Sources, Cost, Users, User
// Detail, Application, Microsoft 365, Freshservice, reports). Nothing
// outside this file should hardcode a logo path or brand color.
//
// Asset source: official brand mark SVGs. Most come from Simple Icons
// (https://simpleicons.org, CC0-licensed, community-maintained brand icon
// set used by thousands of production apps for exactly this purpose).
// Simple Icons does not carry Amazon or Kiro (confirmed by checking their
// full icon set directly) — those two instead come straight from each
// company's own official source: amazon.svg is Wikimedia Commons' "Amazon
// logo.svg" (the real, current wordmark+smile mark, itself sourced from
// Amazon's own published branding); kiro.svg is Kiro's own official site
// icon (kiro.dev/icon.svg, declared there as their real favicon/app icon —
// its background rect is stripped and the mascot shape recolored to its
// own documented purple so it fits this app's existing "colored mark in a
// white box" treatment instead of double-boxing two backgrounds). All
// assets live in src/assets/brands/. Freshservice is the one remaining
// provider with no available vector mark anywhere — it keeps a clearly-
// labeled monogram badge rather than a fabricated logo (Part 27/40: never
// invent a fake logo when a real one genuinely cannot be found).
//
// Resolution order (see resolveBrand): product-specific mark, then
// provider mark, then a generic fallback — reusing the app's existing
// canonical provider/product model (providerRegistry.js) rather than a
// second parallel name mapping, so Claude Chat/Code records resolve to the
// same Claude mark, Microsoft Copilot resolves through the Microsoft
// family, etc.
import { providerForProduct, seatGroupForProduct } from './providerRegistry.js'
import microsoftSvgRaw from '../assets/brands/microsoft.svg?raw'
import githubSvgRaw from '../assets/brands/github.svg?raw'
import githubCopilotSvgRaw from '../assets/brands/githubcopilot.svg?raw'
import anthropicSvgRaw from '../assets/brands/anthropic.svg?raw'
import claudeSvgRaw from '../assets/brands/claude.svg?raw'
import windowsSvgRaw from '../assets/brands/windows.svg?raw'
import teamsSvgRaw from '../assets/brands/microsoftteams.svg?raw'
import amazonSvgRaw from '../assets/brands/amazon.svg?raw'
import kiroSvgRaw from '../assets/brands/kiro.svg?raw'

// Simple Icons' raw SVGs ship with no fill on the <path> (by design — the
// consumer applies the brand color once, here, rather than per-render).
// Baked in once at module load, not on every render.
function tint(svg, hex) {
  return svg.replace('<svg ', `<svg fill="${hex}" `)
}

const MICROSOFT_BLUE = '#0078D4' // Microsoft's documented Fluent/brand accent blue
const ANTHROPIC_INK = '#191919' // Anthropic's own primary mark color
const CLAUDE_RUST = '#D97757' // Claude's distinctive brand accent color
const GITHUB_INK = '#181717' // GitHub's own primary mark color
const GITHUB_COPILOT_INK = '#000000'
const FRESHWORKS_TEAL = '#0E8474' // Freshworks' well-known brand teal — no vector mark available, used only for the monogram badge below
const AMAZON_ORANGE = '#FF9900' // Amazon's own documented primary brand accent color (also the smile-arrow color baked into amazon.svg itself)
const KIRO_PURPLE = '#9046FF' // Kiro's own real brand purple, taken directly from their official site icon (kiro.dev/icon.svg)

const MICROSOFT_MARK = { svg: tint(microsoftSvgRaw, MICROSOFT_BLUE), color: MICROSOFT_BLUE }

// Product-specific marks — checked FIRST (more specific than provider).
const PRODUCT_BRANDS = {
  'Claude': { svg: tint(claudeSvgRaw, CLAUDE_RUST), color: CLAUDE_RUST, alt: 'Claude logo' },
  // Microsoft doesn't publish a visually distinct Microsoft 365 Copilot
  // mark separate from the Microsoft family — the plain Microsoft logo is
  // the correct, non-invented choice here. "Microsoft 365" (the dedicated-
  // page label, distinct from the "Microsoft Copilot" usage-record product
  // name) shares the same mark for the same reason.
  'Microsoft Copilot': { ...MICROSOFT_MARK, alt: 'Microsoft 365 Copilot logo' },
  'Microsoft 365': { ...MICROSOFT_MARK, alt: 'Microsoft 365 logo' },
  'GitHub Copilot': { svg: tint(githubCopilotSvgRaw, GITHUB_COPILOT_INK), color: GITHUB_COPILOT_INK, alt: 'GitHub Copilot logo' },
  'Freshservice': { monogram: 'F', color: FRESHWORKS_TEAL, alt: 'Freshservice' },
  // Kiro's own official icon (kiro.dev/icon.svg) already carries its own
  // real colors (brand purple mascot, dark eyes) — used as-is, no tint().
  'Kiro': { svg: kiroSvgRaw, color: KIRO_PURPLE, alt: 'Kiro logo' },
  'Windows': { svg: tint(windowsSvgRaw, MICROSOFT_BLUE), color: MICROSOFT_BLUE, alt: 'Windows logo' },
  'Microsoft Teams': { svg: tint(teamsSvgRaw, MICROSOFT_BLUE), color: MICROSOFT_BLUE, alt: 'Microsoft Teams logo' }
}

// Provider (company) marks — checked when no product-specific mark exists.
const PROVIDER_BRANDS = {
  'Microsoft': { ...MICROSOFT_MARK, alt: 'Microsoft logo' },
  'Anthropic': { svg: tint(anthropicSvgRaw, ANTHROPIC_INK), color: ANTHROPIC_INK, alt: 'Anthropic logo' },
  'GitHub': { svg: tint(githubSvgRaw, GITHUB_INK), color: GITHUB_INK, alt: 'GitHub logo' },
  'Freshworks': { monogram: 'F', color: FRESHWORKS_TEAL, alt: 'Freshworks' },
  // Amazon is Kiro's real provider (providerRegistry.js). Wikimedia
  // Commons' "Amazon logo.svg" already carries its own real colors (dark
  // wordmark + orange smile) — used as-is, no tint().
  'Amazon': { svg: amazonSvgRaw, color: AMAZON_ORANGE, alt: 'Amazon logo' }
}

// Resolves whichever brand entry best represents { provider, product } —
// either argument may be omitted. Never throws, never returns null; an
// unrecognized provider/product always resolves to a generic marker
// (Part 29: unknown providers must not crash or show a broken image).
export function resolveBrand({ provider, product } = {}) {
  const canonicalProduct = product ? seatGroupForProduct(product) : null
  if (canonicalProduct && PRODUCT_BRANDS[canonicalProduct]) return PRODUCT_BRANDS[canonicalProduct]

  const resolvedProvider = provider || (canonicalProduct ? providerForProduct(canonicalProduct) : null)
  if (resolvedProvider && PROVIDER_BRANDS[resolvedProvider]) return PROVIDER_BRANDS[resolvedProvider]

  return { generic: true, alt: canonicalProduct || resolvedProvider || 'Unknown' }
}

// Separate from resolveBrand's exact canonical-name matching above (Part 21
// of the branding spec: the app's own provider/product model is never
// fuzzy-matched) — this is specifically for the Application Inventory page,
// whose "publisher" strings come straight from Microsoft Graph/Intune in
// whatever free-text form the software vendor registered (e.g. "Microsoft
// Corporation", not "Microsoft"). A deterministic, transparent substring
// check against a short known-vendor list — never a fuzzy/similarity match,
// and anything not recognized here always falls through to the generic
// fallback rather than guessing.
const PUBLISHER_KEYWORDS = [
  ['microsoft', 'Microsoft'],
  ['github', 'GitHub'],
  ['anthropic', 'Anthropic']
]

export function resolveBrandForPublisher(publisher) {
  if (publisher) {
    const lower = publisher.toLowerCase()
    for (const [keyword, providerName] of PUBLISHER_KEYWORDS) {
      if (lower.includes(keyword) && PROVIDER_BRANDS[providerName]) return PROVIDER_BRANDS[providerName]
    }
  }
  return { generic: true, alt: publisher || 'Unknown publisher' }
}
