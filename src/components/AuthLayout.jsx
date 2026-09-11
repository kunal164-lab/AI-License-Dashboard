import React from 'react'
import { BarChart3, Gauge, Users, ShieldCheck } from 'lucide-react'

const FEATURES = [
  { icon: BarChart3, title: 'Monitor', text: 'Track licenses, usage and technology costs' },
  { icon: Gauge, title: 'Optimize', text: 'Identify unused and low-value licenses' },
  { icon: Users, title: 'Analyze', text: 'Understand users, products and technology adoption' },
  { icon: ShieldCheck, title: 'Control', text: 'Make informed licensing and technology decisions' }
]

// The shared shell for every authentication screen (sign-in, initial
// administrator setup). The left hero is a real photographic asset
// (public/login-hero.jpg — see styles.css's .auth-visual) that already
// carries the SSP branding, headline-equivalent messaging and tagline, so
// this component does NOT repeat any of that in HTML — it adds only the
// one thing the image doesn't already say: the four capability bullets,
// in a small card positioned in the lower-middle/middle-left area rather
// than a full-width band pinned to the bottom edge.
export default function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-hero-card">
          <ul className="auth-features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="auth-feature-icon"><Icon /></span>
                <div><strong>{title}</strong><span>{text}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-card">{children}</div>
      </div>
    </div>
  )
}
