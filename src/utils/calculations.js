import { isLicenseActive } from './licenseStatus.js'

// The one place "how much does this record cost" is computed from. When a
// record has been through the centralized cost engine (server/services/
// costEngine.js, applied in /api/dashboard) it carries `cost_type` and an
// authoritative `display_cost` (a real number, or null for "unavailable")
// — that's used as-is. Records that never went through the engine (e.g. a
// direct test harness) fall back to whatever cost fields their own
// normalizer provided, exactly as before this centralization existed.
function recordCost(r) {
  if ('cost_type' in r) return (r.display_cost === null || r.display_cost === undefined) ? 0 : Number(r.display_cost)
  return (parseFloat(r.usage_cost) || 0) + (parseFloat(r.monthly_license_cost) || 0)
}

function hasUsage(r) { return r.usage_status === 'Active' || r.usage_status === 'Heavily Active' }

export function calculateSummary(records = [], filters = {}) {
  // apply filters simply
  let filtered = records.filter((r) => r)
  for (const k in filters) {
    if (!filters[k] || filters[k] === 'All') continue
    filtered = filtered.filter((r) => (r[k] || 'Unknown') === filters[k])
  }

  // Normalize email the same way userModel.js's canonical-user grouping
  // does — without this, the same person with differently-cased emails
  // across two connections would count as two separate users here (this
  // was previously masked because records reaching this function had
  // already been collapsed to one row per email upstream).
  const usersSet = new Set(filtered.map((r) => (r.email ? String(r.email).trim().toLowerCase() : r._id)))
  const totalUsers = usersSet.size
  const totalLicenses = filtered.length
  // LICENSE STATUS vs USAGE STATUS (see src/utils/licenseStatus.js) —
  // "Active Licenses" means currently assigned/active, never a proxy for
  // "has recent activity." A license can be Active AND unused at the same
  // time — that combination is exactly what Unused/Low-Usage below exist
  // to capture, scoped to only the licenses that are actually still active.
  const activeLicenses = filtered.filter(isLicenseActive).length
  const inactiveLicenses = totalLicenses - activeLicenses
  const usedLicenses = filtered.filter((r) => isLicenseActive(r) && hasUsage(r)).length
  const unusedLicenses = filtered.filter((r) => isLicenseActive(r) && r.usage_status === 'No Usage').length
  const lowUsageLicenses = filtered.filter((r) => isLicenseActive(r) && r.usage_status === 'Low Activity').length
  // Utilization = of the licenses actually assigned, how many are being
  // used — the denominator is active licenses, not every row, so an
  // unassigned/inactive license no longer silently drags this number down
  // as if it were a paid-but-wasted seat.
  const licenseUtil = activeLicenses ? Math.round((usedLicenses / activeLicenses) * 100) : 0
  const monthlyCost = filtered.reduce((s, r) => s + recordCost(r), 0)
  const annualizedCost = Math.round(monthlyCost * 12)
  const activeUsers = usedLicenses
  const potentialSavings = filtered
    .filter((r) => isLicenseActive(r) && (r.usage_status === 'No Usage' || r.usage_status === 'Low Activity'))
    .reduce((s, r) => s + recordCost(r), 0)

  // breakdowns
  const costByProduct = {}
  const licensesByProduct = {}
  const costByDepartment = {}
  const costByVbu = {}
  const chatsByProduct = {}
  const messagesByProduct = {}
  const chatsByPlan = {}
  const messagesByPlan = {}
  const seatsByPlan = {}
  const codeSessionsByPlan = {}
  const fileEditsByPlan = {}
  const pullRequestsByPlan = {}
  const projectsCreatedByPlan = {}
  const projectsUsedByPlan = {}
  const artifactsCreatedByPlan = {}
  const claudeCodeArtifactsByPlan = {}
  const coworkArtifactsByPlan = {}
  const coworkSessionsByPlan = {}
  const coworkMessagesByPlan = {}
  const seatsByTier = {}
  const seatsByRole = {}
  const estimatedSpendByTier = {}
  const estimatedSpendByRole = {}
  let totalChats = 0
  let totalMessages = 0
  let totalEstimatedSpend = 0
  let totalCodeSessions = 0
  let totalFileEdits = 0
  let totalProjectsCreated = 0
  let totalProjectsUsed = 0
  let totalPullRequests = 0
  let totalArtifactsCreated = 0
  let totalClaudeCodeArtifacts = 0
  let totalCoworkArtifacts = 0
  let totalCoworkSessions = 0
  let totalCoworkMessages = 0
  const daysActiveList = []
  const recencyBuckets = { '0-7':0, '8-30':0, '31-60':0, '60+':0 }

  filtered.forEach((r) => {
    const cost = recordCost(r)
    const prod = r.product || 'Unknown'
    costByProduct[prod] = (costByProduct[prod] || 0) + cost
    licensesByProduct[prod] = (licensesByProduct[prod] || 0) + 1
    // department/vbu are Microsoft-authoritative by the time a record
    // reaches this function (src/App.jsx pre-resolves them from the
    // canonical Microsoft directory before calling calculateSummary) — a
    // genuinely blank Microsoft value is "N/A", never "Unknown"; a record
    // with no Microsoft match at all should already be excluded upstream by
    // its own provider's normalizer (src/utils/canonicalIdentity.js).
    const dept = r.department || 'N/A'
    costByDepartment[dept] = (costByDepartment[dept] || 0) + cost
    const vbu = r.vbu || 'N/A'
    costByVbu[vbu] = (costByVbu[vbu] || 0) + cost
    // chats/messages aggregations
    const chats = parseInt(r.chats || 0) || 0
    const messages = parseInt(r.messages || 0) || 0
    const est = parseFloat(r.estimated_spend || 0) || 0
    const codeSessions = parseInt(r.code_sessions || 0) || 0
    const fileEdits = parseInt(r.file_edits || 0) || 0
    const projectsCreated = parseInt(r.projects_created || 0) || 0
    const projectsUsed = parseInt(r.projects_used || 0) || 0
    const pullRequests = parseInt(r.pull_requests || 0) || 0
    const artifactsCreated = parseInt(r.artifacts_created || 0) || 0
    const claudeCodeArtifacts = parseInt(r.claude_code_artifacts || 0) || 0
    const coworkArtifacts = parseInt(r.cowork_artifacts || 0) || 0
    const coworkSessions = parseInt(r.cowork_sessions || 0) || 0
    const coworkMessages = parseInt(r.cowork_messages || 0) || 0
    totalChats += chats
    totalMessages += messages
    totalEstimatedSpend += est
    totalCodeSessions += codeSessions
    totalFileEdits += fileEdits
    totalProjectsCreated += projectsCreated
    totalProjectsUsed += projectsUsed
    totalPullRequests += pullRequests
    totalArtifactsCreated += artifactsCreated
    totalClaudeCodeArtifacts += claudeCodeArtifacts
    totalCoworkArtifacts += coworkArtifacts
    totalCoworkSessions += coworkSessions
    totalCoworkMessages += coworkMessages
    chatsByProduct[prod] = (chatsByProduct[prod] || 0) + chats
    messagesByProduct[prod] = (messagesByProduct[prod] || 0) + messages
    const plan = r.plan || 'Unknown'
    chatsByPlan[plan] = (chatsByPlan[plan] || 0) + chats
    messagesByPlan[plan] = (messagesByPlan[plan] || 0) + messages
    seatsByPlan[plan] = (seatsByPlan[plan] || 0) + 1
    codeSessionsByPlan[plan] = (codeSessionsByPlan[plan] || 0) + codeSessions
    fileEditsByPlan[plan] = (fileEditsByPlan[plan] || 0) + fileEdits
    pullRequestsByPlan[plan] = (pullRequestsByPlan[plan] || 0) + pullRequests
    projectsCreatedByPlan[plan] = (projectsCreatedByPlan[plan] || 0) + projectsCreated
    projectsUsedByPlan[plan] = (projectsUsedByPlan[plan] || 0) + projectsUsed
    artifactsCreatedByPlan[plan] = (artifactsCreatedByPlan[plan] || 0) + artifactsCreated
    claudeCodeArtifactsByPlan[plan] = (claudeCodeArtifactsByPlan[plan] || 0) + claudeCodeArtifacts
    coworkArtifactsByPlan[plan] = (coworkArtifactsByPlan[plan] || 0) + coworkArtifacts
    coworkSessionsByPlan[plan] = (coworkSessionsByPlan[plan] || 0) + coworkSessions
    coworkMessagesByPlan[plan] = (coworkMessagesByPlan[plan] || 0) + coworkMessages

    // seat tier and role aggregates
    const tier = r.plan || r.seat_tier || r['Seat Tier'] || 'Unknown'
    seatsByTier[tier] = (seatsByTier[tier] || 0) + 1
    estimatedSpendByTier[tier] = (estimatedSpendByTier[tier] || 0) + est
    const role = r.role || 'Unknown'
    seatsByRole[role] = (seatsByRole[role] || 0) + 1
    estimatedSpendByRole[role] = (estimatedSpendByRole[role] || 0) + est

    // days active list for stats
    const da = parseInt(r.days_active || 0) || 0
    if (da) daysActiveList.push(da)
    // recency buckets using last_activity
    try {
      if (r.last_activity) {
        const last = new Date(r.last_activity)
        if (!isNaN(last)) {
          const diff = Math.floor((Date.now() - last.getTime()) / (1000*60*60*24))
          if (diff <= 7) recencyBuckets['0-7']++
          else if (diff <=30) recencyBuckets['8-30']++
          else if (diff <=60) recencyBuckets['31-60']++
          else recencyBuckets['60+']++
        }
      } else {
        recencyBuckets['60+']++
      }
    } catch(e) {}
  })

  return {
    totalUsers,
    totalLicenses,
    activeLicenses,
    inactiveLicenses,
    unusedLicenses,
    lowUsageLicenses,
    usedLicenses,
    licenseUtil,
    monthlyCost: Math.round(monthlyCost * 100) / 100,
    annualizedCost,
    activeUsers,
    potentialSavings: Math.round(potentialSavings * 100) / 100,
    costByProduct,
    licensesByProduct,
    costByDepartment,
    costByVbu,
    // No monthlyTrend here on purpose — there is no genuine historical cost
    // snapshot anywhere in this app (every source only ever reports CURRENT
    // license/cost state). A previous version of this function grouped
    // records by last_activity/assigned_date/date and called that a
    // "monthly trend," which mis-attributed current cost to whatever
    // unrelated usage timestamp a record happened to have (and produced an
    // "Unknown" bucket for the many records with no such timestamp at all
    // — see Overview.jsx, which now shows an honest "unavailable" empty
    // state instead, matching costAnalytics.js#costOverview's `trend` field).
    totalChats,
    totalMessages,
    totalEstimatedSpend: Math.round(totalEstimatedSpend * 100) / 100,
    chatsByProduct,
    messagesByPlan,
    chatsByPlan,
    seatsByPlan,
    messagesByProduct,
    totalCodeSessions,
    totalFileEdits,
    totalProjectsCreated,
    totalProjectsUsed,
    totalPullRequests,
    totalArtifactsCreated,
    totalClaudeCodeArtifacts,
    totalCoworkArtifacts,
    totalCoworkSessions,
    totalCoworkMessages,
    codeSessionsByPlan,
    fileEditsByPlan,
    pullRequestsByPlan,
    projectsCreatedByPlan,
    projectsUsedByPlan,
    artifactsCreatedByPlan,
    claudeCodeArtifactsByPlan,
    coworkArtifactsByPlan,
    coworkSessionsByPlan,
    coworkMessagesByPlan,
    seatsByTier,
    seatsByRole,
    estimatedSpendByTier,
    estimatedSpendByRole,
    daysActiveAvg: daysActiveList.length ? Math.round((daysActiveList.reduce((a,b)=>a+b,0)/daysActiveList.length)*100)/100 : 0,
    daysActiveMedian: (function(){ if(!daysActiveList.length) return 0; const s=daysActiveList.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : Math.round(((s[m-1]+s[m])/2)*100)/100 })(),
    recencyBuckets,
    records: filtered,
  }
}
