// Reuses the EXACT SAME normalizer files the frontend uses — not a server
// copy of the same logic. These files have zero browser-API dependencies
// (verified: no `window`/`document`, no Vite-only globals), so importing
// them directly from the server is safe and correct.
import { normalizeData } from '../src/utils/dataNormalizer.js'
import { normalizeCopilot } from '../src/utils/copilotNormalizer.js'
import { normalizeKiro } from '../src/utils/kiroNormalizer.js'
import { normalizeMicrosoft } from '../src/utils/microsoftNormalizer.js'

export function normalizeBySource(source, records, { validEmails } = {}) {
  if (source === 'github') return normalizeCopilot(records || [], { validEmails })
  if (source === 'kiro') return normalizeKiro(records || [], { validEmails })
  if (source === 'microsoft') return normalizeMicrosoft(records || [])
  return normalizeData(records || [])
}
