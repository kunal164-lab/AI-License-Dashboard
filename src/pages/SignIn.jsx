import React, { useEffect, useState } from 'react'
import { AlertTriangle, AlertCircle, ShieldCheck, ShieldOff, User, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import AppLogo from '../components/AppLogo'

function MicrosoftMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

// The dashboard's sign-in screen (Part 3 of the local-admin auth spec):
// "Sign in with Microsoft" alongside "Sign in as Administrator" — the local
// admin path, which must keep working even when Entra ID is unconfigured,
// misconfigured, or Microsoft Graph is temporarily unreachable. This is
// specifically the emergency administrator/recovery path (Part 14). This
// page only ever renders once a local administrator account exists — a
// fresh install with none yet renders InitialAdminSetup instead (App.jsx).
export default function SignIn({ configured, onLocalSignedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Whether local admin sign-in is currently enabled (Part 10: "hide/
  // disable the local administrator option appropriately" when disabled).
  // Defaults to true so the form isn't hidden while this fetch is in
  // flight; corrected the moment the real status is known.
  const [localEnabled, setLocalEnabled] = useState(true)

  useEffect(() => {
    fetch('/api/auth/local/status').then((r) => r.json()).then((j) => setLocalEnabled(j.enabled !== false)).catch(() => {})
  }, [])

  async function submitLocalLogin(e) {
    e.preventDefault()
    if (!username || !password || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(j.error || 'Sign in failed. Check your username and password.')
        return
      }
      await onLocalSignedIn?.()
    } catch (e) {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      {/* Pre-authentication — no Dashboard View has been resolved yet
          (that requires a signed-in session), so this always shows the
          base SSP logo. */}
      <AppLogo logoKey="ssp" alt="SSP" className="auth-card-logo" />
      <h2>Internal IT Dashboard</h2>
      <p className="auth-card-subtitle">
        Sign in to access technology insights, licensing data and optimization opportunities.
      </p>

      {configured ? (
        <a className="button auth-ms-button" href="/auth/microsoft/login">
          <span className="auth-ms-button-label">
            <span className="auth-ms-icon-badge"><MicrosoftMark /></span>
            Sign in with Microsoft 365
          </span>
          <ArrowRight size={18} />
        </a>
      ) : (
        <div className="auth-unavailable">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Microsoft 365 sign-in is temporarily unavailable. Use Administrator Sign In below.</span>
        </div>
      )}

      {localEnabled ? (
        <>
          <div className="auth-divider">OR</div>

          <div className="auth-admin-box">
            <div className="auth-admin-heading"><ShieldCheck size={16} /> Administrator Sign In</div>
            <p className="auth-admin-sub">Use administrator credentials for initial setup or emergency access.</p>

            {error && (
              <div className="auth-error" role="alert">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submitLocalLogin} noValidate>
              <div className="auth-field">
                <label htmlFor="admin-username" className="sr-only">Username</label>
                <span className="auth-field-icon"><User size={16} /></span>
                <input
                  id="admin-username" type="text" placeholder="Username" value={username}
                  onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="admin-password" className="sr-only">Password</label>
                <span className="auth-field-icon"><Lock size={16} /></span>
                <input
                  id="admin-password" type={showPassword ? 'text' : 'password'} placeholder="Password" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                />
                <button
                  type="button" className="auth-field-toggle" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button className="button auth-admin-submit" type="submit" disabled={submitting || !username || !password}>
                {submitting && <Loader2 size={16} className="auth-spin" />}
                {submitting ? 'Signing in...' : 'Sign In'}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="auth-note" style={{ marginTop: 18 }}>
          <ShieldOff size={15} style={{ flexShrink: 0 }} />
          <span>Administrator sign-in is currently disabled on this server. Use Microsoft 365 sign-in above.</span>
        </div>
      )}

      <div className="auth-footer">
        <ShieldCheck size={13} />
        Secure Access · SSP Internal Use Only
      </div>
    </AuthLayout>
  )
}
