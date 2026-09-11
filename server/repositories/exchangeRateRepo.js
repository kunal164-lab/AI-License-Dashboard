// Manually-configured currency exchange rates only (MVP — no live/auto
// fetching, per the decision in the Cost plan). A conversion only ever
// happens when a matching row exists here; see costEngine.js.
import { run, all, get, persist } from '../db/index.js'

function nowIso() { return new Date().toISOString() }

export function listRates() {
  return all('SELECT * FROM exchange_rates ORDER BY base_currency, target_currency')
}

export function getRate(base, target) {
  if (base === target) return { base_currency: base, target_currency: target, rate: 1, rate_date: null, source: 'Same currency' }
  return get('SELECT * FROM exchange_rates WHERE base_currency = ? AND target_currency = ?', [base, target])
}

export function setRate({ baseCurrency, targetCurrency, rate, rateDate, source }) {
  const now = nowIso()
  run(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date, source, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(base_currency, target_currency) DO UPDATE SET rate=excluded.rate, rate_date=excluded.rate_date, source=excluded.source, updated_at=excluded.updated_at`,
    [baseCurrency, targetCurrency, Number(rate), rateDate || now.slice(0, 10), source || 'Admin configured', now]
  )
  persist()
  return getRate(baseCurrency, targetCurrency)
}

export function deleteRate(base, target) {
  run('DELETE FROM exchange_rates WHERE base_currency = ? AND target_currency = ?', [base, target])
  persist()
}
