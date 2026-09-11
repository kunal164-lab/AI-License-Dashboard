import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Settings, User as UserIcon, LayoutGrid } from 'lucide-react'

function initialsFor(name) {
  if (!name) return null
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

// Renders the signed-in user's real Microsoft Entra profile photo when one
// is available (server/auth/routes.js's GET /api/auth/profile/photo — the
// browser never sees a Graph token, just this same-origin, session-
// authenticated image request), falling back to initials/a generic icon
// otherwise. A local admin session never has `hasPhoto` set (no Microsoft
// profile exists to fetch one from), so this always renders the fallback
// for that identity — never a fake/placeholder photo.
function Avatar({ hasPhoto, initials, size, large }) {
  const [failed, setFailed] = useState(false)
  if (hasPhoto && !failed) {
    return (
      <img
        src="/api/auth/profile/photo"
        alt=""
        className={`profile-avatar profile-avatar-img${large ? ' profile-avatar-lg' : ''}`}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className={`profile-avatar${large ? ' profile-avatar-lg' : ''}`}>
      {initials || <UserIcon size={size} />}
    </span>
  )
}

// The one account-actions surface in the app — reads identity straight off
// the SAME `auth` shape App.jsx already gets from /api/auth/me, never a
// second identity system. No Profile/Change Password/Preferences entries —
// those features don't exist for either identity provider, so only
// Administration (permission-gated, exactly like the sidebar nav item) and
// Sign Out are ever shown.
export default function UserProfileMenu({ user, role, vbu, canAccessAdmin, onOpenAdmin, onSignOut, onSwitchDashboardView }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!user) return null

  const isLocal = user.authenticationProvider === 'local'
  const displayName = isLocal ? (user.name || user.username || 'Administrator') : (user.name || user.upn || 'Signed in')
  const subLine = isLocal ? 'Local Administrator' : user.upn
  const roleLine = !isLocal && role ? role : null
  // Server-authoritative only (resolved from the Microsoft directory, see
  // server/services/dashboardViews.js#resolveVbuForUpn) — never editable
  // here, matching the spec's "the user cannot change their VBU or
  // Dashboard View" requirement. Deliberately gated on isLocal, not on
  // whether `vbu` happens to be truthy: a Local Administrator has NO
  // personal VBU at all — even while previewing a Dashboard View for
  // testing, `vbu` can carry that view's own VBU (see App.jsx's own
  // comment), and showing it here would misrepresent a preview/testing
  // context as the administrator's real identity. "Local Administrator"
  // (subLine above) already says exactly what they are; a real user with
  // no resolvable VBU at all gets an honest "VBU: Not Assigned" rather
  // than this line silently disappearing.
  const vbuLine = isLocal ? null : (vbu || 'VBU: Not Assigned')
  const initials = initialsFor(displayName)
  const hasPhoto = !isLocal && !!user.hasPhoto

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
      >
        <Avatar hasPhoto={hasPhoto} initials={initials} size={16} />
        <ChevronDown size={14} className="profile-chevron" />
      </button>

      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-header">
            <Avatar hasPhoto={hasPhoto} initials={initials} size={18} large />
            <div className="profile-dropdown-identity">
              <div className="profile-dropdown-name">{displayName}</div>
              {subLine && <div className="small muted profile-dropdown-sub">{subLine}</div>}
              {vbuLine && <div className="small muted profile-dropdown-meta" title={vbuLine}>{vbuLine}</div>}
              {roleLine && <div className="small muted profile-dropdown-meta" title={`Role: ${roleLine}`}>Role: {roleLine}</div>}
            </div>
          </div>

          {canAccessAdmin && (
            <>
              <div className="profile-dropdown-divider" />
              <button type="button" className="profile-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onOpenAdmin?.() }}>
                <Settings size={15} /> Administration
              </button>
            </>
          )}

          {/* Local-admin-only testing capability (VBU-aware-views spec,
              section 16: "allow the administrator to switch views without
              logging out") — never shown for a real Microsoft-authenticated
              user, who never has this option at all. */}
          {isLocal && onSwitchDashboardView && (
            <button type="button" className="profile-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onSwitchDashboardView() }}>
              <LayoutGrid size={15} /> Switch Dashboard View
            </button>
          )}

          <div className="profile-dropdown-divider" />
          <button type="button" className="profile-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onSignOut?.() }}>
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
