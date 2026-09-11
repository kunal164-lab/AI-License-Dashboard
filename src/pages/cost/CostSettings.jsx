import React, { useEffect, useMemo, useState } from 'react'
import { X, Pencil, Trash2, RefreshCw, CircleCheck, CircleAlert, CircleX } from 'lucide-react'
import FilterableDataTable from '../../components/FilterableDataTable'
import EmptyState from '../../components/EmptyState'
import BrandLogo from '../../components/BrandLogo'
import { formatMoney, SUPPORTED_CURRENCIES as FALLBACK_CURRENCIES } from '../../utils/currency'
import { seatGroupForProduct } from '../../utils/providerRegistry'
import { formatRelativeTime } from '../../utils/formatRelativeTime'
import toast from '../../utils/toast'

// A rate row's `source` distinguishes an automatic ECB/Frankfurter rate
// from an admin-entered override (server/services/fx/fxService.js's own
// FX_PROVIDER_NAME label) — anything else is a manual override, matching
// exchangeRateRepo.setRate()'s existing 'Admin configured' default for a
// rate saved with no explicit source. Kept in sync with that server
// constant's literal value rather than re-fetched, since it's a fixed
// label, not configuration.
const FX_PROVIDER_LABEL = 'ECB (Frankfurter)'
function isManualOverride(rate) { return rate.source && rate.source !== FX_PROVIDER_LABEL }

const FX_STATUS_META = {
  healthy: { label: 'Healthy', cls: 'badge-active', Icon: CircleCheck },
  using_last_successful: { label: 'Using Last Successful Rate', cls: 'badge-low', Icon: CircleAlert },
  unavailable: { label: 'Unavailable', cls: 'badge-unused', Icon: CircleX }
}

const BILLING_FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'one_time', label: 'One-time' },
  { value: 'per_user', label: 'Per user' },
  { value: 'per_device', label: 'Per device' },
  { value: 'per_license', label: 'Per license' },
  { value: 'per_seat', label: 'Per seat' },
  { value: 'per_transaction', label: 'Per transaction' },
  { value: 'usage_based', label: 'Usage-based' }
]

const COST_TYPES = [
  { value: 'reference', label: 'Reference / List Price' },
  { value: 'configured', label: 'Configured (Admin Entered)' },
  { value: 'actual_contract', label: 'Actual Contract Price' },
  { value: 'actual_billing', label: 'Actual Billing Cost' }
]

// essential: true is what DataTable shows by default (everything else
// lives behind its "Show all columns" toggle) — Source/Effective From are
// useful but secondary, so they start hidden like similar secondary
// columns do on the Users page.
const RULE_COLUMNS = [
  { key: 'provider', name: 'Provider', type: 'category', essential: true },
  { key: 'product', name: 'Product', type: 'category', essential: true },
  { key: 'plan_name', name: 'Plan / License', type: 'category', essential: true },
  { key: 'sku', name: 'SKU', type: 'category', essential: true },
  { key: 'amount', name: 'Price', type: 'number', essential: true },
  { key: 'currency', name: 'Currency', type: 'category', essential: true },
  { key: 'billing_frequency', name: 'Billing Frequency', type: 'category', essential: true },
  { key: 'cost_type', name: 'Cost Type', type: 'category', essential: true },
  { key: 'source', name: 'Source', type: 'text' },
  { key: 'effective_from', name: 'Effective From', type: 'date' },
  { key: 'is_active', name: 'Status', type: 'category', essential: true },
  { key: 'actions', name: 'Actions', essential: true }
]

const EMPTY_FORM = {
  id: null, provider: '', product: '', planName: '', sku: '', skuId: '',
  amount: '', currency: 'USD', billingFrequency: 'monthly', costType: 'reference',
  source: '', effectiveFrom: '', effectiveTo: '', notes: '', isActive: true
}

function CostTypeBadge({ type }) {
  const label = { reference: 'Reference', configured: 'Configured', actual_contract: 'Actual (Contract)', actual_billing: 'Actual (Billing)' }[type] || type
  const cls = type?.startsWith('actual') ? 'badge-active' : type === 'configured' ? 'badge-syncing' : 'badge-low'
  return <span className={`status-badge ${cls}`}>{label}</span>
}

// Pricing CONFIGURATION only (Part 28 of the spec: Cost Analytics answers
// "how much/where," Cost Settings is where an admin manages the rules that
// feed it) — KPIs/charts/breakdowns live in CostOverview.jsx and the other
// analytics views instead, reading the exact same cost_rules this page
// writes to.
export default function CostSettings({ currency, onCurrencyChange }) {
  const [rules, setRules] = useState([])
  const [missing, setMissing] = useState(null)
  const [rates, setRates] = useState([])
  const [currencies, setCurrencies] = useState(FALLBACK_CURRENCIES)
  const [fxStatus, setFxStatus] = useState(null)
  const [refreshingFx, setRefreshingFx] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [rateForm, setRateForm] = useState({ base: 'USD', target: currency || 'USD', rate: '' })

  async function loadAll() {
    setLoading(true)
    try {
      const [r, m, ex, cur, fx] = await Promise.all([
        fetch('/api/cost/rules').then((x) => x.json()),
        fetch('/api/cost/missing').then((x) => x.json()),
        fetch('/api/exchange-rates').then((x) => x.json()),
        fetch('/api/fx/currencies').then((x) => x.json()).catch(() => null),
        fetch('/api/fx/status').then((x) => x.json()).catch(() => null)
      ])
      setRules(r.rules || [])
      setMissing(m)
      setRates(ex.rates || [])
      if (cur?.currencies?.length) setCurrencies(cur.currencies)
      if (fx) setFxStatus(fx)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshFx() {
    setRefreshingFx(true)
    try {
      const r = await fetch('/api/fx/refresh', { method: 'POST' })
      const j = await r.json()
      if (j.ok && !j.skipped) toast.success(`FX rates refreshed (${j.rateDate}).`)
      else if (j.skipped) toast.info(j.reason || 'FX rates are already current.')
      else toast.error('FX refresh failed: ' + (j.error || 'unknown error') + ' — using the last successful rate.')
      await loadAll()
    } finally {
      setRefreshingFx(false)
    }
  }

  async function changeCurrency(code) {
    const r = await fetch('/api/settings/currency', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: code }) })
    const j = await r.json()
    if (r.ok) { onCurrencyChange && onCurrencyChange(j.currency); toast.success(`Application currency set to ${j.currency}.`); loadAll() }
    else toast.error('Failed to change currency: ' + (j.error || 'unknown error'))
  }

  function openAddForm(prefill = {}) {
    setForm({ ...EMPTY_FORM, currency: currency || 'USD', ...prefill })
    setShowForm(true)
  }
  function openEditForm(rule) {
    setForm({
      id: rule.id, provider: rule.provider, product: rule.product, planName: rule.plan_name || '',
      sku: rule.sku || '', skuId: rule.sku_id || '', amount: rule.amount ?? '', currency: rule.currency || 'USD',
      billingFrequency: rule.billing_frequency || 'monthly', costType: rule.cost_type || 'reference',
      source: rule.source || '', effectiveFrom: rule.effective_from || '', effectiveTo: rule.effective_to || '',
      notes: rule.notes || '', isActive: !!rule.is_active
    })
    setShowForm(true)
  }

  async function saveForm() {
    if (!form.provider || !form.product) { toast.error('Provider and Product are required'); return }
    setSaving(true)
    try {
      const body = { ...form, amount: form.amount === '' ? null : Number(form.amount) }
      const url = form.id ? `/api/cost/rules/${form.id}` : '/api/cost/rules'
      const method = form.id ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) { toast.error('Failed to save cost rule: ' + (j.error || 'unknown error')); return }
      toast.success('Cost rule saved.')
      setShowForm(false)
      await loadAll()
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(id) {
    if (!confirm('Remove this cost rule? Licenses matching it will show as missing pricing again.')) return
    await fetch(`/api/cost/rules/${id}`, { method: 'DELETE' })
    toast.info('Cost rule removed.')
    await loadAll()
  }

  async function saveRate() {
    if (!rateForm.rate || Number.isNaN(Number(rateForm.rate))) { toast.error('Enter a valid rate'); return }
    const r = await fetch(`/api/exchange-rates/${rateForm.base}/${rateForm.target}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate: Number(rateForm.rate) })
    })
    if (r.ok) { toast.success('Exchange rate saved.'); setRateForm({ ...rateForm, rate: '' }); loadAll() }
    else toast.error('Failed to save exchange rate.')
  }

  async function deleteRate(base, target) {
    await fetch(`/api/exchange-rates/${base}/${target}`, { method: 'DELETE' })
    loadAll()
  }

  // Claude Code and Claude Chat are the same paid Anthropic seat (see
  // costEngine.js's seat-group consolidation) — displayed under one
  // "Claude" name so pricing reads as one product, even though the
  // underlying rule still targets the real product string ("Claude Chat")
  // that actually carries the plan/matching data. Edit and Delete look the
  // original rule up by id, so this display-only rename never risks saving
  // the wrong product value.
  const displayRules = useMemo(() => rules.map((r) => ({ ...r, product: seatGroupForProduct(r.product) })), [rules])

  const ruleColumns = useMemo(() => RULE_COLUMNS.map((c) => {
    if (c.key === 'product') {
      return {
        ...c,
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BrandLogo product={r.product} provider={r.provider} size="xs" />
            {r.product}
          </span>
        )
      }
    }
    if (c.key === 'amount') return { ...c, render: (r) => formatMoney(r.amount, r.currency, { maximumFractionDigits: 2 }) }
    if (c.key === 'cost_type') return { ...c, render: (r) => <CostTypeBadge type={r.cost_type} /> }
    if (c.key === 'is_active') return { ...c, render: (r) => <span className={`status-badge ${r.is_active ? 'badge-active' : 'badge-neutral'}`}>{r.is_active ? 'Active' : 'Inactive'}</span> }
    if (c.key === 'plan_name' || c.key === 'sku') return { ...c, render: (r) => r[c.key] || 'N/A' }
    if (c.key === 'actions') {
      return {
        ...c, essential: true,
        render: (r) => (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="icon-button" onClick={() => openEditForm(rules.find((x) => x.id === r.id) || r)} aria-label="Edit"><Pencil size={14} /></button>
            <button className="icon-button" onClick={() => deleteRule(r.id)} aria-label="Delete"><Trash2 size={14} /></button>
          </div>
        )
      }
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rules])

  if (loading) return <div className="muted">Loading cost settings...</div>

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h4 style={{ margin: 0 }}>Cost Settings</h4>
          <div className="muted small" style={{ marginTop: 4, maxWidth: 640 }}>
            Pricing configuration — the centralized source of truth every Cost Analytics view and every other page's spend figure reads from.
          </div>
        </div>
        <button className="button primary" onClick={() => openAddForm()}>Add Cost Rule</button>
      </div>

      <div className="card">
        <strong>Reporting Currency</strong>
        <div className="muted small" style={{ marginTop: 4, marginBottom: 10 }}>
          Used for reporting and display across the dashboard. A price stored in a different currency is automatically converted using the latest daily FX rate below — the original price/currency is never overwritten.
        </div>
        <select value={currency || 'USD'} onChange={(e) => changeCurrency(e.target.value)} style={{ width: 180 }}>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <strong>Automatic Daily FX Rates</strong>
          <div className="muted small" style={{ marginTop: 4, marginBottom: 10 }}>
            Latest available FX reference rates, refreshed automatically once a day — these are daily reference rates, not real-time/intraday.
          </div>
          {fxStatus && (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
              <div>
                <div className="muted small">FX Rate Provider</div>
                <strong>{fxStatus.provider}</strong>
              </div>
              <div>
                <div className="muted small">FX Status</div>
                {(() => {
                  const meta = FX_STATUS_META[fxStatus.status] || FX_STATUS_META.unavailable
                  const Icon = meta.Icon
                  return <span className={`status-badge ${meta.cls}`}><Icon size={12} />{meta.label}</span>
                })()}
              </div>
              <div>
                <div className="muted small">Last Updated</div>
                <strong>{fxStatus.lastAttemptAt ? formatRelativeTime(fxStatus.lastAttemptAt) : 'Never'}</strong>
              </div>
              <div>
                <div className="muted small">Rate Date</div>
                <strong>{fxStatus.rateDate || 'N/A'}</strong>
              </div>
              <button className="button secondary" onClick={refreshFx} disabled={refreshingFx}>
                <RefreshCw size={14} className={refreshingFx ? 'spin' : ''} /> {refreshingFx ? 'Refreshing...' : 'Refresh FX Rates'}
              </button>
            </div>
          )}
          {fxStatus?.status === 'using_last_successful' && fxStatus.lastError && (
            <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>
              Using last successful FX rate from {fxStatus.rateDate || 'an earlier date'} — the most recent automatic refresh failed: {fxStatus.lastError}
            </div>
          )}
          {fxStatus?.status === 'unavailable' && (
            <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>
              No automatic FX rate has been retrieved yet — conversions will show as unavailable/N/A until the first successful refresh, or a manual override is configured below.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-header" style={{ marginBottom: rules.length ? 10 : 0 }}>
          <div className="section-header-text">
            <div className="card-title">Product Pricing</div>
            <div className="muted small" style={{ marginTop: 4 }}>Every configured cost rule, scoped to a provider/product and optionally a plan/SKU.</div>
          </div>
        </div>
        {rules.length === 0 ? (
          <EmptyState title="No cost rules configured yet" hint="Click 'Add Cost Rule' to configure pricing for a provider/product/plan." />
        ) : (
          <FilterableDataTable
            columns={ruleColumns}
            data={displayRules}
            quickKeys={['provider', 'product', 'cost_type', 'is_active']}
            storageKey="cost-rules"
            itemLabel="cost rules"
          />
        )}
      </div>

      <div className="card" id="missing-pricing">
        <div className="card-title" style={{ marginBottom: 4 }}>Missing Pricing</div>
        <div className="muted small" style={{ marginBottom: 10 }}>Products/plans with real assigned licenses but no matching cost rule — nothing is hidden just because pricing is unknown.</div>
        {!missing || missing.items.length === 0 ? (
          <EmptyState title="Nothing missing" hint="Every product/plan currently in use has a matching cost rule." />
        ) : (
          <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Product</th><th>Plan</th><th>SKU</th><th>Users</th><th>Licenses</th><th>Action</th></tr></thead>
              <tbody>
                {missing.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <BrandLogo product={it.product} size="xs" />
                        {seatGroupForProduct(it.product)}
                      </span>
                    </td>
                    <td>{it.plan || 'N/A'}</td>
                    <td>{it.sku || 'N/A'}</td>
                    <td>{it.users}</td>
                    <td>{it.licenses}</td>
                    <td><button className="button secondary" onClick={() => openAddForm({ product: it.product, planName: it.plan || '', sku: it.sku || '' })}>Configure Cost</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 4 }}>Exchange Rates</div>
        <div className="muted small" style={{ marginBottom: 10 }}>
          Populated automatically from the daily FX refresh above. A manual override always takes precedence for its currency pair and is never silently replaced by the next automatic refresh — remove it to resume automatic rates for that pair.
        </div>
        {rates.length > 0 && (
          <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, marginBottom: 12, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>From</th><th>To</th><th>Rate</th><th>Rate Date</th><th>Source</th><th>Actions</th></tr></thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={`${r.base_currency}-${r.target_currency}`}>
                    <td>{r.base_currency}</td><td>{r.target_currency}</td><td>{r.rate}</td>
                    <td>{r.rate_date || 'N/A'}</td>
                    <td>
                      {isManualOverride(r)
                        ? <span className="status-badge badge-syncing">Manual FX override active</span>
                        : <span className="status-badge badge-active">Automatic ({r.source})</span>}
                    </td>
                    <td><button className="icon-button" onClick={() => deleteRate(r.base_currency, r.target_currency)} aria-label="Delete"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-section-title">Set Manual Override</div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 160px))', alignItems: 'end' }}>
          <label>From<select value={rateForm.base} onChange={(e) => setRateForm({ ...rateForm, base: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>To<select value={rateForm.target} onChange={(e) => setRateForm({ ...rateForm, target: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Rate<input type="number" step="0.0001" value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} /></label>
          <button className="button primary" onClick={saveRate} style={{ height: 36 }}>Save Override</button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>{form.id ? 'Edit Cost Rule' : 'Add Cost Rule'}</h3>
                {form.id && <div className="muted small" style={{ marginTop: 2 }}>Editing an existing rule — saving updates it in place.</div>}
              </div>
              <button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="form-section-title">Provider &amp; Product</div>
            <div className="form-grid">
              <label>Provider <span className="muted" style={{ fontWeight: 400 }}>(required)</span><input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. Microsoft" /></label>
              <label>Product <span className="muted" style={{ fontWeight: 400 }}>(required)</span><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="e.g. Microsoft Copilot" /></label>
              <label>Plan / License<input value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} placeholder="Optional" /></label>
              <label>SKU<input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional" /></label>
              <label>SKU ID<input value={form.skuId} onChange={(e) => setForm({ ...form, skuId: e.target.value })} placeholder="Optional" /></label>
            </div>

            <div className="form-section-title">Pricing</div>
            <div className="form-grid">
              <label>Price<input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="N/A" /></label>
              <label>Currency<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Billing Frequency<select value={form.billingFrequency} onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}>{BILLING_FREQUENCIES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
              <label>Cost Type<select value={form.costType} onChange={(e) => setForm({ ...form, costType: e.target.value })}>{COST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
            </div>
            <div className="field-hint">Leave Price blank for "Not configured / N/A" — the dashboard will never invent a number.</div>

            <div className="form-section-title">Source &amp; Effective Dates</div>
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Cost Source<input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Microsoft official pricing, Admin configured, Contract / Procurement" /></label>
              <label>Effective From<input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
              <label>Effective To<input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600 }}>Active</span>
            </label>

            <div className="form-actions">
              <button className="button secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="button primary" onClick={saveForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
