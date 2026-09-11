import React from 'react'
import { X } from 'lucide-react'
import StatusBadge from './StatusBadge'
import BrandLogo from './BrandLogo'
import { formatMoney } from '../utils/currency'
import { formatRelativeTime } from '../utils/formatRelativeTime'

function Field({ label, value }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-word' }}>{value === null || value === undefined || value === '' ? 'N/A' : value}</div>
    </div>
  )
}

function Section({ title, sub, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div className="card-title">{title}</div>
        {sub && <span className="small muted">{sub}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

function fmtMoney(v, currency) {
  return v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : formatMoney(v, currency, { maximumFractionDigits: 2 })
}
// display_cost is the centralized cost engine's one authoritative figure
// per product record (server/services/costEngine.js) — already resolved
// through the source-provided/actual/configured/reference priority.
function productSpend(p) {
  return (p.display_cost === null || p.display_cost === undefined) ? null : Number(p.display_cost)
}

// user is a CANONICAL user (src/utils/userModel.js) — one real person, with
// an unlimited `products` array. Profile fields are person-level
// (identity-enriched across whichever source had them); every usage/cost/
// license field stays scoped to its OWN product row below — never combined
// across products, since a person's Claude usage and their Microsoft 365
// Copilot usage are not the same metric.
export default function UserDetail({ user, onClose, onOpenProduct, currency = 'USD' }) {
  if (!user) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <h3 style={{margin:0}}>{user.name}</h3>
            <div className="muted small" style={{marginTop:2}}>{user.email || 'N/A'}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <StatusBadge status={user.usage_status} />
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        {/* Organization/Identity: all eight fields are Microsoft 365's
            authoritative values (src/utils/userModel.js) — never a
            fallback to Freshservice/Claude/Kiro/GitHub data, N/A when
            Microsoft has no record for this person. */}
        <Section title="Organization" sub="Microsoft 365">
          <Field label="Job Title" value={user.job_title} />
          <Field label="Department" value={user.department} />
          <Field label="VBU" value={user.vbu} />
          <Field label="Manager" value={user.manager} />
          <Field label="Company" value={user.company} />
          <Field label="Office" value={user.office} />
          <Field label="Domain" value={user.domain} />
          <Field label="Account Status" value={user.account_status} />
        </Section>

        <Section title="Summary">
          <Field label="Role" value={user.role} />
          <Field label="Total Products" value={user.totalLicenses} />
          <Field label="Total Spend" value={fmtMoney(user.totalSpend, currency)} />
          <Field label="Last Active" value={user.last_activity} />
        </Section>

        <div style={{ marginTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Products &amp; Licenses ({user.products.length})</div>
          {user.products.length === 0 ? (
            <div className="muted small">No products/licenses found for this person.</div>
          ) : (() => {
            // Dynamic product architecture: SKU/service-plan columns only
            // appear when at least one of THIS person's products actually
            // carries that data (Microsoft Copilot today) — never assumed.
            const hasSku = user.products.some((p) => p.sku_part_number)
            const hasServicePlans = user.products.some((p) => Array.isArray(p.service_plans) && p.service_plans.length)
            // A product merged from multiple capability sources into one
            // license (e.g. Claude Chat + Claude Code -> one Claude seat —
            // see src/utils/productModel.js) carries a `capabilities` array —
            // shown even for a single capability (e.g. only ever used
            // Cowork) so it's clear which Claude surface(s) this person
            // actually used, not just the generic merged "Claude" name.
            const hasCapabilities = user.products.some((p) => Array.isArray(p.capabilities) && p.capabilities.length >= 1)
            // Kiro-only fields (src/utils/kiroNormalizer.js) — this product
            // record is that user's LATEST month (the canonical pipeline
            // only ever holds one current record per person per product;
            // see kiroNormalizer.js#selectLatestPerUser for full history).
            const hasCreditsUsed = user.products.some((p) => p.credits_used !== undefined && p.credits_used !== null)
            const hasClientTypes = user.products.some((p) => Array.isArray(p.client_types) && p.client_types.length)
            // Claude-only fields (src/utils/claudeNormalizer.js).
            const hasRequests = user.products.some((p) => p.total_requests !== undefined && p.total_requests !== null)
            const hasModelsUsed = user.products.some((p) => Array.isArray(p.models) && p.models.length)
            const hasSnapshotSync = user.products.some((p) => p._snapshot_imported_at)
            return (
              <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Product</th><th>Provider</th><th>Plan</th><th>License Status</th>
                      {hasSku && <th>SKU</th>}
                      {hasServicePlans && <th>Service Plans</th>}
                      {hasCapabilities && <th>Capabilities</th>}
                      {hasCreditsUsed && <th>Credits Used</th>}
                      {hasClientTypes && <th>Client Types</th>}
                      {hasRequests && <th>Requests</th>}
                      {hasModelsUsed && <th>Models Used</th>}
                      <th>Usage Status</th><th>Last Active</th><th>Usage</th><th>Cost</th><th>Cost Type</th><th>Source</th>
                      {hasSnapshotSync && <th>Synced</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {user.products.map((p, i) => {
                      const servicePlanNames = Array.isArray(p.service_plans) ? p.service_plans.map((sp) => sp.servicePlanName).filter(Boolean) : []
                      const cost = productSpend(p)
                      return (
                        <tr key={p._id ? `${p._id}-${i}` : i} className={onOpenProduct ? 'clickable-row' : undefined} onClick={onOpenProduct ? () => onOpenProduct(p.product) : undefined}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <BrandLogo product={p.product} provider={p.provider} size="xs" />
                              {onOpenProduct ? <span className="link-text">{p.product || 'N/A'}</span> : (p.product || 'N/A')}
                            </span>
                          </td>
                          <td>{p.provider || 'N/A'}</td>
                          <td>
                            {Array.isArray(p.plan_conflict) && p.plan_conflict.length
                              ? <span style={{ color: 'var(--bad)' }} title={`Conflicting plan values across capability sources: ${p.plan_conflict.join(' vs ')}`}>Plan Conflict</span>
                              : (p.plan || 'N/A')}
                          </td>
                          <td><StatusBadge status={p.license_status || 'Unknown'} /></td>
                          {hasSku && <td>{p.sku_part_number || 'N/A'}</td>}
                          {hasServicePlans && (
                            <td title={servicePlanNames.join(', ')}>
                              {servicePlanNames.length ? `${servicePlanNames.length} plan${servicePlanNames.length === 1 ? '' : 's'}` : 'N/A'}
                            </td>
                          )}
                          {hasCapabilities && <td>{Array.isArray(p.capabilities) ? p.capabilities.join(' + ') : 'N/A'}</td>}
                          {hasCreditsUsed && <td>{p.credits_used ?? 'N/A'}</td>}
                          {hasClientTypes && <td>{Array.isArray(p.client_types) && p.client_types.length ? p.client_types.join(' + ') : 'N/A'}</td>}
                          {hasRequests && <td>{p.total_requests ?? 'N/A'}</td>}
                          {hasModelsUsed && (
                            <td title={Array.isArray(p.models) ? [...new Set(p.models.map((m) => m.model))].join(', ') : ''}>
                              {Array.isArray(p.models) && p.models.length ? [...new Set(p.models.map((m) => m.model))].join(', ') : 'N/A'}
                            </td>
                          )}
                          <td><StatusBadge status={p.usage_status || 'Pending'} /></td>
                          <td>{p.last_activity || 'N/A'}</td>
                          <td>{p.activity_count ?? 'N/A'}</td>
                          <td>{fmtMoney(cost, p.display_currency || currency) || 'N/A'}</td>
                          <td>{p.cost_label || (cost !== null ? 'From source data' : 'N/A')}</td>
                          <td>{p.source || p._source || 'N/A'}</td>
                          {hasSnapshotSync && <td>{p._snapshot_imported_at ? formatRelativeTime(p._snapshot_imported_at) : 'N/A'}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
