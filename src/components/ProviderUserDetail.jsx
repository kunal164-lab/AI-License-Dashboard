import React, { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
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
  return v === null || v === undefined || Number.isNaN(Number(v)) ? null : formatMoney(v, currency, { maximumFractionDigits: 2 })
}
function fmtInt(v) {
  return v === null || v === undefined ? 'N/A' : Number(v).toLocaleString('en-US')
}

const PROVIDER_LABEL = { claude: 'Claude', kiro: 'Kiro', copilot: 'Microsoft 365 Copilot', freshservice: 'Freshservice', github: 'GitHub Copilot' }
const PROVIDER_PRODUCT_NAME = { claude: 'Claude', kiro: 'Kiro', copilot: 'Microsoft Copilot', freshservice: 'Freshservice', github: 'GitHub Copilot' }

// Provider-aware detail modal (Part 5/7/8 of the canonical-identity/
// utilization spec this implements) — ONE component reused by every
// provider, fetching the SAME consolidated /api/users/:id/detail payload
// server/services/userDetail.js builds. Sections common to every provider
// (Identity/License/Usage Status/Why/Cost & Optimization/Sync) always
// render the same way; provider-specific extras (Claude's Product/Model
// breakdown and Source Spend, Kiro's Client Types, Copilot's SKU) render
// only when the payload actually carries them — never a hardcoded product
// list, never a fabricated section for data a provider doesn't have.
export default function ProviderUserDetail({ userId, provider, userName, onClose, currency = 'USD' }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fmtCurrency = (v) => fmtMoney(v, detail?.currency || currency)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/users/${encodeURIComponent(userId)}/detail?provider=${encodeURIComponent(provider)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Failed to load ${PROVIDER_LABEL[provider] || provider} detail`)
        return j
      })
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [userId, provider])

  const providerLabel = PROVIDER_LABEL[provider] || provider
  const productName = PROVIDER_PRODUCT_NAME[provider] || provider

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BrandLogo product={productName} size="sm" />
              <h3 style={{ margin: 0 }}>{userName || detail?.identity?.name || 'User'}</h3>
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>{providerLabel} — {detail?.identity?.email || ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {detail?.usage?.status && <StatusBadge status={detail.usage.status} />}
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        {loading && <div className="muted" style={{ marginTop: 16 }}>Loading...</div>}
        {error && (
          <div className="small" style={{ color: 'var(--bad)', marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {detail && !error && (
          <>
            <Section title="Identity" sub="Microsoft 365">
              <Field label="Name" value={detail.identity.name} />
              <Field label="Email" value={detail.identity.email} />
              <Field label="Job Title" value={detail.identity.jobTitle} />
              <Field label="Department" value={detail.identity.department} />
              <Field label="VBU" value={detail.identity.vbu} />
              <Field label="Manager" value={detail.identity.manager} />
              <Field label="Company" value={detail.identity.company} />
              <Field label="Office" value={detail.identity.office} />
              <Field label="Domain" value={detail.identity.domain} />
              <Field label="Account Status" value={detail.identity.accountStatus} />
            </Section>

            <Section title={`${providerLabel} License`}>
              <Field label="Plan" value={detail.license.plan} />
              <Field label="License Status" value={<StatusBadge status={detail.license.licenseStatus} />} />
              <Field label="Monthly Cost" value={fmtCurrency(detail.license.monthlyCost)} />
              <Field label="Cost Type" value={detail.license.costLabel} />
              {detail.lastSuccessfulSync && <Field label="Last Successful Sync" value={formatRelativeTime(detail.lastSuccessfulSync)} />}
              <Field label="Reporting Period" value={detail.license.reportingPeriod} />
              {/* For Microsoft Copilot, `plan` above is already 'Premium'
                  for any recognized Copilot SKU (see server/services/
                  microsoft/copilotEntitlement.js) — the SKU itself remains
                  visible here as separate technical/audit metadata. */}
              {detail.license.skuPartNumber !== undefined && <Field label="SKU" value={detail.license.skuPartNumber} />}
            </Section>

            {Array.isArray(detail.license.servicePlans) && detail.license.servicePlans.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="small muted">Service Plans</div>
                <div className="small" style={{ marginTop: 2 }}>
                  {detail.license.servicePlans.map((p) => `${p.name}${p.status ? ` (${p.status})` : ''}`).join(', ')}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ marginBottom: 6 }}>Why this status?</div>
              <div className="small" style={{ background: 'var(--surface-2, #f8fafc)', borderRadius: 8, padding: 12, lineHeight: 1.5 }}>
                {detail.usage.explanation}
              </div>
            </div>

            {/* Claude-specific usage metrics — requests/tokens are the
                primary activity signal (Part 1), never combined into one
                score with spend. */}
            {provider === 'claude' && (
              <Section title="Current MTD Usage">
                <Field label="Total Requests" value={fmtInt(detail.usage.totalRequests)} />
                <Field label="Prompt Tokens" value={fmtInt(detail.usage.totalPromptTokens)} />
                <Field label="Completion Tokens" value={fmtInt(detail.usage.totalCompletionTokens)} />
                <Field label="Total Tokens" value={fmtInt(detail.usage.totalTokens)} />
                <Field label="Capabilities Used" value={detail.usage.capabilities.length} />
              </Section>
            )}
            {provider === 'claude' && detail.usage.capabilities.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="small muted" style={{ marginBottom: 6 }}>Capabilities</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {detail.usage.capabilities.map((c) => <span key={c} className="chip">{c}</span>)}
                </div>
              </div>
            )}

            {provider === 'claude' && detail.productBreakdown?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="card-title" style={{ marginBottom: 8 }}>Product Breakdown</div>
                <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table style={{ width: '100%' }}>
                    <thead><tr><th>Product</th><th>Requests</th><th>Prompt Tokens</th><th>Completion Tokens</th><th>Total Tokens</th></tr></thead>
                    <tbody>
                      {detail.productBreakdown.map((p, i) => (
                        <tr key={i}><td>{p.product}</td><td>{fmtInt(p.requests)}</td><td>{fmtInt(p.promptTokens)}</td><td>{fmtInt(p.completionTokens)}</td><td>{fmtInt(p.totalTokens)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {provider === 'claude' && detail.modelBreakdown?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="card-title" style={{ marginBottom: 8 }}>Model Breakdown</div>
                <div className="table" style={{ border: 'none', boxShadow: 'none', padding: 0, overflowX: 'auto' }}>
                  <table style={{ width: '100%' }}>
                    <thead><tr><th>Model</th><th>Requests</th><th>Prompt Tokens</th><th>Completion Tokens</th><th>Total Tokens</th></tr></thead>
                    <tbody>
                      {detail.modelBreakdown.map((m, i) => (
                        <tr key={i}><td>{m.model}</td><td>{fmtInt(m.requests)}</td><td>{fmtInt(m.promptTokens)}</td><td>{fmtInt(m.completionTokens)}</td><td>{fmtInt(m.totalTokens)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {provider === 'claude' && detail.sourceSpend && (
              <Section title="Source Spend" sub={detail.sourceSpend.label}>
                <Field label="Net Spend (USD)" value={detail.sourceSpend.totalNetSpendUsd === null ? 'N/A' : `$${detail.sourceSpend.totalNetSpendUsd.toFixed(2)}`} />
                <Field label="Gross Spend (USD)" value={detail.sourceSpend.totalGrossSpendUsd === null ? 'N/A' : `$${detail.sourceSpend.totalGrossSpendUsd.toFixed(2)}`} />
              </Section>
            )}

            {/* Kiro-specific usage metrics */}
            {provider === 'kiro' && (
              <Section title="Current Month Usage" sub={detail.usage.month ? `Month: ${detail.usage.month}` : null}>
                <Field label="Credits Used" value={fmtInt(detail.usage.creditsUsed)} />
                <Field label="Chat Conversations" value={fmtInt(detail.usage.chatConversations)} />
                <Field label="Total Messages" value={fmtInt(detail.usage.totalMessages)} />
                <Field label="Client Types" value={detail.usage.clientTypes.length ? detail.usage.clientTypes.join(', ') : 'N/A'} />
                <Field label="Last Activity" value={detail.usage.lastActivity} />
              </Section>
            )}

            {/* Copilot-specific usage metrics — aggregate counts only */}
            {provider === 'copilot' && (
              <Section title="Current Usage" sub={detail.usage.note}>
                <Field label="Prompts (All Apps)" value={fmtInt(detail.usage.promptsAllApps)} />
                <Field label="Active Days" value={fmtInt(detail.usage.daysActive)} />
                <Field label="Last Activity" value={detail.usage.lastActivity} />
              </Section>
            )}

            {/* GitHub Copilot usage metrics */}
            {provider === 'github' && (
              <Section title="Current Usage">
                <Field label="Code Completions" value={fmtInt(detail.usage.codeCompletions)} />
                <Field label="Accepted Suggestions" value={fmtInt(detail.usage.acceptedSuggestions)} />
                <Field label="Chat Requests" value={fmtInt(detail.usage.chatRequests)} />
                <Field label="Last Activity" value={detail.usage.lastActivity} />
              </Section>
            )}

            {/* Freshservice usage — limited to what the source provides */}
            {provider === 'freshservice' && (
              <Section title="Current Usage" sub={detail.usage.note}>
                <Field label="Last Activity" value={detail.usage.lastActivity} />
              </Section>
            )}

            <Section title="Cost &amp; Optimization">
              <Field label="License Cost" value={fmtCurrency(detail.license.monthlyCost)} />
              <Field label="Potential Removal Candidate" value={detail.optimization.potentialRemovalCandidate ? 'Yes' : 'No'} />
              <Field label="Potential Monthly Savings" value={detail.optimization.potentialMonthlySavings ? fmtCurrency(detail.optimization.potentialMonthlySavings) : 'N/A'} />
              <Field label="Potential Annual Savings" value={detail.optimization.potentialAnnualSavings ? fmtCurrency(detail.optimization.potentialAnnualSavings) : 'N/A'} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
