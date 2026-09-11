// Centralized cost/billing rules — see server/services/costEngine.js for
// how these are matched against real license/usage records, and
// src/pages/Cost.jsx for the admin UI that manages them.
import { run, all, get, persist } from '../db/index.js'

function nowIso() { return new Date().toISOString() }

function rowToRule(r) {
  return { ...r, is_active: !!r.is_active }
}

export function listActiveRules() {
  return all('SELECT * FROM cost_rules WHERE is_active = 1').map(rowToRule)
}

export function listAllRules() {
  return all('SELECT * FROM cost_rules ORDER BY provider, product, plan_name').map(rowToRule)
}

export function getRule(id) {
  const row = get('SELECT * FROM cost_rules WHERE id = ?', [id])
  return row ? rowToRule(row) : null
}

export function createRule(rule) {
  const now = nowIso()
  run(
    `INSERT INTO cost_rules (provider, product, plan_name, sku, sku_id, amount, currency, billing_frequency, cost_type, source, effective_from, effective_to, is_active, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      rule.provider, rule.product, rule.planName || null, rule.sku || null, rule.skuId || null,
      rule.amount === null || rule.amount === undefined ? null : Number(rule.amount),
      rule.currency || 'USD', rule.billingFrequency || 'monthly', rule.costType || 'reference',
      rule.source || null, rule.effectiveFrom || null, rule.effectiveTo || null,
      rule.isActive === false ? 0 : 1, rule.notes || null, now, now
    ]
  )
  // last_insert_rowid() must be read BEFORE persist() — persist()'s
  // db.export() resets sql.js's rowid tracking, so calling this after
  // persisting always returns null (confirmed live).
  const row = get('SELECT * FROM cost_rules WHERE rowid = last_insert_rowid()')
  persist()
  return rowToRule(row)
}

export function updateRule(id, patch) {
  const existing = getRule(id)
  if (!existing) return null
  const merged = { ...existing, ...patch }
  const now = nowIso()
  run(
    `UPDATE cost_rules SET provider=?, product=?, plan_name=?, sku=?, sku_id=?, amount=?, currency=?, billing_frequency=?, cost_type=?, source=?, effective_from=?, effective_to=?, is_active=?, notes=?, updated_at=? WHERE id=?`,
    [
      merged.provider, merged.product, merged.plan_name || null, merged.sku || null, merged.sku_id || null,
      merged.amount === null || merged.amount === undefined ? null : Number(merged.amount),
      merged.currency || 'USD', merged.billing_frequency || 'monthly', merged.cost_type || 'reference',
      merged.source || null, merged.effective_from || null, merged.effective_to || null,
      merged.is_active === false || merged.is_active === 0 ? 0 : 1, merged.notes || null, now, id
    ]
  )
  persist()
  return getRule(id)
}

export function deleteRule(id) {
  run('DELETE FROM cost_rules WHERE id = ?', [id])
  persist()
}
