// THE reusable canonical-identity rule every provider's own normalizer
// applies at import time — Microsoft 365 is the sole authoritative
// employee directory; no external source (Kiro, Claude, GitHub,
// Freshservice, or any future CSV/API provider) may create a canonical
// user. A provider record only enters the current dashboard population
// when its own email matches an entry in this set; an unmatched record is
// excluded from the canonical population and reported as an import
// diagnostic instead, never silently dropped or turned into a placeholder
// "Unknown" employee. See src/utils/userModel.js's AUTHORITATIVE_FIELDS for
// the matching rule that Microsoft's org-identity fields (name, department,
// VBU, manager, job title, company, office, domain, account status) are
// resolved from — never a provider's own value.
//
// This was previously duplicated ad hoc in three places (the Kiro CSV
// import route, Claude's sync.js, Claude's manual import route), each
// independently looping over msRepo.listAllUsers() and adding both upn and
// mail — consolidated here so a new provider integration reuses the exact
// same rule instead of inventing its own.
function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : null
}

// `msUsers`: raw Microsoft directory rows (server/repositories/
// microsoftRepo.js#listAllUsers, or the client-serialized equivalent) —
// already gated to the SSP company population at sync time
// (microsoftRepo.js#isSspCompany), so this set needs no re-filtering here.
// Both upn and mail are included (when present) since a provider's own
// export may report either address for the same real person.
export function buildValidEmailSet(msUsers) {
  const set = new Set()
  for (const u of msUsers || []) {
    const upn = normEmail(u.upn)
    const mail = normEmail(u.mail)
    if (upn) set.add(upn)
    if (mail) set.add(mail)
  }
  return set
}

export function isEmailInDirectory(email, validEmailSet) {
  const normalized = normEmail(email)
  return !!normalized && validEmailSet.has(normalized)
}
