// Microsoft Entra ID SSO configuration storage (Part 6/7 of the local-admin
// auth spec). Replaces the old one-time-token bootstrap flow entirely:
// saving/testing this configuration is now gated at the route level
// (server/auth/adminRoutes.js) by requireAdminAccess — the SAME
// authorization middleware every other admin surface uses, satisfied by
// either a local admin session or a Microsoft-authenticated admin session.
// There is no token here, and no concept of this being "used up" — an
// administrator can revisit and change this configuration at any time.
//
// The client secret is encrypted at rest (server/crypto.js, AES-256-GCM,
// the same mechanism every other provider's secrets use) and NEVER returned
// by any API response — server/auth/config.js#getEffectiveEntraConfig is
// the only in-process reader of the decrypted value, and only for actually
// building the MSAL client.
import * as settingsRepo from '../repositories/settingsRepo.js'
import { encrypt, decrypt } from '../crypto.js'

const SETTING_CONFIG = 'entra_setup_config'

// The saved config, decrypted — only ever consulted by server/auth/
// config.js as a FALLBACK when ENTRA_SSO_* env vars aren't set; env vars
// always take precedence, so an operator can override a mistake made
// through the admin UI without touching the database.
export function getSavedEntraConfig() {
  const raw = settingsRepo.getSetting(SETTING_CONFIG)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const clientSecret = parsed.clientSecretEnc ? decrypt(parsed.clientSecretEnc).clientSecret : ''
    if (!parsed.tenantId || !parsed.clientId || !clientSecret) return null
    return { tenantId: parsed.tenantId, clientId: parsed.clientId, clientSecret, bootstrapAdminGroup: parsed.bootstrapAdminGroup || '' }
  } catch (e) {
    return null
  }
}

// A safe view for the admin UI (Part 6: "Do NOT return the client secret
// from an API") — tenantId/clientId/bootstrapAdminGroup in full, plus only
// WHETHER a client secret is currently stored, never its value.
export function getSavedEntraConfigSafeView() {
  const raw = settingsRepo.getSetting(SETTING_CONFIG)
  if (!raw) return { configured: false, tenantId: '', clientId: '', bootstrapAdminGroup: '', clientSecretConfigured: false }
  try {
    const parsed = JSON.parse(raw)
    return {
      configured: true,
      tenantId: parsed.tenantId || '',
      clientId: parsed.clientId || '',
      bootstrapAdminGroup: parsed.bootstrapAdminGroup || '',
      clientSecretConfigured: !!parsed.clientSecretEnc
    }
  } catch (e) {
    return { configured: false, tenantId: '', clientId: '', bootstrapAdminGroup: '', clientSecretConfigured: false }
  }
}

// Saves the administrator-provided Entra configuration. clientSecret is
// optional on an update — an empty value keeps whatever secret is already
// stored, so changing e.g. the bootstrap admin group never requires
// re-entering the secret.
export function saveEntraConfig({ tenantId, clientId, clientSecret, bootstrapAdminGroup }) {
  if (!tenantId || !clientId) {
    return { ok: false, status: 400, error: 'Tenant ID and Client ID are required.' }
  }
  const existing = getSavedEntraConfig()
  const effectiveSecret = clientSecret ? String(clientSecret) : (existing?.clientSecret || '')
  if (!effectiveSecret) {
    return { ok: false, status: 400, error: 'A client secret is required.' }
  }
  settingsRepo.setSetting(SETTING_CONFIG, JSON.stringify({
    tenantId: String(tenantId).trim(),
    clientId: String(clientId).trim(),
    clientSecretEnc: encrypt({ clientSecret: effectiveSecret }),
    bootstrapAdminGroup: String(bootstrapAdminGroup || '').trim()
  }))
  return { ok: true }
}

// Validates tenantId/clientId/clientSecret against Microsoft's own token
// endpoint using the client-credentials grant (Part 7) — proves the three
// values actually work together without a full interactive sign-in
// redirect, and surfaces the specific reason Microsoft gives rather than a
// generic failure.
export async function testEntraConfig({ tenantId, clientId, clientSecret }) {
  if (!tenantId || !clientId || !clientSecret) {
    return { ok: false, error: 'Tenant ID, Client ID and Client Secret are all required to test.' }
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  })
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const data = await resp.json().catch(() => ({}))
    if (resp.ok && data.access_token) {
      return { ok: true, message: 'Microsoft Entra ID configuration is valid — a token was successfully acquired.' }
    }
    return { ok: false, error: describeAadError(data) }
  } catch (e) {
    return { ok: false, error: "Could not reach Microsoft's token endpoint: " + (e.message || 'network error') }
  }
}

function describeAadError(data) {
  const desc = String(data.error_description || data.error || 'Unknown error from Microsoft.')
  if (/AADSTS90002/.test(desc)) return 'Tenant not found — check the Tenant ID.'
  if (/AADSTS700016/.test(desc)) return 'Application (Client ID) not found in this tenant — check the Client ID.'
  if (/AADSTS7000215|AADSTS7000222/.test(desc)) return 'Invalid or expired client secret — check the Client Secret value.'
  return desc.split(/\r?\n/)[0]
}
