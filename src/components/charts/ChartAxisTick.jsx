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
export function horizontalBarChartHeight(count, { perItem = 28, min = 180, max = 420 } = {}) {
  return Math.max(min, Math.min(max, count * perItem))
}
