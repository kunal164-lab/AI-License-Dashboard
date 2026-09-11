function toNumber(v){
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).replace(/,/g,'').trim()
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return Number(s)
  return null
}

function normEmail(e) {
  if (!e) return null
  const trimmed = String(e).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

// Microsoft 365 is the sole authoritative employee directory (see
// src/utils/canonicalIdentity.js) — GitHub Copilot usage reports often
// don't include a verified email at all (GitHub can withhold it for
// privacy), and even when they do, a row with no email or an email that
// doesn't match a current Microsoft 365 user must NOT become a canonical
// person: never a synthetic "copilot_user_N" identity, never a raw
// github_login used as a display name. `validEmails` omitted entirely
// (vs. an empty Set) disables the gate, matching every other provider's
// normalizer convention in this app.
export function normalizeCopilot(records, { validEmails } = {}){
  const hasGate = validEmails !== undefined && validEmails !== null
  const emailSet = hasGate ? (validEmails instanceof Set ? validEmails : new Set(validEmails)) : null

  const out = []
  for (const r of (records || [])) {
    const email = normEmail(r.email)
    if (emailSet && (!email || !emailSet.has(email))) continue

    const githubId = r.github_id || r.id || r['GitHub ID'] || null
    const rec = {
      _id: email || (githubId ? ('gh_' + githubId) : null) || r.id || r.user_id,
      _raw: { ...r },
      product: 'GitHub Copilot',
      // Presence in the GitHub Copilot usage report means the org has this
      // seat assigned (same structural inference every other provider's
      // normalizer makes — see src/utils/microsoftNormalizer.js) — never
      // derived from activity, and never left undefined the way this
      // record used to (see src/utils/licenseStatus.js for why an absent
      // value must not be silently treated as "inactive" downstream).
      license_status: 'assigned'
    }
    if (!rec._id) continue // no email and no stable GitHub id at all — nothing safe to key this record by

    // identities — name is deliberately left null (backfilled from the
    // Microsoft directory during canonical merge, src/utils/userModel.js),
    // never a raw github_login or synthetic placeholder.
    rec.github_id = githubId
    rec.github_login = r.login || r.username || r.github_login || r['GitHub Login'] || null
    rec.email = email
    rec.name = null
    out.push(applyMetrics(rec, r))
  }
  return out
}

function applyMetrics(out, r){

    // organization / enterprise
    out.organization = r.organization || r.enterprise || r.org || r['Organization'] || null

    // common date / activity
    out.date = r.date || r.day || r['day'] || null
    out.last_activity = r.last_activity || r.lastActive || r['last_active'] || out.date || null

    // numeric metrics (attempt to map common Copilot report columns)
    out.copilot_code_completions = toNumber(r.code_completions || r['code_completions'] || r['Code completions'] || r['completions'])
    out.copilot_accepted_suggestions = toNumber(r.accepted_suggestions || r['accepted_suggestions'] || r['Accepted suggestions'])
    out.copilot_chat_requests = toNumber(r.chat_requests || r['chat_requests'] || r['Chat requests'])
    out.copilot_agent_activity = toNumber(r.agent_activity || r['agent_activity'])
    out.copilot_ai_credits = toNumber(r.ai_credits || r['ai_credits'] || r['AI credits'])
    out.copilot_usage = toNumber(r.usage || r['usage'] || r['Usage'])

    // models & languages: preserve as-is
    out.copilot_models = r.models || r['models'] || r['Model'] || null
    out.copilot_languages = r.languages || r['languages'] || r['Language'] || null

    // activity_count: sum of available copilot numeric metrics
    const nums = [out.copilot_code_completions, out.copilot_accepted_suggestions, out.copilot_chat_requests, out.copilot_agent_activity, out.copilot_usage].filter(v=>v!=null)
    out.activity_count = nums.length ? nums.reduce((a,b)=>a+b,0) : null

    return out
}

export default normalizeCopilot
