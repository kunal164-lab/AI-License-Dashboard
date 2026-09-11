// Maps the Microsoft Graph getMicrosoft365CopilotUsageUserDetail report
// (CSV or JSON, v1 columns confirmed; v2-named columns picked up
// opportunistically if a tenant ever returns them) into the app's shared
// normalized record shape.
//
// Deliberately NOT fabricated:
// - cost/monthly_license_cost/estimated_spend: the usage report has no
//   financial data, so these stay null (rendered as "N/A" everywhere).
// - department/vbu/plan: not part of this report; would require a separate
//   Graph directory call (User.Read.All/Directory.Read.All) that isn't
//   requested by this app today, so these stay null rather than guessed.
function pick(r, ...keys) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k]
  }
  return null
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).replace(/,/g, '').trim()
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return Number(s)
  return null
}

export function normalizeMicrosoft(records) {
  return (records || []).map((r, idx) => {
    const email = String(pick(r, 'User Principal Name', 'userPrincipalName', 'email') || '').trim().toLowerCase() || null
    const userId = pick(r, 'User Id', 'AAD User ID', 'userId', 'id')

    // v1 per-app last-activity fields (always attempted).
    const teams = pick(r, 'Microsoft Teams Copilot Last Activity Date', 'Teams Copilot Last Activity Date')
    const word = pick(r, 'Word Copilot Last Activity Date')
    const excel = pick(r, 'Excel Copilot Last Activity Date')
    const powerpoint = pick(r, 'PowerPoint Copilot Last Activity Date')
    const outlook = pick(r, 'Outlook Copilot Last Activity Date')
    const onenote = pick(r, 'OneNote Copilot Last Activity Date')
    const loop = pick(r, 'Loop Copilot Last Activity Date')
    const copilotChat = pick(r, 'Copilot Chat Last Activity Date')

    // v2-only fields — only populated if the tenant/report actually returns
    // them; otherwise stay null (no v2 activation is performed today, see
    // server/connectors/microsoft.js).
    const promptsAllApps = toNumber(pick(r, 'Prompts submitted for all apps', 'Total Prompts'))
    const promptsChatWork = toNumber(pick(r, 'Prompts submitted for Copilot Chat (work)'))
    const promptsChatWeb = toNumber(pick(r, 'Prompts submitted for Copilot Chat (web)'))
    const activeDaysAllApps = toNumber(pick(r, 'Active Usage Days for all apps', 'Active Usage Days'))
    const chatWork = pick(r, 'Copilot Chat (work) Last Activity Date')
    const chatWeb = pick(r, 'Copilot Chat (web) Last Activity Date')
    const m365Copilot = pick(r, 'Microsoft 365 Copilot Last Activity Date')
    const edge = pick(r, 'Edge Copilot Last Activity Date', 'Edge Last Activity Date')
    const copilotAgent = pick(r, 'Copilot Agent Last Activity Date')

    // activity_count feeds the app's shared Active/Inactive classification
    // (utils/activityScore.js) — the same mechanism every other provider
    // uses. Prefer the real v2 prompt count when available; otherwise fall
    // back to a transparent, real-data-derived signal: how many distinct
    // Copilot surfaces show activity for this user in the report period.
    const surfaceDates = [teams, word, excel, powerpoint, outlook, onenote, loop, copilotChat, chatWork, chatWeb, m365Copilot, edge, copilotAgent]
    const surfacesUsed = surfaceDates.filter(Boolean).length
    const activityCount = promptsAllApps !== null ? promptsAllApps : (surfacesUsed > 0 ? surfacesUsed : 0)

    const lastActivity = pick(r, 'Last Activity Date') || [teams, word, excel, powerpoint, outlook, onenote, loop, copilotChat, chatWork, chatWeb, m365Copilot, edge, copilotAgent]
      .filter(Boolean).sort().slice(-1)[0] || null

    return {
      _id: userId || email || ('ms_copilot_' + (idx + 1)),
      _raw: { ...r },
      product: 'Microsoft Copilot',
      user_id: userId,
      email,
      name: pick(r, 'Display Name', 'displayName') || (email ? email.split('@')[0] : null) || ('ms_user_' + (idx + 1)),

      // Presence in this report means Microsoft has assigned the user a
      // Microsoft 365 Copilot license (that's what the report is scoped
      // to) — a legitimate structural inference, not fabricated data.
      license_status: 'assigned',
      // Not available from this report without an additional directory
      // call this app doesn't make today — left null rather than guessed.
      department: null,
      vbu: null,
      plan: null,
      monthly_license_cost: null,
      estimated_spend: null,

      activity_count: activityCount,
      last_activity: lastActivity,
      days_active: activeDaysAllApps,

      report_refresh_date: pick(r, 'Report Refresh Date'),
      report_period: pick(r, 'Report Period'),

      ms_teams_last_activity: teams,
      ms_word_last_activity: word,
      ms_excel_last_activity: excel,
      ms_powerpoint_last_activity: powerpoint,
      ms_outlook_last_activity: outlook,
      ms_onenote_last_activity: onenote,
      ms_loop_last_activity: loop,
      ms_copilot_chat_last_activity: copilotChat,

      ms_prompts_all_apps: promptsAllApps,
      ms_prompts_chat_work: promptsChatWork,
      ms_prompts_chat_web: promptsChatWeb,
      ms_copilot_chat_work_last_activity: chatWork,
      ms_copilot_chat_web_last_activity: chatWeb,
      ms_m365_copilot_last_activity: m365Copilot,
      ms_edge_last_activity: edge,
      ms_copilot_agent_last_activity: copilotAgent
    }
  })
}

export default normalizeMicrosoft
