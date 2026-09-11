import crypto from 'crypto'

// Short-lived store for in-flight OAuth authorization requests, keyed by the
// `state` param round-tripped through the provider so the callback can
// recover which account/config it belongs to. Deliberately NOT persisted to
// the database — these are single-use, minutes-lived handshake tokens, not
// application data.
const pending = new Map()
const TTL_MS = 10 * 60 * 1000

export function create(data) {
  const state = crypto.randomBytes(12).toString('hex')
  pending.set(state, { ...data, ts: Date.now() })
  return state
}

export function consume(state) {
  const entry = pending.get(state)
  pending.delete(state)
  if (!entry) return null
  if (Date.now() - entry.ts > TTL_MS) return null
  return entry
}
