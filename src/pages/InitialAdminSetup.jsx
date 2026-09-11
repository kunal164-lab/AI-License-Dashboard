import React, { useState } from 'react'
import { AlertCircle, ArrowRight, Loader2, ShieldCheck, User, Lock } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'

// Shown ONLY when no local administrator account exists yet (Part 2/13 of
// the local-admin auth spec) — the very first thing a fresh installation
// shows. No setup token, no Entra configuration is required here: whoever
// is installing this application IS the administrator. Submitting signs the
// new administrator straight in (server/auth/localRoutes.js's
// POST /api/auth/local/setup) — no dead end, no second sign-in step.
export default function InitialAdminSetup({ onComplete }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const passwordsMatch = password.length > 0 && password === confirmPassword
  const canSubmit = username.trim().length >= 3 && password.length >= 10 && passwordsMatch

  async function submit(e) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/auth/local/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, confirmPassword })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Setup failed. Please try again.'); return }
      await onComplete?.()
    } catch (e) {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <img src="/ssp-logo.png" alt="SSP" className="auth-card-logo" />
      <h2>Set up administrator access</h2>
      <p className="auth-card-subtitle">
        Create the first administrator account to configure the Internal IT Dashboard.
      </p>

      <div className="auth-admin-box">
        <div className="auth-admin-heading"><ShieldCheck size={16} /> Initial Administrator Setup</div>
        <p className="auth-admin-sub">
          You'll be signed in immediately and can configure Microsoft Entra ID sign-in afterward from Access Management.
          This account remains available permanently as an emergency recovery sign-in.
        </p>

        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="auth-field">
            <label htmlFor="setup-username" className="sr-only">Administrator Username</label>
            <span className="auth-field-icon"><User size={16} /></span>
            <input
              id="setup-username" type="text" placeholder="Administrator Username" value={username}
              onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus
            />
          </div>
          <div className="auth-field">
            <label htmlFor="setup-password" className="sr-only">Administrator Password</label>
            <span className="auth-field-icon"><Lock size={16} /></span>
            <input
              id="setup-password" type="password" placeholder="Administrator Password (at least 10 characters)" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="setup-confirm" className="sr-only">Confirm Password</label>
            <span className="auth-field-icon"><Lock size={16} /></span>
            <input
              id="setup-confirm" type="password" placeholder="Confirm Password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password"
            />
          </div>
          {confirmPassword.length > 0 && !passwordsMatch && (
            <div className="small" style={{ color: 'var(--bad)', marginTop: -6, marginBottom: 12 }}>Passwords do not match.</div>
          )}
          <button className="button auth-admin-submit" type="submit" disabled={submitting || !canSubmit}>
            {submitting && <Loader2 size={16} className="auth-spin" />}
            {submitting ? 'Setting up...' : 'Set Up Administrator'}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>
      </div>

      <div className="auth-footer">
        <ShieldCheck size={13} />
        Secure Access · SSP Internal Use Only
      </div>
    </AuthLayout>
  )
}
