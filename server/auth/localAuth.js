// Local administrator authentication (Part 1/2/3/9/10 of the local-admin
// auth spec) — the initial-setup AND permanent emergency-recovery identity.
// This module is AUTHENTICATION only ("is this really the local admin");
// the resulting session's AUTHORIZATION (allowedPages/canWrite) is computed
// by server/auth/authorize.js#computeEffectiveAccess exactly like every
// other identity — see its 'local' branch. Nothing here ever grants page
// access itself.
import * as localAdminRepo from '../repositories/localAdminRepo.js'
import { hashPassword, verifyPassword, isPasswordStrongEnough } from './passwordHash.js'

export function hasLocalAdmin() {
  return localAdminRepo.exists()
}

// The shape GET /api/auth/local/status is allowed to expose publicly
// (unauthenticated) — existence and enabled state only, never the
// username, hash, or anything else.
export function getPublicStatus() {
  const admin = localAdminRepo.getLocalAdmin()
  return { exists: !!admin, enabled: admin ? !!admin.enabled : false }
}

const ALREADY_COMPLETED = { ok: false, status: 409, error: 'Initial administrator setup has already been completed.' }

// Only reachable while no local admin exists yet (Part 2: "on fresh install
// with no local admin"). Refuses a second call so this can never become a
// general "add another local user" endpoint — one emergency account, ever.
//
// Race safety: the local_admin table's primary key is the fixed row id
// 'default' (server/db/index.js), so even if two requests both pass the
// hasLocalAdmin() check below before either has inserted (a real
// possibility — hashPassword awaits, leaving a window), at most one INSERT
// can ever succeed; sql.js throws a real constraint-violation error for the
// loser, which is caught here and reported the same way as the fast-path
// check above. This is enforced by the database, never by a frontend flag.
export async function createInitialLocalAdmin({ username, password }) {
  if (hasLocalAdmin()) return ALREADY_COMPLETED

  const cleanUsername = String(username || '').trim()
  if (cleanUsername.length < 3) {
    return { ok: false, status: 400, error: 'Username must be at least 3 characters.' }
  }
  if (!isPasswordStrongEnough(password)) {
    return { ok: false, status: 400, error: 'Password must be at least 10 characters.' }
  }
  const passwordHash = await hashPassword(password)
  try {
    const admin = localAdminRepo.createLocalAdmin({ username: cleanUsername, passwordHash })
    return { ok: true, admin: toSafeView(admin) }
  } catch (e) {
    return ALREADY_COMPLETED
  }
}

// Returns the safe admin view on success, or null on any failure (wrong
// username, wrong password, or the account currently disabled) — callers
// must never distinguish "wrong password" from "disabled" in what they
// tell the caller, only in what they audit-log.
export async function verifyLocalLogin({ username, password }) {
  const admin = localAdminRepo.getLocalAdmin()
  if (!admin || !admin.enabled) return null
  if (String(username || '').trim().toLowerCase() !== admin.username.toLowerCase()) return null
  const valid = await verifyPassword(password || '', admin.passwordHash)
  if (!valid) return null
  return toSafeView(admin)
}

export async function changeLocalAdminPassword(newPassword) {
  if (!hasLocalAdmin()) return { ok: false, status: 404, error: 'No administrator account exists yet.' }
  if (!isPasswordStrongEnough(newPassword)) {
    return { ok: false, status: 400, error: 'Password must be at least 10 characters.' }
  }
  const passwordHash = await hashPassword(newPassword)
  localAdminRepo.updatePasswordHash(passwordHash)
  return { ok: true }
}

// Part 10: the administrator may voluntarily disable/re-enable their own
// local sign-in. Deliberately NOT blocked by "this would lock you out" —
// the spec asks for this exact toggle, and the administrator disabling it
// is an informed choice made from an already-authenticated admin session
// (requireAdminAccess), not something that can happen by accident.
export function setLocalAdminEnabled(enabled) {
  if (!hasLocalAdmin()) return { ok: false, status: 404, error: 'No administrator account exists yet.' }
  localAdminRepo.setEnabled(!!enabled)
  return { ok: true }
}

export function getLocalAdminInfo() {
  const admin = localAdminRepo.getLocalAdmin()
  if (!admin) return null
  return toSafeView(admin)
}

// The ONLY shape any API response or session may ever carry for a local
// admin identity — never passwordHash (Part 5: "do not expose sensitive
// credential information").
function toSafeView(admin) {
  return { id: admin.id, username: admin.username, enabled: admin.enabled }
}
