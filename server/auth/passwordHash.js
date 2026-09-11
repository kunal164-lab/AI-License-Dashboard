// Password hashing for the local administrator account (Part 1 of the
// local-admin spec: "NEVER store the password in plaintext... use a strong
// password hashing algorithm such as Argon2id or bcrypt"). bcryptjs is a
// pure-JS bcrypt implementation — chosen over the native `bcrypt`/`argon2`
// packages because this environment has no working native-module build
// toolchain (the same reason this app already uses sql.js instead of
// better-sqlite3 — see server/db/index.js's own header comment).
import bcrypt from 'bcryptjs'

// 12 rounds is bcrypt's own commonly-recommended minimum cost factor for a
// server-side login (OWASP's current guidance) — expensive enough to
// resist offline cracking, cheap enough not to noticeably slow a real
// login attempt.
const SALT_ROUNDS = 12

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

export async function verifyPassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false
  return bcrypt.compare(plainPassword, hash)
}

// A minimum bar against an accidentally-trivial admin password — not a full
// policy engine, just enough to refuse "a"/"12345" during initial setup.
export function isPasswordStrongEnough(plainPassword) {
  return typeof plainPassword === 'string' && plainPassword.length >= 10
}
