// express-session Store backed by this app's existing SQLite persistence
// layer (server/db/index.js) instead of express-session's default
// MemoryStore — an in-memory store would silently sign every user out on
// every server restart/deploy and leak memory over a long-running process,
// neither acceptable for "a production internal application" (Part 14 of
// the auth spec). Reuses the SAME run/all/persist helpers every other
// repository in this app already uses — no new database dependency.
//
// `touch()` is intentionally a no-op: this app configures a fixed (not
// rolling) cookie maxAge, so there is nothing useful to extend on every
// request, and skipping it avoids a full-database persist() on every single
// authenticated API call (see db/index.js's own comment: persist() rewrites
// the whole file — fine for occasional writes, not for once-per-request).
import { Store } from 'express-session'
import { run, all, persist } from '../db/index.js'

export class SqliteSessionStore extends Store {
  get(sid, callback) {
    try {
      const row = all('SELECT data_json, expires_at FROM sessions WHERE sid = ?', [sid])[0]
      if (!row) return callback(null, null)
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        run('DELETE FROM sessions WHERE sid = ?', [sid])
        persist()
        return callback(null, null)
      }
      callback(null, JSON.parse(row.data_json))
    } catch (e) {
      callback(e)
    }
  }

  set(sid, session, callback) {
    try {
      const maxAgeMs = session.cookie?.maxAge ?? 12 * 60 * 60 * 1000
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString()
      const now = new Date().toISOString()
      // Delete+insert (same "replace" pattern every other repository in
      // this app uses) rather than an upsert — avoids depending on the
      // bundled sql.js build supporting SQLite's newer ON CONFLICT syntax.
      run('DELETE FROM sessions WHERE sid = ?', [sid])
      run('INSERT INTO sessions (sid, data_json, expires_at, updated_at) VALUES (?,?,?,?)', [sid, JSON.stringify(session), expiresAt, now])
      persist()
      callback?.(null)
    } catch (e) {
      callback?.(e)
    }
  }

  destroy(sid, callback) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', [sid])
      persist()
      callback?.(null)
    } catch (e) {
      callback?.(e)
    }
  }

  touch(sid, session, callback) {
    callback?.(null)
  }
}

// Every session caches its resolved `access` (role/VBU/Dashboard View/
// theme — see server/auth/middleware.js) for up to 15 minutes to avoid
// recomputing it on every single request. Because sessions are persisted
// here in SQLite (not an in-memory store), that cache survives a server
// restart — so an administrator's Dashboard View/theme/role change can
// still be served stale to an already-signed-in session for up to 15
// minutes AFTER a restart, even though the restart was specifically meant
// to pick up the new config. Called once at startup (server/index.js) to
// drop just the cached `access`/`computedAt` from every persisted session
// — every session's very next request recomputes it fresh via the exact
// same computeEffectiveAccess() call middleware.js already makes when the
// cache is empty/expired. Nobody is signed out and no RBAC/authentication
// logic changes; this only clears a stale derived-data cache.
export function invalidateAllCachedAccess() {
  const rows = all('SELECT sid, data_json FROM sessions')
  let cleared = 0
  for (const row of rows) {
    let session
    try { session = JSON.parse(row.data_json) } catch (e) { continue }
    if (session && session.access) {
      delete session.access
      run('UPDATE sessions SET data_json = ? WHERE sid = ?', [JSON.stringify(session), row.sid])
      cleared++
    }
  }
  if (cleared > 0) persist()
  return cleared
}
