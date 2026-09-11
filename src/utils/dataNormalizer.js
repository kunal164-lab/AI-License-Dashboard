const aliases = {
  name: ['name', 'user', 'username'],
  email: ['email', 'email address', 'email_address'],
  department: ['department', 'dept'],
  vbu: ['vbu', 'business unit', 'business_unit'],
  product: ['product', 'tool'],
  usage_cost: ['usage cost', 'cost', 'usage_cost', 'usagecost'],
  monthly_license_cost: ['monthly cost', 'monthly_license_cost'],
  activity_count: ['activity', 'activity_count', 'requests', 'requests_count'],
  tokens_input: ['tokens_input', 'tokens in', 'tokens_in'],
  tokens_output: ['tokens_output', 'tokens out', 'tokens_out']
}

function findKey(key) {
  key = (key || '').toLowerCase().trim()
  for (const canonical in aliases) {
    if (canonical === key) return canonical
    const list = aliases[canonical]
    for (const a of list) if (a === key) return canonical
  }
  return key
}

export function normalizeData(rows) {
  return rows.map((r, idx) => {
    const out = {
      _id: r.user_id || r.id || 'u' + (idx + 1),
      _raw: { ...r }
    }
    for (const k in r) {
      const kk = findKey(k)
      out[kk] = r[k]
    }

    // Special handling for Claude Code CSV (User, Lines this Month)
    if (r['Lines this Month'] !== undefined || r['Lines this month'] !== undefined) {
      out.email = out.email || r['User'] || r['user'] || out.email
      out.name = out.name || (out.email ? out.email.split('@')[0] : 'Unknown')
      out.product = 'Claude Code'
      // normalize lines number (remove commas)
      const linesRaw = r['Lines this Month'] || r['Lines this month'] || ''
      const parsedLines = parseInt(String(linesRaw).replace(/,/g, '').replace(/[^0-9\-]/g,''), 10)
      out.lines = Number.isNaN(parsedLines) ? null : parsedLines
      out.activity_count = out.lines || out.activity_count || null
      out.monthly_license_cost = normalizeNumber(out.monthly_license_cost)
      out.license_status = 'assigned'
      out._source = (out._source ? out._source + ',code' : 'code')
    }

    // Special handling for Claude Chat CSV (has Chats, Messages)
    if (r['Chats'] !== undefined || r['Messages'] !== undefined) {
      out.email = out.email || r['Email'] || r['email'] || out.email
      out.name = out.name || (out.email ? String(out.email).split('@')[0] : (r['Name'] || 'Unknown'))
      out.product = 'Claude Chat'
      out.chats = normalizeInt(r['Chats'])
      out.messages = normalizeInt(r['Messages'])
      out.projects_created = normalizeInt(r['Projects Created'])
      out.projects_used = normalizeInt(r['Projects Used'])
      out.pull_requests = normalizeInt(r['Pull Requests'])
      out.code_sessions = normalizeInt(r['Code sessions'] || r['Code Sessions'])
      out.file_edits = normalizeInt(r['File Edits'] || r['File edits'])
      out.cowork_sessions = normalizeInt(r['Cowork Sessions'])
      out.cowork_messages = normalizeInt(r['Cowork Messages'])
      out.artifacts_created = normalizeInt(r['Artifacts Created'])
      out.claude_code_artifacts = normalizeInt(r['Claude Code Artifacts'])
      out.cowork_artifacts = normalizeInt(r['Cowork Artifacts'])
      out.activity_count = sumInts([out.chats, out.messages, out.code_sessions, out.file_edits])
      out.last_activity = out.last_activity || r['Last Active'] || r['last_activity'] || null
      out.plan = out.plan || r['Seat Tier'] || r['Seat tier'] || null
      out.role = out.role || r['Role'] || null
      out.days_active = normalizeInt(r['Days Active'] || r['Days active'])
      out.estimated_spend = normalizeFloat(r['Estimated Spend (USD)'] || r['Estimated Spend'])
      out._source = (out._source ? out._source + ',chat' : 'chat')
    }

    // helper normalizers (ensure numbers or null)
    function normalizeInt(v){
      if (v === null || v === undefined || v === '') return null
      const s = String(v).replace(/,/g,'').replace(/[^0-9\-]/g,'')
      const n = parseInt(s,10)
      return Number.isNaN(n) ? null : n
    }
    function normalizeFloat(v){
      if (v === null || v === undefined || v === '') return null
      const s = String(v).replace(/,/g,'').replace(/[^0-9.\-]/g,'')
      const n = parseFloat(s)
      return Number.isNaN(n) ? null : n
    }
    function normalizeNumber(v){
      // prefer float parsing, fall back to int
      const f = normalizeFloat(v)
      if (f !== null) return f
      return normalizeInt(v)
    }
    function sumInts(list){
      return list.reduce((acc,x)=> acc + (Number.isFinite(x)?x:0), 0) || null
    }

    out.monthly_license_cost = normalizeNumber(out.monthly_license_cost)
    out.usage_cost = normalizeNumber(out.usage_cost)
    out.activity_count = (out.activity_count === null || out.activity_count === undefined) ? null : Number(out.activity_count)
    out.assigned_date = out.assigned_date || out.date || null
    out.last_activity = out.last_activity || null
    out.product = out.product || 'Unknown'
    out.license_status = out.license_status || 'assigned'
    out.department = out.department || 'Unknown'
    out.vbu = out.vbu || 'Unknown'
    out.name = out.name || out.user || 'Unknown'
    out.email = out.email || null
    return out
  })
}

// mergeByEmail was removed — it collapsed every record for the same email
// into a single row with "first non-empty value wins" per field, including
// `product`, which silently discarded every product but one for anyone
// appearing in more than one connection/source. See src/utils/userModel.js
// (buildCanonicalUsers) for its replacement: one canonical user per person,
// with an unlimited `products` array instead of one flattened `product`.
