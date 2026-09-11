import React from 'react'
import { ShieldAlert } from 'lucide-react'

// Shown both for "signed in but no configured access at all" (Part 17:
// default-deny) and for "signed in, has access to OTHER pages, but not this
// one" (Part 6: direct URL navigation to an unauthorized page must be
// blocked, not just hidden from the sidebar). The backend enforces the
// same rule independently on every API call this page would otherwise
// make — this screen is purely so the user sees an honest message instead
// of a blank/broken page.
export default function AccessDenied({ user, reason }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '60vh', textAlign: 'center', padding: 24 }}>
      <ShieldAlert size={40} style={{ color: '#c3cbd9', marginBottom: 12 }} />
      <h3 style={{ margin: 0 }}>Access Denied</h3>
      <p className="muted" style={{ marginTop: 8, maxWidth: 420 }}>
        {reason || 'You are not authorized to view this page.'}
      </p>
      {user && (
        <p className="small muted" style={{ marginTop: 4 }}>
          Signed in as {user.name || user.upn} ({user.upn}). Contact your administrator if you believe this is incorrect.
        </p>
      )}
    </div>
  )
}
