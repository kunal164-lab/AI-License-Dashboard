import React, { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Loader2, LayoutGrid } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import AppLogo from '../components/AppLogo'

// Shown ONLY for a local-administrator session that hasn't picked a
// Dashboard View yet this login (VBU-aware-views spec, "Local
// Administrator" section) — a real Microsoft-authenticated user's view is
// always auto-resolved from their own VBU and never sees this gate at all
// (App.jsx only renders it when auth.dashboardViewChosen is false, which
// GET /api/auth/me never reports for a Microsoft session). Mirrors
// SignIn.jsx/InitialAdminSetup.jsx's exact established pattern: one POST,
// then the parent's refresh callback — no separate step-state machine.
//
// The list of views comes from the EXISTING GET /api/admin/dashboard-views
// (the local admin already has full requireAdminAccess-level access the
// instant they log in, independent of any view selection — see
// server/auth/authorize.js#computeEffectiveAccess's local-admin branch) —
// never a hardcoded SSP/SSP Worldwide/SSP UK & Ireland list, so a future
// Dashboard View becomes selectable automatically.
export default function ChooseDashboardView({ onSelected }) {
  const [views, setViews] = useState(null)
  const [selectingId, setSelectingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/dashboard-views').then((r) => r.json()).then((j) => setViews((j.views || []).filter((v) => v.isActive))).catch(() => setViews([]))
  }, [])

  async function selectView(view) {
    if (selectingId) return
    setSelectingId(view.id)
    setError('')
    try {
      const r = await fetch('/api/auth/local/dashboard-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardViewId: view.id })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Could not select that dashboard view.'); return }
      await onSelected?.()
    } catch (e) {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSelectingId(null)
    }
  }

  return (
    <AuthLayout>
      <img src="/ssp-logo.png" alt="SSP" className="auth-card-logo" />
      <h2>Welcome, Administrator</h2>
      <p className="auth-card-subtitle">
        Choose a Dashboard View to enter. This is for administrative testing — you can switch views later from your profile menu without signing out.
      </p>

      <div className="auth-admin-box">
        <div className="auth-admin-heading"><LayoutGrid size={16} /> Choose Dashboard View</div>

        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {views === null ? (
          <div className="muted small" style={{ marginTop: 12 }}>Loading dashboard views...</div>
        ) : views.length === 0 ? (
          <div className="muted small" style={{ marginTop: 12 }}>No dashboard views are configured yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                className="button secondary"
                style={{ justifyContent: 'space-between', textAlign: 'left', padding: '12px 14px' }}
                disabled={!!selectingId}
                onClick={() => selectView(view)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AppLogo logoKey={view.logoKey} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                  <span>
                    <div style={{ fontWeight: 600 }}>{view.displayName}</div>
                    {view.description && <div className="small muted">{view.description}</div>}
                  </span>
                </span>
                {selectingId === view.id ? <Loader2 size={16} className="auth-spin" /> : <ArrowRight size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </AuthLayout>
  )
}
