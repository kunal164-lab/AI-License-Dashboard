// Storage for the single local administrator account (server/auth/
// localAuth.js). One row, id='default' — this is the emergency-recovery
// identity the auth spec asks for, not a general local-user system.
// password_hash is whatever server/auth/passwordHash.js produced (bcrypt) —
// this file never sees or handles a plaintext password.
import { run, get, persist } from '../db/index.js'

const ID = 'default'

function rowToAdmin(row) {
  if (!row) return null
  return { id: row.id, username: row.username, passwordHash: row.password_hash, enabled: !!row.enabled, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function getLocalAdmin() {
  return rowToAdmin(get('SELECT * FROM local_admin WHERE id = ?', [ID]))
}

export function exists() {
  return !!getLocalAdmin()
}

// Only ever called once, from the "no local admin exists yet" initial-setup
// path (server/auth/localAuth.js#createInitialLocalAdmin) — that caller is
// responsible for refusing to call this a second time.
export function createLocalAdmin({ username, passwordHash }) {
  const now = new Date().toISOString()
  run(
    `INSERT INTO local_admin (id, username, password_hash, enabled, created_at, updated_at) VALUES (?,?,?,1,?,?)`,
    [ID, username, passwordHash, now, now]
  )
  persist()
  return getLocalAdmin()
}

export function updatePasswordHash(passwordHash) {
  run('UPDATE local_admin SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, new Date().toISOString(), ID])
  persist()
  return getLocalAdmin()
}

export function setEnabled(enabled) {
  run('UPDATE local_admin SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, new Date().toISOString(), ID])
  persist()
  return getLocalAdmin()
}
