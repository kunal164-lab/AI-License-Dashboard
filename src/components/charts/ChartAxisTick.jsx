import React from 'react'

const DEFAULT_MAX_CHARS = 16

// Shared category-axis tick for every chart in the app with long/many
// category labels (Department, Publisher, Application, SKU, Plan, ...).
// Truncates with an ellipsis and renders a native SVG <title> so hovering
// the LABEL ITSELF (not just its bar) shows the full, untruncated value —
// the underlying data is never altered, only how it's displayed. This is
// the ONE reusable fix for "chart labels overlap" everywhere in the app;
// a chart with this problem should use this tick, not a one-off tweak.
export function TruncatedAxisTick({ x, y, payload, maxChars = DEFAULT_MAX_CHARS }) {
  const full = String(payload?.value ?? '')
  const truncated = full.length > maxChars ? full.slice(0, maxChars - 1) + '…' : full
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text x={0} y={0} dy={4} textAnchor="end" fontSize={10} fill="var(--muted-fg, #64748b)">{truncated}</text>
    </g>
  )
}

// Chart height that grows with how many categories are being plotted, so a
// horizontal bar chart's rows get real breathing room instead of being
// squeezed into a fixed box — but caps out rather than growing forever.
// Pair with slicing the dataset to a "Top N" (per the app's chart rules)
// for anything larger; a table/detail page is the right place to see
// every category, not an ever-taller chart.
//
// Defaults tuned for the app's approved chart density at a browser's normal
// 100% zoom (Responsiveness spec: the design was being visually judged at
// 90% zoom, which — being 1/0.9 ≈ 11% "more generous" per CSS pixel — made
// every fixed chart height feel taller/roomier than it actually reads at a
// standard 100% zoom on a real laptop screen). Reduced ~10-15% from the
// previous defaults (perItem 28→24, min 180→155, max 420→370) so the SAME
// visual density now shows up natively at 100%, without any page needing
// its own per-call adjustment.
export function horizontalBarChartHeight(count, { perItem = 24, min = 155, max = 370 } = {}) {
  return Math.max(min, Math.min(max, count * perItem))
}

// Shared fixed heights for charts with a small, bounded category count
// (pies/donuts/simple single-series bar or line charts) that don't need
// horizontalBarChartHeight's per-item scaling — centralized here so every
// page reads from the SAME two baselines instead of each picking its own
// number ad hoc. COMPACT covers the common case (a simple bar/pie/line);
// ROOMY is for a chart that needs more vertical room for a legend or a
// wider pie. Same 100%-zoom density tuning as the defaults above.
export const CHART_HEIGHT_COMPACT = 175
export const CHART_HEIGHT_ROOMY = 235
