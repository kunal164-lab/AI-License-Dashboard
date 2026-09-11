// Freshservice agent normalization — Freshservice supports TWO independent
// ingestion methods (see server/services/freshservice/sync.js), selected
// per-connection via meta.sourceMethod:
//   'ms_group'    — current members of a configured Microsoft 365 security
//                    group, resolved server-side against the canonical
//                    microsoft_users population (graphGroup.js) — no CSV
//                    involved at all.
//   'manual_csv'  — a manually-uploaded Freshservice agent export (the
//                    automatic SharePoint CSV method this replaced was
//                    removed entirely due to unreliable SharePoint
//                    permissions/authentication — see this file's own git
//                    history/comments for that prior implementation).
// Both paths converge on the SAME generic Freshservice product-record shape
// below, so the rest of the app (Users/Products/Cost/Optimization/Reports)
// sees one consistent Freshservice agent dataset regardless of which method
// produced it — never merged together, never double-counted.
//
// Name/department/VBU/job title/manager are Microsoft-365-EXCLUSIVE fields
// (src/utils/userModel.js's AUTHORITATIVE_FIELDS) and are backfilled onto
// the canonical user during merge — never set here, from either method.
// Cost is NEVER source-provided for Freshservice from either method (a
// per-agent price is configured centrally in the Cost Engine) — an
// unpriced agent resolves to the Cost Engine's own 'unavailable'/N/A,
// exactly like any other product with no matching cost rule.

// ---- Manual CSV path ----
//
// The real Freshservice export ("Fresh-AgentList.csv") carries 17 columns
// (Name, Emails, Job Title, Time Zone, Last Updated Date, Address, Is
// Active, Freddy Copilot License, Function Unit, Division, Job
// Classification, VBU, Reporting Manager Name, User Type, User Scope, Cost
// Centre ID, Created Date) — only TWO of them matter for the Freshservice
// Agent-license relationship this app tracks:
//   Emails    — the identity key, matched against the canonical Microsoft
//               365 population (never fuzzy/name matching).
//   User Type — the ONLY signal for "is this person a Freshservice Agent."
//               A row is an agent if and only if this value, trimmed and
//               compared case-insensitively, equals "Agent". Every other
//               column (Is Active, Job Title, VBU, Function Unit, Division,
//               Freddy Copilot License, User Scope, Cost Centre, the two
//               date columns...) is deliberately never read here — none of
//               them determine agent status, and none of them are
//               Freshservice-authoritative identity data (Microsoft 365 is,
//               for anything overlapping like Job Title/VBU/Manager).
// Name is kept only as optional source/reference metadata (surfaced in the
// import result for an unmatched row, so the admin can recognize who it
// was without it ever becoming identity data).

function pick(row, ...aliases) {
  const keys = Object.keys(row || {})
  const normalizedKeys = keys.map((k) => k.trim().toLowerCase())
  for (const alias of aliases) {
    const idx = normalizedKeys.indexOf(alias.toLowerCase())
    if (idx === -1) continue
    const value = row[keys[idx]]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return null
}

function normalizeEmail(v) {
  if (!v) return null
  const e = String(v).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

// Trimmed, case-insensitive — "Agent", "agent", " AGENT ", "Agent " all
// count; anything else (Requester, blank, or any other User Type value)
// does not, regardless of any other column's value.
function isAgentUserType(v) {
  return String(v || '').trim().toLowerCase() === 'agent'
}

// jobTitle/vbu/functionUnit/division are captured here ONLY so an
// unmatched row's diagnostic display (buildFreshserviceAgentImport's
// `unmatchedUsers`) can show the admin enough context to investigate why
// this person exists in Freshservice but not Microsoft 365 — see this
// file's own header comment. None of these are ever used for matching or
// as identity data; Microsoft 365 remains the sole source for job
// title/VBU/etc on any MATCHED, canonical person.
function normalizeFreshserviceCsvRow(row) {
  return {
    name: pick(row, 'Name', 'Full Name', 'Agent Name', 'Agent'),
    emailRaw: pick(row, 'Email', 'Emails', 'Email Address', 'Work Email', 'Primary Email'),
    userTypeRaw: pick(row, 'User Type', 'Type', 'Agent Type'),
    jobTitleRaw: pick(row, 'Job Title', 'Title'),
    vbuRaw: pick(row, 'VBU'),
    functionUnitRaw: pick(row, 'Function Unit'),
    divisionRaw: pick(row, 'Division')
  }
}

// Guards the manual-import path against an unrelated file being uploaded by
// mistake. Deliberately checks for the exact two columns this app actually
// uses (an email column and a "User Type" column) rather than the old
// broad multi-field heuristic — that heuristic no longer applies now that
// this normalizer only ever looks at those two fields.
export function validateFreshserviceCsv(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return { valid: false, reason: 'The file contains no data rows.' }
  const normalized = rawRows.map(normalizeFreshserviceCsvRow)
  const hasEmailColumn = normalized.some((r) => r.emailRaw)
  if (!hasEmailColumn) return { valid: false, reason: 'No recognizable email column found (expected a header like "Emails").' }
  const hasUserTypeColumn = normalized.some((r) => r.userTypeRaw)
  if (!hasUserTypeColumn) return { valid: false, reason: 'No recognizable "User Type" column found — this does not look like a Freshservice agent export.' }
  return { valid: true, reason: null }
}

// The full CSV -> Freshservice-agent pipeline (Part 15 of the manual-CSV
// spec): normalize -> filter User Type=Agent -> normalize email ->
// deduplicate -> match canonical Microsoft users. Returns both the final
// product records (matched agents only — Part 7: an unmatched email is
// EXCLUDED from the canonical population, never used to create one) and a
// full diagnostic breakdown for the import-result summary; every number is
// computed from the actual rows, never hardcoded.
//
// Deduplication groups by normalized email across ALL rows (not just
// agent-tagged ones) so a genuine conflict — one row says Agent, another
// row for the SAME email doesn't — resolves correctly (Part 8: "prefer the
// explicit Agent record").
export function buildFreshserviceAgentImport(rawRows, { validEmails } = {}) {
  const emailSet = validEmails instanceof Set ? validEmails : new Set(validEmails || [])
  const rows = Array.isArray(rawRows) ? rawRows : []
  const normalized = rows.map(normalizeFreshserviceCsvRow)
  const agentRowCount = normalized.filter((r) => isAgentUserType(r.userTypeRaw)).length

  const byEmail = new Map()
  for (const r of normalized) {
    const email = normalizeEmail(r.emailRaw)
    if (!email) continue
    if (!byEmail.has(email)) byEmail.set(email, [])
    byEmail.get(email).push(r)
  }

  let duplicateRowCount = 0
  const agentEmails = []
  for (const [email, group] of byEmail) {
    if (group.length > 1) duplicateRowCount += group.length - 1
    const agentRow = group.find((r) => isAgentUserType(r.userTypeRaw))
    if (agentRow) {
      // Prefer the explicit Agent row's own fields for display (Part 8's
      // "prefer the explicit Agent record" rule, extended to the display
      // fields too) — falls back to any row in the group that has a value,
      // since a duplicate's non-Agent row might still carry the same
      // Job Title/VBU/etc.
      const pickField = (key) => agentRow[key] || group.find((r) => r[key])?.[key] || null
      agentEmails.push({
        email,
        name: pickField('name'),
        jobTitle: pickField('jobTitleRaw'),
        vbu: pickField('vbuRaw'),
        functionUnit: pickField('functionUnitRaw'),
        division: pickField('divisionRaw')
      })
    }
  }

  const matched = []
  const unmatchedEmails = []
  const unmatchedUsers = []
  for (const a of agentEmails) {
    if (emailSet.has(a.email)) {
      matched.push(a)
    } else {
      unmatchedEmails.push(a.email)
      // Display-only context for the "Unmatched Users" investigation list
      // (Part 1 of the spec this implements) — never used for matching;
      // identity is decided exclusively by normalized email, above.
      unmatchedUsers.push({
        name: a.name,
        email: a.email,
        userType: 'Agent',
        jobTitle: a.jobTitle,
        vbu: a.vbu,
        functionUnit: a.functionUnit,
        division: a.division
      })
    }
  }

  const importedAt = new Date().toISOString()
  const records = matched.map((a) => ({
    _id: a.email,
    name: null, // backfilled from the Microsoft directory during canonical merge — never the CSV's own value
    email: a.email,
    role: null,
    product: 'Freshservice',
    plan: null,
    license_status: 'assigned',
    last_activity: null,
    activity_count: null,
    _source: 'freshservice',
    _imported_at: importedAt
  }))

  return {
    records,
    diagnostics: {
      csvRows: rows.length,
      agentRows: agentRowCount,
      uniqueAgentEmails: agentEmails.length,
      matchedCount: matched.length,
      unmatchedCount: unmatchedEmails.length,
      unmatchedEmails,
      unmatchedUsers,
      duplicateRows: duplicateRowCount
    }
  }
}

// ---- Microsoft 365 security group path (unchanged) ----

// `users`: rows from server/repositories/microsoftRepo.js (the canonical
// Microsoft user population) that are current members of the configured
// security group — see runFreshserviceGroupSync. No per-agent metadata
// (license type, role, last activity) exists for this method — those stay
// null, never guessed at.
export function toFreshserviceProductRecordsFromGroup(users) {
  const importedAt = new Date().toISOString()
  return (users || [])
    .map((u) => {
      const email = (u.upn || u.mail || '').trim().toLowerCase() || null
      if (!email) return null
      return {
        _id: email,
        name: null,
        email,
        role: null,
        product: 'Freshservice',
        plan: null,
        license_status: 'assigned',
        last_activity: null,
        activity_count: null,
        _source: 'freshservice',
        _imported_at: importedAt
      }
    })
    .filter(Boolean)
}
