// MSAL Node confidential-client app for the Entra ID authorization-code
// flow (Microsoft's own recommended pattern for a server-side web app —
// Part 14 of the auth spec: "follow Microsoft Entra recommended
// authentication patterns"). This is the ONLY place a human user's
// Microsoft identity is authenticated — completely separate from
// server/services/microsoft/auth.js's getAccessToken, which acquires
// APPLICATION (client-credentials) tokens for the backend's own data-sync
// Graph calls and has no notion of "which person is signed in."
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node'
import { getEffectiveEntraConfig } from './config.js'

// Built fresh from whatever getEffectiveEntraConfig() currently returns —
// deliberately NOT cached across calls. Construction is cheap (no network
// call), and this is only invoked from the infrequent login/callback
// routes, so there's no performance reason to cache; the correctness reason
// not to is that the effective config can change at runtime without a
// server restart the moment the one-time bootstrap flow (server/auth/
// setup.js) saves a new configuration — a cached client built before that
// point would otherwise keep answering from the old (non-existent) config.
export function getMsalClient() {
  const config = getEffectiveEntraConfig()
  if (!config) return null
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret
    },
    system: {
      loggerOptions: {
        // Never log PII (tokens, claims) — only MSAL's own internal
        // protocol-level diagnostic messages.
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
        loggerCallback: (level, message) => {
          if (level <= LogLevel.Warning) console.warn('[msal]', message)
        }
      }
    }
  })
}

// Minimal delegated scopes: identity only (who is this person) — no Graph
// data-read scope is requested here at all, since group-membership checks
// are done with the EXISTING Microsoft 365 connection's own application
// permissions instead (server/auth/authorize.js), never this user's token.
export const LOGIN_SCOPES = ['openid', 'profile', 'email', 'User.Read']
