// Configuration for Microsoft Entra ID SSO (Part 1/13 of the auth spec) —
// HUMAN user sign-in to the dashboard itself. Deliberately a separate set
// of environment variables from any provider's own Microsoft Graph
// application connection (those are configured per-connection in Data
// Sources -> Microsoft 365 and stored encrypted in the `connections`
// table) — this is server-level configuration for "who is allowed to open
// this app at all," not tenant data ingestion.
//
// Entra config is resolved LIVE on every call, from two possible sources,
// in this fixed order:
//   1. ENTRA_SSO_* environment variables — the normal, ops-managed way to
//      configure this in any real deployment. Always wins when fully set.
//   2. The admin-configured Entra setup (server/auth/entraConfig.js), saved
//      through Access Management by an already-authenticated administrator
//      (local or Microsoft) — an operator who later sets real env vars
//      (e.g. to fix a mistake made through the admin UI) always takes
//      precedence over whatever was saved there.
// Nothing else in this app ever needs to know which source supplied the
// config — every consumer just calls getEffectiveEntraConfig().
import { getSavedEntraConfig } from './entraConfig.js'
import * as settingsRepo from '../repositories/settingsRepo.js'
import crypto from 'crypto'

const SERVER_BASE_URL = (process.env.SERVER_BASE_URL || 'http://localhost:4000').replace(/\/$/, '')
const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/$/, '')

export const redirectUri = `${SERVER_BASE_URL}/auth/microsoft/callback`
export const postLoginRedirect = FRONTEND_BASE_URL
export const postLogoutRedirect = FRONTEND_BASE_URL

function envEntraConfig() {
  const tenantId = process.env.ENTRA_SSO_TENANT_ID || ''
  const clientId = process.env.ENTRA_SSO_CLIENT_ID || ''
  const clientSecret = process.env.ENTRA_SSO_CLIENT_SECRET || ''
  if (!tenantId || !clientId || !clientSecret) return null
  return { tenantId, clientId, clientSecret, bootstrapAdminGroup: process.env.BOOTSTRAP_ADMIN_GROUP || '' }
}

// The ONE thing every part of the auth system that needs "what is the
// current Entra app registration" should call. Returns null when neither
// source is configured — callers must treat that as "SSO unavailable,"
// never fall back to a default/guessed value.
export function getEffectiveEntraConfig() {
  return envEntraConfig() || getSavedEntraConfig()
}

export function isSsoConfiguredFromEnv() {
  return !!envEntraConfig()
}

export function isSsoConfigured() {
  return !!getEffectiveEntraConfig()
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isGuid(value) {
  return typeof value === 'string' && GUID_RE.test(value)
}

// A pure session-cookie-signing secret — it has no "correct value" an
// administrator needs to supply, so unlike the Entra app registration
// itself, this is never part of the bootstrap UI: SESSION_SECRET from the
// environment if set (recommended for a real deployment, so sessions
// survive a redeploy that might reset the database), otherwise a random
// value generated once and persisted in application_settings so it's
// stable across restarts of the same installation.
let cachedGeneratedSecret = null
export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (cachedGeneratedSecret) return cachedGeneratedSecret
  const existing = settingsRepo.getSetting('session_secret')
  if (existing) { cachedGeneratedSecret = existing; return existing }
  const generated = crypto.randomBytes(32).toString('hex')
  settingsRepo.setSetting('session_secret', generated)
  cachedGeneratedSecret = generated
  return generated
}
