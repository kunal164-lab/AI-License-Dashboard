// Encrypts connection credentials (OAuth tokens, API keys, client secrets)
// before they're written to disk, so the database file itself is never a
// plaintext store of secrets. AES-256-GCM via Node's built-in crypto module
// — no new dependency needed.
//
// Key source: ENCRYPTION_KEY env var (64 hex chars = 32 bytes). If unset
// (never in production — see assertEncryptionKeyConfigured below), a
// random key generated fresh in memory for THIS PROCESS ONLY is used so
// local dev never breaks. Set a real ENCRYPTION_KEY in production; anyone
// deploying this without one will see the warning below on every server
// start.
import crypto from 'crypto'

// Security-audit fix: this used to be a fixed, literal string committed to
// source (DEV_FALLBACK_KEY) — anyone with repo access could decrypt any
// credential ever encrypted under it, even in a properly-configured
// deployment that only forgot to set ENCRYPTION_KEY once. Generating it
// randomly per process means no real key value ever exists in the
// repository at all, even for local-only use. Trade-off (dev-only, accepted):
// it's regenerated on every restart, so anything encrypted under it (a
// connector credential saved locally without ENCRYPTION_KEY configured)
// will fail to decrypt after the next restart — set a real ENCRYPTION_KEY
// in your own .env to avoid that, same as any other environment.
const EPHEMERAL_DEV_KEY = crypto.randomBytes(32)

// A real key is either 64 hex chars (32 bytes) or a plain string of at
// least 32 characters (only the first 32 are used). Returns null if
// ENCRYPTION_KEY is unset or too short to be a real key.
function parseConfiguredKey(envKey) {
  if (!envKey) return null
  const buf = Buffer.from(envKey, 'hex')
  if (buf.length === 32) return buf
  if (envKey.length >= 32) return Buffer.from(envKey.slice(0, 32))
  return null
}

function resolveKey() {
  const envKey = process.env.ENCRYPTION_KEY
  const parsed = parseConfiguredKey(envKey)
  if (parsed) return parsed
  // A production deployment must never silently encrypt real credentials
  // under the hardcoded dev key just because ENCRYPTION_KEY was missing or
  // mistyped — see assertEncryptionKeyConfigured(), called at startup, for
  // the primary fail-fast check; this is the same guard applied again here
  // as defense in depth in case encrypt()/decrypt() is ever reached first.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY is not set (or is not a valid 32-byte key) and NODE_ENV=production — refusing to use the insecure built-in development key.')
  }
  if (envKey) {
    console.warn('[crypto] ENCRYPTION_KEY is set but is not 32 bytes (64 hex chars or a 32+ char string) — falling back to a random per-process dev key (credentials saved this run will not decrypt after a restart).')
  } else {
    console.warn('[crypto] ENCRYPTION_KEY is not set. Using a random per-process development key — credentials saved this run will NOT decrypt after a restart. Set a real ENCRYPTION_KEY before deploying anywhere real credentials will be stored.')
  }
  return EPHEMERAL_DEV_KEY
}

// Called once at server startup, after dotenv has populated process.env
// (see server/index.js) — fails the whole process immediately in
// production rather than letting it come up and quietly encrypt real
// OAuth tokens/API keys/Entra client secret under a key anyone with the
// source code already has.
export function assertEncryptionKeyConfigured() {
  if (process.env.NODE_ENV !== 'production') return
  if (!parseConfiguredKey(process.env.ENCRYPTION_KEY)) {
    throw new Error('ENCRYPTION_KEY is not set (or is not a valid 32-byte key: 64 hex chars, or a 32+ character string) and NODE_ENV=production — refusing to start without a real encryption key.')
  }
}

// Resolved lazily (on first actual use) rather than at module load, because
// index.js's `await import('dotenv/config')` — despite being written first —
// runs AFTER this module's static import graph is evaluated (ESM hoists and
// executes static imports before the importing module's own top-level code).
// Resolving eagerly here would read process.env.ENCRYPTION_KEY before dotenv
// has populated it, silently falling back to the insecure dev key even when
// a real one is configured.
let cachedKey = null
function getKey() {
  if (!cachedKey) cachedKey = resolveKey()
  return cachedKey
}

export function encrypt(plainObject) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(plainObject || {}), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Store iv + authTag + ciphertext together, base64, as one column value.
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decrypt(encodedValue) {
  if (!encodedValue) return {}
  try {
    const buf = Buffer.from(encodedValue, 'base64')
    const iv = buf.subarray(0, 12)
    const authTag = buf.subarray(12, 28)
    const ciphertext = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(decrypted.toString('utf8'))
  } catch (e) {
    console.error('[crypto] Failed to decrypt stored credentials:', e.message)
    return {}
  }
}
