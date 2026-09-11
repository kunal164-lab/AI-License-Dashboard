import React from 'react'

// Centralized decorative header graphic for Dashboard View branding (SSP
// Worldwide spec, Part 3: "Keep decorative graphics centralized as part of
// the Dashboard View branding/theme configuration rather than hardcoding
// them separately into individual pages"). The exact source graphic from
// the approved reference (a world map with dotted flight paths, plane
// icons, and "Global People Stronger Together" script text) isn't
// available as a local asset, so this recreates the same visual motif as
// a small local, theme-colored inline SVG + styled text (Part 3 explicitly
// allows this: "recreate the visual treatment using local SVG/CSS/assets
// while maintaining the same overall appearance") — never hotlinked.
// Colored via the active view's own --header-accent token, so it stays
// consistent with whichever theme is applied. Renders nothing for every
// view that doesn't set a headerGraphicKey (every view today except SSP
// Worldwide).
const GRAPHICS = {
  'globe-network': GlobeNetworkGraphic
}

function GlobeNetworkGraphic() {
  return (
    <div className="header-graphic">
      <svg className="header-graphic-svg" viewBox="0 0 420 150" fill="none" aria-hidden="true">
        {/* Globe — larger, more prominent than the previous small icon-sized
            version, meant to read as a real world-map motif rather than a
            tiny decorative glyph. */}
        <circle cx="120" cy="75" r="62" stroke="var(--header-accent)" strokeOpacity="0.30" strokeWidth="1.6" />
        <ellipse cx="120" cy="75" rx="62" ry="23" stroke="var(--header-accent)" strokeOpacity="0.24" strokeWidth="1.2" />
        <ellipse cx="120" cy="75" rx="26" ry="62" stroke="var(--header-accent)" strokeOpacity="0.24" strokeWidth="1.2" />
        <ellipse cx="120" cy="75" rx="44" ry="62" stroke="var(--header-accent)" strokeOpacity="0.16" strokeWidth="1" />
        <line x1="58" y1="75" x2="182" y2="75" stroke="var(--header-accent)" strokeOpacity="0.24" strokeWidth="1.2" />

        {/* Flight paths — dashed curves between several "city" dots, spanning
            well beyond the globe itself to fill the wider header area. */}
        <path d="M55,105 Q140,10 260,55" stroke="var(--header-accent)" strokeOpacity="0.55" strokeWidth="1.8" strokeDasharray="5 5" fill="none" />
        <path d="M80,35 Q190,25 300,95" stroke="var(--header-accent)" strokeOpacity="0.45" strokeWidth="1.8" strokeDasharray="5 5" fill="none" />
        <path d="M150,120 Q250,105 330,45" stroke="var(--header-accent)" strokeOpacity="0.4" strokeWidth="1.8" strokeDasharray="5 5" fill="none" />
        <path d="M40,60 Q60,130 165,132" stroke="var(--header-accent)" strokeOpacity="0.30" strokeWidth="1.6" strokeDasharray="5 5" fill="none" />

        {/* City dots */}
        {[[55, 105], [80, 35], [260, 55], [300, 95], [150, 120], [330, 45], [40, 60], [165, 132]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3.6" fill="var(--header-accent)" fillOpacity="0.8" />
        ))}

        {/* Plane glyphs riding the flight paths */}
        <g transform="translate(150,42) rotate(-16)">
          <path d="M0,0 L15,4.5 L0,9 L3.7,4.5 Z" fill="var(--header-accent)" fillOpacity="0.9" />
        </g>
        <g transform="translate(230,72) rotate(22)">
          <path d="M0,0 L15,4.5 L0,9 L3.7,4.5 Z" fill="var(--header-accent)" fillOpacity="0.9" />
        </g>
        <g transform="translate(270,110) rotate(-30)">
          <path d="M0,0 L15,4.5 L0,9 L3.7,4.5 Z" fill="var(--header-accent)" fillOpacity="0.8" />
        </g>
      </svg>
      <div className="header-graphic-tagline">
        <div>Global People</div>
        <div>Stronger Together</div>
      </div>
    </div>
  )
}

export default function HeaderGraphic({ headerGraphicKey }) {
  const Graphic = GRAPHICS[headerGraphicKey]
  if (!Graphic) return null
  return <Graphic />
}
