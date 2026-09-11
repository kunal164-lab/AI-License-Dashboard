// Provider-aware user detail — ONE server-side service reused by every
// provider's detail view (Part 7/12 of the spec this implements), built on
// top of the SAME cost-resolved, identity-merged dataset costAnalytics.js
// already builds once per request for Cost Overview/By Product/By User
// (buildCostDataset/userDetail) — no separate pricing logic, no N+1 (one
// full pass over already-synced data, not a per-field query), and the
// canonical Microsoft identity (name/department/vbu/manager/job_title/
// company/office/domain/account_status) is exactly what buildCanonicalUsers
// already resolved — never re-derived here, never a provider fallback.
import { isLicenseActive, licenseStatusLabel } from '../../src/utils/licenseStatus.js'
import { isClaudeFamily } from '../../src/utils/providerRegistry.js'
import { explainClaudeUsageStatus, explainCopilotUsageStatus } from '../../src/utils/activityScore.js'

function hasValue(v) { return v !== null && v !== undefined && v !== '' }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

function identityPayload(user) {
  return {
    name: user.name || null,
    email: user.email,
    jobTitle: user.job_title || null,
    department: user.department || null,
    vbu: user.vbu || null,
    manager: user.manager || null,
    company: user.company || null,
    office: user.office || null,
    domain: user.domain || null,
    accountStatus: user.account_status || null
  }
}

// SAME rule calculations.js/costAnalytics.js already use everywhere else
// for "potential savings" — an active license with No Usage/Low Activity
// usage is a savings candidate. Nothing new invented here; this only
// packages that existing rule for a single product record instead of a
// whole group.
function optimizationFor(product) {
  if (!product) return { potentialRemovalCandidate: false, potentialMonthlySavings: 0, potentialAnnualSavings: 0 }
  const isCandidate = isLicenseActive(product) && (product.usage_status === 'No Usage' || product.usage_status === 'Low Activity')
  const monthlySavings = isCandidate && hasValue(product.display_cost) ? Number(product.display_cost) : 0
  return {
    potentialRemovalCandidate: isCandidate,
    potentialMonthlySavings: round2(monthlySavings),
    potentialAnnualSavings: round2(monthlySavings * 12)
  }
}

function licensePayload(product, { reportingPeriod = null } = {}) {
  return {
    plan: product.plan || null,
    licenseStatus: licenseStatusLabel(product),
    monthlyCost: hasValue(product.display_cost) ? Number(product.display_cost) : null,
    currency: product.display_currency || null,
    costType: product.cost_type || null,
    costLabel: product.cost_label || null,
    costSource: product.cost_source || null,
    reportingPeriod
  }
}

// Claude Chat/Code/Cowork/Design/in Chrome/Office Agents/etc. are all
// merged into ONE canonical 'Claude' product record before this ever runs
// (src/utils/productModel.js#mergeSeatGroupRecords — one seat, one cost,
// per Part 10 of the spec this implements); `capabilityRecords` is that
// merge's own preserved per-capability breakdown, used here ONLY for the
// read-only Product Breakdown display, never for a second cost calculation.
function buildClaudeDetail(user) {
  const product = user.products.find((p) => isClaudeFamily(p.product))
  if (!product) return null

  const members = Array.isArray(product.capabilityRecords) && product.capabilityRecords.length ? product.capabilityRecords : [product]
  const productBreakdown = members.map((m) => ({
    product: m.product,
    requests: m.total_requests ?? 0,
    promptTokens: m.total_prompt_tokens ?? 0,
    completionTokens: m.total_completion_tokens ?? 0,
    totalTokens: (Number(m.total_prompt_tokens) || 0) + (Number(m.total_completion_tokens) || 0)
  }))

  const byModel = new Map()
  for (const m of (Array.isArray(product.models) ? product.models : [])) {
    if (!byModel.has(m.model)) byModel.set(m.model, { model: m.model, requests: 0, promptTokens: 0, completionTokens: 0 })
    const g = byModel.get(m.model)
    g.requests += Number(m.total_requests) || 0
    g.promptTokens += Number(m.total_prompt_tokens) || 0
    g.completionTokens += Number(m.total_completion_tokens) || 0
  }
  const modelBreakdown = Array.from(byModel.values()).map((g) => ({ ...g, totalTokens: g.promptTokens + g.completionTokens }))

  const capabilities = Array.isArray(product.capabilities) && product.capabilities.length
    ? product.capabilities
    : (product.product ? [product.product] : [])
  const totalTokens = (Number(product.total_prompt_tokens) || 0) + (Number(product.total_completion_tokens) || 0)

  return {
    provider: 'claude',
    license: licensePayload(product, { reportingPeriod: 'Current MTD' }),
    lastSuccessfulSync: product._snapshot_imported_at || null,
    usage: {
      status: product.usage_status,
      explanation: explainClaudeUsageStatus(product),
      totalRequests: product.total_requests ?? 0,
      totalPromptTokens: product.total_prompt_tokens ?? 0,
      totalCompletionTokens: product.total_completion_tokens ?? 0,
      totalTokens,
      capabilities
    },
    productBreakdown,
    modelBreakdown,
    // SOURCE spend, explicitly labeled and kept separate from license cost
    // (Part 4/19 of the spec this implements) — never used to decide usage
    // status or license cost, shown purely as its own vendor-spend metric.
    sourceSpend: {
      totalNetSpendUsd: hasValue(product.total_net_spend_usd) ? Number(product.total_net_spend_usd) : null,
      totalGrossSpendUsd: hasValue(product.total_gross_spend_usd) ? Number(product.total_gross_spend_usd) : null,
      label: 'Source-provided usage spend from Claude_Spend_MTD.csv — not the license cost'
    },
    optimization: optimizationFor(product)
  }
}

function explainKiroUsageStatus(product) {
  const status = product.usage_status
  if (status === 'No Usage') return 'No Kiro activity has been recorded for the latest available month.'
  const chats = Number(product.chat_conversations) || 0
  const messages = Number(product.total_messages) || 0
  const credits = Number(product.credits_used) || 0
  const month = product.month || 'the latest available month'
  return `${status} — ${chats.toLocaleString('en-US')} chat conversation${chats === 1 ? '' : 's'} and ${messages.toLocaleString('en-US')} total message${messages === 1 ? '' : 's'} recorded (${credits.toLocaleString('en-US')} credits used) in ${month}.`
}

// Kiro client types (KIRO_IDE/PLUGIN/KIRO_CLI/KIRO_WEB) are capability
// breakdowns of ONE Kiro seat, never separate licenses (Part 8 of the spec
// this implements) — src/utils/kiroNormalizer.js already enforces this at
// import time; this view only ever displays that one already-resolved
// product record, never re-derives multiple licenses from it.
function buildKiroDetail(user) {
  const product = user.products.find((p) => p.product === 'Kiro')
  if (!product) return null
  return {
    provider: 'kiro',
    license: licensePayload(product, { reportingPeriod: product.month ? `Month: ${product.month}` : 'Latest available month' }),
    usage: {
      status: product.usage_status,
      explanation: explainKiroUsageStatus(product),
      creditsUsed: product.credits_used ?? null,
      chatConversations: product.chat_conversations ?? null,
      totalMessages: product.total_messages ?? null,
      clientTypes: Array.isArray(product.client_types) ? product.client_types : [],
      month: product.month || null,
      lastActivity: product.last_activity || null
    },
    optimization: optimizationFor(product)
  }
}

// Microsoft Graph's Copilot usage report provides aggregate counts only
// (prompts, active days, per-app last-activity dates) — never individual
// prompt/event history (Part 16 of the spec this implements: never imply
// event-level data that doesn't exist).
function buildCopilotDetail(user) {
  const product = user.products.find((p) => p.product === 'Microsoft Copilot')
  if (!product) return null
  return {
    provider: 'copilot',
    license: {
      // `plan` (already 'Premium' for any recognized Copilot SKU — see
      // copilotEnrichment.js) comes through here via licensePayload's own
      // `plan: product.plan` — the ONE business plan field every provider
      // shares, never a separate Copilot-only "entitlement" field.
      ...licensePayload(product, { reportingPeriod: 'Latest synced Graph usage report' }),
      skuPartNumber: product.sku_part_number || null,
      servicePlanCount: Array.isArray(product.service_plans) ? product.service_plans.length : 0,
      // Real Graph service plans (name + this user's actual enabled/
      // disabled status), not just a count — Part "Service Plans: actual
      // enabled plans" of the spec this implements.
      servicePlans: Array.isArray(product.service_plans)
        ? product.service_plans.map((p) => ({ name: p.servicePlanName, status: p.capabilityStatus || null }))
        : []
    },
    usage: {
      status: product.usage_status,
      explanation: explainCopilotUsageStatus(product),
      promptsAllApps: hasValue(product.ms_prompts_all_apps) ? Number(product.ms_prompts_all_apps) : null,
      daysActive: hasValue(product.days_active) ? Number(product.days_active) : null,
      lastActivity: product.last_activity || null,
      note: 'Aggregate counts only — Microsoft Graph does not provide individual prompt/event-level history.'
    },
    optimization: optimizationFor(product)
  }
}

function explainFreshserviceUsageStatus() {
  return 'Freshservice agent entitlement is based on the Freshservice Agent list (Microsoft 365 security group membership or a manually uploaded Freshservice export), not recorded activity — no usage volume metric is available from this source.'
}

// An agent IS a current Freshservice Agent per whichever source method is
// configured (Microsoft 365 security group membership, or User Type=Agent
// in a manually uploaded Freshservice export — see server/services/
// freshservice/sync.js) — there is no per-agent activity data of any kind
// from either method, so "usage" here is honestly limited to that fact,
// never invented. This CSV/group membership establishes the Agent LICENSE
// relationship only, never a usage metric (Part 26 of the manual-CSV spec).
function buildFreshserviceDetail(user) {
  const product = user.products.find((p) => p.product === 'Freshservice')
  if (!product) return null
  return {
    provider: 'freshservice',
    license: licensePayload(product, { reportingPeriod: 'Current Freshservice Agent list' }),
    usage: {
      status: product.usage_status,
      explanation: explainFreshserviceUsageStatus(),
      lastActivity: null,
      note: 'Freshservice Agents come from Microsoft 365 security group membership or a manually uploaded Freshservice export — no activity/usage volume metric exists for this source.'
    },
    lastSuccessfulImport: product._imported_at || null,
    optimization: optimizationFor(product)
  }
}

function explainGithubUsageStatus(product) {
  if (product.usage_status === 'No Usage') return 'No GitHub Copilot activity has been recorded for this user.'
  const count = Number(product.activity_count) || 0
  return `${product.usage_status} — ${count.toLocaleString('en-US')} combined Copilot activity events recorded (code completions, accepted suggestions, chat requests) in the latest synced report.`
}

function buildGithubDetail(user) {
  const product = user.products.find((p) => p.product === 'GitHub Copilot')
  if (!product) return null
  return {
    provider: 'github',
    license: licensePayload(product, { reportingPeriod: 'Latest synced GitHub Copilot report' }),
    usage: {
      status: product.usage_status,
      explanation: explainGithubUsageStatus(product),
      codeCompletions: product.copilot_code_completions ?? null,
      acceptedSuggestions: product.copilot_accepted_suggestions ?? null,
      chatRequests: product.copilot_chat_requests ?? null,
      lastActivity: product.last_activity || null
    },
    optimization: optimizationFor(product)
  }
}

const PROVIDER_BUILDERS = {
  claude: buildClaudeDetail,
  kiro: buildKiroDetail,
  copilot: buildCopilotDetail,
  freshservice: buildFreshserviceDetail,
  github: buildGithubDetail
}

// `user`: one entry from costAnalytics.buildCostDataset().canonicalUsers
// (already cost-resolved, identity-merged — see that file's own header
// comment). Returns null if this person has no current record for the
// requested provider (Part 9 of the spec this implements: historical usage
// elsewhere must never be presented as a CURRENT license for a provider
// that isn't actually assigned).
export function buildProviderUserDetail(user, provider) {
  if (!user) return null
  const builder = PROVIDER_BUILDERS[String(provider || '').toLowerCase()]
  if (!builder) return { error: `Unknown provider "${provider}"` }
  const detail = builder(user)
  if (!detail) return null
  return {
    identity: identityPayload(user),
    ...detail
  }
}

export const SUPPORTED_DETAIL_PROVIDERS = Object.keys(PROVIDER_BUILDERS)
