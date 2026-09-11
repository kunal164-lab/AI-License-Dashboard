// Generic application-wide key/value settings — the single source of
// truth for global config like the display currency (never localStorage;
// see src/pages/Cost.jsx and server/services/costEngine.js).
import { run, get, persist } from '../db/index.js'

const DEFAULT_CURRENCY = 'USD'

export function getSetting(key) {
  const row = get('SELECT * FROM application_settings WHERE key = ?', [key])
  return row ? row.value : null
}

export function setSetting(key, value) {
  const now = new Date().toISOString()
  run(
    `INSERT INTO application_settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value, now]
  )
  persist()
}

export function getCurrency() {
  return getSetting('currency') || DEFAULT_CURRENCY
}

export function setCurrency(code) {
  setSetting('currency', String(code || DEFAULT_CURRENCY).toUpperCase())
}
