// Canonical field registry for the normalized user/record model — the single
// source of truth for filter types and display names, shared by the Users
// table, the global quick-filter bar, active-filter-chip labels, and the
// report engine. Extending this list makes a field filterable everywhere at
// once; nothing else needs to duplicate this knowledge.
export const USER_COLUMNS = [
  { key: 'name', name: 'Name', type: 'text' },
  { key: 'email', name: 'Email', type: 'text' },
  // department/vbu/job_title/manager/company/office/domain/account_status:
  // Microsoft 365's EXCLUSIVE authoritative fields (src/utils/userModel.js
  // AUTHORITATIVE_FIELDS) — resolved only from the synced Microsoft
  // directory, never any other provider's CSV/API data, never a fallback.
  // N/A when Microsoft has no matching record for this person.
  { key: 'department', name: 'Department', type: 'category' },
  { key: 'vbu', name: 'VBU', type: 'category' },
  { key: 'job_title', name: 'Job Title', type: 'category' },
  { key: 'company', name: 'Company', type: 'category' },
  { key: 'office', name: 'Office', type: 'category' },
  { key: 'domain', name: 'Domain', type: 'category' },
  { key: 'account_status', name: 'Account Status', type: 'category' },
  { key: 'product', name: 'Product', type: 'category' },
  { key: 'provider', name: 'Provider', type: 'category' },
  { key: 'plan', name: 'Plan', type: 'category' },
  { key: 'license_status', name: 'License Status', type: 'category' },
  { key: 'role', name: 'Role', type: 'category' },
  { key: 'manager', name: 'Manager', type: 'category' },
  // Only ever populated where a normalizer actually sets it (currently the
  // Claude CSV branches) — N/A/absent from filter options otherwise, never
  // invented for sources that don't report it.
  { key: 'source', name: 'Source', type: 'category' },
  { key: 'days_active', name: 'Days Active', type: 'number' },
  { key: 'activity_count', name: 'Usage', type: 'number' },
  { key: 'chats', name: 'Chats', type: 'number' },
  { key: 'messages', name: 'Messages', type: 'number' },
  { key: 'code_sessions', name: 'Code Sessions', type: 'number' },
  { key: 'file_edits', name: 'File Edits', type: 'number' },
  { key: 'projects_created', name: 'Projects Created', type: 'number' },
  { key: 'projects_used', name: 'Projects Used', type: 'number' },
  { key: 'pull_requests', name: 'Pull Requests', type: 'number' },
  { key: 'cowork_sessions', name: 'Cowork Sessions', type: 'number' },
  { key: 'cowork_messages', name: 'Cowork Messages', type: 'number' },
  { key: 'artifacts_created', name: 'Artifacts Created', type: 'number' },
  { key: 'claude_code_artifacts', name: 'Claude Code Artifacts', type: 'number' },
  { key: 'cowork_artifacts', name: 'Cowork Artifacts', type: 'number' },
  { key: 'estimated_spend', name: 'Estimated Spend', type: 'number' },
  { key: 'monthly_license_cost', name: 'Monthly Cost', type: 'number' },
  // Canonical-user aggregates (src/utils/userModel.js) — a sum/count across
  // every product a person has, not a single source's own field.
  { key: 'totalLicenses', name: 'Total Products', type: 'number' },
  { key: 'totalSpend', name: 'Total Spend', type: 'number' },
  { key: 'last_activity', name: 'Last Active', type: 'date' },
  // Deliberately "Usage Status," never just "Status" — sitting next to
  // license_status's own "License Status" column/filter/chip, an ambiguous
  // "Status" label is exactly what made a correct usage_status filter LOOK
  // like it might be filtering license_status instead (they're unrelated
  // concepts — src/utils/licenseStatus.js).
  { key: 'usage_status', name: 'Usage Status', type: 'category' },
  // Microsoft 365 Copilot per-app activity (N/A for other providers).
  { key: 'ms_teams_last_activity', name: 'Teams Copilot Last Active', type: 'date' },
  { key: 'ms_word_last_activity', name: 'Word Copilot Last Active', type: 'date' },
  { key: 'ms_excel_last_activity', name: 'Excel Copilot Last Active', type: 'date' },
  { key: 'ms_powerpoint_last_activity', name: 'PowerPoint Copilot Last Active', type: 'date' },
  { key: 'ms_outlook_last_activity', name: 'Outlook Copilot Last Active', type: 'date' },
  { key: 'ms_onenote_last_activity', name: 'OneNote Copilot Last Active', type: 'date' },
  { key: 'ms_loop_last_activity', name: 'Loop Copilot Last Active', type: 'date' },
  { key: 'ms_copilot_chat_last_activity', name: 'Copilot Chat Last Active', type: 'date' },
  { key: 'ms_prompts_all_apps', name: 'Copilot Prompts (All Apps)', type: 'number' }
]

export const COLUMN_BY_KEY = Object.fromEntries(USER_COLUMNS.map((c) => [c.key, c]))
