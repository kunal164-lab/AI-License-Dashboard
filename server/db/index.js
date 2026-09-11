// Central persistence layer. Real SQL (not localStorage, not an in-memory
// Map) so the server process is the single source of truth shared by every
// browser/device that talks to it — the whole point of this module.
//
// Engine: sql.js (WASM SQLite) for local/dev — chosen deliberately over
// better-sqlite3 because it needs zero native compilation (better-sqlite3
// failed to build in this environment: no usable Python/node-gyp toolchain).
// The database is a single file on disk (DATABASE_URL, default
// server/data/app.sqlite), loaded into memory on boot and re-persisted after
// every write.
//
// Production path: swap this file for a Postgres-backed implementation of
// the same exported functions (query/run/persist aren't part of the public
// surface other modules use — they only call the repository functions in
// server/repositories/*, which are written in portable-enough SQL). Nothing
// outside this db/ folder needs to change to make that swap.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveDbPath() {
  const raw = process.env.DATABASE_URL || 'file:./data/app.sqlite'
  const stripped = raw.startsWith('file:') ? raw.slice(5) : raw
  return path.isAbsolute(stripped) ? stripped : path.join(__dirname, '..', stripped)
}

const DB_PATH = resolveDbPath()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'api',
  label TEXT NOT NULL,
  auth_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  meta_json TEXT NOT NULL DEFAULT '{}',
  credentials_enc TEXT,
  stats_users INTEGER NOT NULL DEFAULT 0,
  stats_records INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT,
  last_attempt TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_records_connection ON usage_records(connection_id);

CREATE TABLE IF NOT EXISTS sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_history_connection ON sync_history(connection_id);

-- Microsoft 365 / Microsoft Graph capability datasets. Each is scoped to the
-- owning connection (a row in the existing generic "connections" table,
-- source='microsoft') via connection_id, and keyed additionally by the
-- stable Microsoft Graph object id (ms_id) so repeated syncs upsert
-- (INSERT OR REPLACE) instead of accumulating duplicates.
--
-- Deliberately NOT created (see docs/microsoft-graph-integration.md):
--   microsoft_connections   - the existing "connections" table already
--                              covers this (source='microsoft'); a parallel
--                              table would just duplicate that row.
--   microsoft_capabilities  - fixed application metadata (which Graph
--                              endpoints/permissions map to which
--                              capability), not per-tenant data - lives in
--                              server/services/microsoft/capabilities.js
--                              as a code registry instead of a table.
--   microsoft_departments   - derived on demand from microsoft_users
--                              (group-by), not separately stored.
--   microsoft_copilot_usage - Copilot data continues to flow through the
--                              existing generic usage_records table so it
--                              keeps powering the existing AI license
--                              dashboard unchanged; a separate table would
--                              fork that data into two places.
--   microsoft_teams          - a Microsoft 365 group that also has a Team
--                              provisioned shows up ONCE in microsoft_groups
--                              with is_team=1 (from the group's own
--                              resourceProvisioningOptions field) rather
--                              than as a duplicate row in a second table.
CREATE TABLE IF NOT EXISTS microsoft_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_ms_sync_runs_connection ON microsoft_sync_runs(connection_id);

CREATE TABLE IF NOT EXISTS microsoft_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ms_id TEXT NOT NULL,
  upn TEXT,
  mail TEXT,
  display_name TEXT,
  given_name TEXT,
  surname TEXT,
  department TEXT,
  job_title TEXT,
  office_location TEXT,
  company_name TEXT,
  employee_id TEXT,
  account_enabled INTEGER,
  usage_location TEXT,
  domain TEXT,
  vbu TEXT,
  manager_display_name TEXT,
  manager_upn TEXT,
  assigned_licenses_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, ms_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_users_connection ON microsoft_users(connection_id);

CREATE TABLE IF NOT EXISTS microsoft_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ms_id TEXT NOT NULL,
  device_name TEXT,
  user_ms_id TEXT,
  user_principal_name TEXT,
  operating_system TEXT,
  os_version TEXT,
  compliance_state TEXT,
  management_state TEXT,
  owner_type TEXT,
  enrolled_at TEXT,
  last_sync_at TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  azure_ad_device_id TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, ms_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_devices_connection ON microsoft_devices(connection_id);

CREATE TABLE IF NOT EXISTS microsoft_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ms_id TEXT NOT NULL,
  display_name TEXT,
  version TEXT,
  publisher TEXT,
  platform TEXT,
  device_count INTEGER,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, ms_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_applications_connection ON microsoft_applications(connection_id);

CREATE TABLE IF NOT EXISTS microsoft_device_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  application_ms_id TEXT NOT NULL,
  device_ms_id TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, application_ms_id, device_ms_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_device_apps_connection ON microsoft_device_applications(connection_id);

CREATE TABLE IF NOT EXISTS microsoft_licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  user_ms_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sku_part_number TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, user_ms_id, sku_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_licenses_connection ON microsoft_licenses(connection_id);

-- Microsoft 365 Groups (and Teams, flagged on the same row via is_team —
-- see services/microsoft/groups.js for why this isn't a separate table).
CREATE TABLE IF NOT EXISTS microsoft_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ms_id TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  mail TEXT,
  mail_nickname TEXT,
  group_types TEXT NOT NULL DEFAULT '[]',
  security_enabled INTEGER,
  mail_enabled INTEGER,
  visibility TEXT,
  is_team INTEGER NOT NULL DEFAULT 0,
  created_at_graph TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, ms_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_groups_connection ON microsoft_groups(connection_id);

-- Entra ID sign-in logs (time-windowed — see services/microsoft/signins.js).
CREATE TABLE IF NOT EXISTS microsoft_sign_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  graph_signin_id TEXT NOT NULL,
  created_at TEXT,
  user_id TEXT,
  user_display_name TEXT,
  user_principal_name TEXT,
  app_display_name TEXT,
  app_id TEXT,
  client_app_used TEXT,
  ip_address TEXT,
  location TEXT,
  resource_display_name TEXT,
  conditional_access_status TEXT,
  status TEXT,
  failure_reason TEXT,
  failure_error_code TEXT,
  device_detail TEXT,
  authentication_requirement TEXT,
  risk_level TEXT,
  risk_state TEXT,
  risk_detail TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, graph_signin_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_signins_connection ON microsoft_sign_ins(connection_id);
CREATE INDEX IF NOT EXISTS idx_ms_signins_created ON microsoft_sign_ins(created_at);

-- Freshservice agent/license data (see server/services/freshservice/). NOT
-- currently populated by the live sync path — Freshservice product records
-- flow through the generic connections/records tables instead, same as
-- every other provider; this table predates that and is kept only so an
-- existing database file's data isn't silently dropped. One row per agent,
-- keyed by a stable record_key derived from the CSV (email if present, else
-- a row-derived fallback) so repeated refreshes upsert instead of
-- duplicating.
--
-- Deliberately NOT created:
--   freshservice_connections - reuses the existing generic "connections"
--                               table (source='freshservice'), same as every
--                               other provider (github/kiro/microsoft).
--   freshservice_sync_runs   - Freshservice is a single dataset (not
--                               Microsoft 365's multiple independent
--                               capabilities), so the existing generic
--                               sync_history table already fits exactly.
-- Kept OUT of the generic usage_records table on purpose: usage_records
-- feeds the cross-provider AI license/usage dashboard (Users/Overview),
-- and Freshservice agents (an IT service-desk seat list) are not AI
-- product usage - merging them in would silently conflate the two and
-- double-count people who are also tracked as Claude/Copilot users.
CREATE TABLE IF NOT EXISTS freshservice_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  record_key TEXT NOT NULL,
  name TEXT,
  email TEXT,
  agent_id TEXT,
  license_type TEXT,
  status TEXT,
  department TEXT,
  location TEXT,
  role TEXT,
  job_title TEXT,
  employee_id TEXT,
  manager TEXT,
  last_active TEXT,
  last_login TEXT,
  created_date TEXT,
  updated_date TEXT,
  cost TEXT,
  vbu TEXT,
  cost_centre TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, record_key)
);
CREATE INDEX IF NOT EXISTS idx_freshservice_agents_connection ON freshservice_agents(connection_id);

-- Full monthly Kiro usage history — one row per (connection, email, month),
-- already aggregated from the raw per-date CSV rows (src/utils/
-- kiroNormalizer.js). Kept OUT of usage_records for the OPPOSITE reason
-- freshservice_agents is: Kiro usage genuinely IS cross-provider AI product
-- usage and DOES belong in usage_records/the canonical pipeline (Users/
-- Cost/Optimization/Reports) — but usage_records holds only ONE CURRENT
-- record per person per product everywhere else in this app (no provider
-- reports historical monthly snapshots), so only the LATEST month per user
-- is written there (server/index.js's /api/kiro/import-csv). This table
-- holds every month so the dedicated Kiro page can show full history
-- without turning "one Kiro license" into N duplicate canonical products.
CREATE TABLE IF NOT EXISTS kiro_usage_monthly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  month TEXT NOT NULL,
  plan TEXT,
  credits_used INTEGER NOT NULL DEFAULT 0,
  chat_conversations INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  client_types_json TEXT NOT NULL DEFAULT '[]',
  last_activity TEXT,
  raw_daily_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL,
  UNIQUE(connection_id, email, month)
);
CREATE INDEX IF NOT EXISTS idx_kiro_usage_monthly_connection ON kiro_usage_monthly(connection_id);

-- Claude MTD (Month-To-Date) spend/usage snapshots (server/services/claude/
-- sync.js). The Claude_Spend_MTD.csv file is a SNAPSHOT of the current MTD
-- period, not a historical daily dataset (Part 4 of the spec this
-- implements) — every import (automatic SharePoint/OneDrive or manual CSV)
-- replaces the CURRENT dataset, never sums with a previous one. Each
-- successful import is still recorded as its own row here (snapshot_hash
-- lets a re-check tell "unchanged" from "new data" without re-importing —
-- Part 5), so a genuine history of past MTD snapshots is retained for a
-- future trends feature, but ONLY the latest row with status='success'
-- feeds the current canonical dashboard (via claude_mtd_snapshot_records
-- below, mirrored into usage_records the same way every other provider's
-- CURRENT state is).
CREATE TABLE IF NOT EXISTS claude_mtd_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  snapshot_hash TEXT NOT NULL,
  snapshot_imported_at TEXT NOT NULL,
  reporting_type TEXT NOT NULL DEFAULT 'MTD',
  record_count INTEGER NOT NULL DEFAULT 0,
  unique_user_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claude_mtd_snapshots_connection ON claude_mtd_snapshots(connection_id);

-- One row per (snapshot, canonical user, product) — the per-model
-- breakdown for that product/user is folded into models_json rather than
-- exploded into further rows, matching the canonical record shape
-- src/utils/claudeNormalizer.js already produces (never one row per model).
CREATE TABLE IF NOT EXISTS claude_mtd_snapshot_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES claude_mtd_snapshots(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  product TEXT NOT NULL,
  -- The person's resolved Claude seat_tier (src/utils/claudeNormalizer.js#
  -- resolveSeatTier) — persisted so it survives storage/refresh, not just
  -- shown transiently during import (see the Claude plan/seat tier spec).
  plan TEXT,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_net_spend_usd REAL NOT NULL DEFAULT 0,
  total_gross_spend_usd REAL NOT NULL DEFAULT 0,
  models_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_claude_mtd_snapshot_records_snapshot ON claude_mtd_snapshot_records(snapshot_id);

-- Centralized cost/billing management (Cost page — see
-- server/services/costEngine.js). One rule can apply at product level
-- (plan_name/sku both null - a default) or be narrowed to an exact
-- plan/SKU - matching is always exact, never fuzzy (see costEngine.js).
-- cost_type distinguishes a public reference price from an admin-
-- configured or actual contract/billing figure so the UI never mislabels
-- one as the other. Superseded rules are deactivated (is_active=0), not
-- deleted, so historical reports can still see what was configured then.
CREATE TABLE IF NOT EXISTS cost_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  product TEXT NOT NULL,
  plan_name TEXT,
  sku TEXT,
  sku_id TEXT,
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_frequency TEXT NOT NULL DEFAULT 'monthly',
  cost_type TEXT NOT NULL DEFAULT 'reference',
  source TEXT,
  effective_from TEXT,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_rules_product ON cost_rules(provider, product);

-- Generic key/value application settings - the single source of truth for
-- global settings like the app's display currency (never localStorage,
-- see src/pages/Cost.jsx).
CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

-- Manually-configured currency conversion rates only (MVP - no live/auto
-- exchange-rate fetching, see costEngine.js). A conversion only ever
-- happens when a matching row exists here; otherwise the original
-- currency/amount is shown untouched rather than a faked conversion.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  source TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(base_currency, target_currency)
);

-- Human-user authentication/authorization (server/auth/*) — deliberately
-- separate from the connections table above (which stores PROVIDER application
-- credentials for data sync, e.g. the Microsoft Graph app registration used
-- to pull Copilot/Users/Devices data). Sessions are express-session's own
-- store, backed here instead of the default in-memory store so a server
-- restart doesn't silently sign everyone out and so this single-process app
-- doesn't leak session memory over time.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The admin-configured "which Microsoft 365 security group maps to which
-- application role/pages" table (server/repositories/rbacRepo.js) — the
-- single source of authorization truth this app implements (Part 2/5 of the
-- auth spec). security_group_id is the stable Graph id, resolved once at
-- save time from security_group_name (same pattern as Freshservice's own
-- security-group lookup) and used for every later membership check;
-- security_group_name is retained only for display. allowed_pages_json is a
-- JSON array of page keys from the central page registry (server/auth/
-- pages.js) — never a raw route string invented ad hoc. can_write is a
-- separate flag from the role column (a free-text label, so custom roles beyond
-- Admin/Read Only can be added later) so future mappings could combine a
-- custom role name with real write access without changing this schema.
CREATE TABLE IF NOT EXISTS role_group_mappings (
  id TEXT PRIMARY KEY,
  security_group_name TEXT NOT NULL,
  security_group_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'read_only',
  allowed_pages_json TEXT NOT NULL DEFAULT '[]',
  can_write INTEGER NOT NULL DEFAULT 0,
  role_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Role definitions (Part 3 of the custom-roles spec) — a role OWNS a
-- permission set (allowed pages + write access); a role_group_mappings row
-- now just references one by id. The role/allowed_pages_json/can_write
-- columns above are legacy columns kept only as migration source data for
-- databases created before this table existed (server/repositories/
-- rolesRepo.js, migrateLegacyRoleMappings) -- role_id is authoritative
-- going forward. id is the STABLE identifier (the built-in read-only
-- role's is the literal string 'Read_Only', case-sensitive, per spec; a
-- custom role's is a slugified version of its display name, e.g.
-- 'license_manager' for "License Manager") -- never regenerated, so
-- existing mappings/audit history referencing it keep working across a
-- display-name-only edit.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  allowed_pages_json TEXT NOT NULL DEFAULT '[]',
  can_write INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Authentication/authorization audit trail (Part 16 of the auth spec) —
-- successful/failed logins, access-denied events, and RBAC configuration
-- changes. Never stores tokens/secrets — only identity claims (upn/oid,
-- already non-secret) and a small JSON detail blob describing the event.
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_upn TEXT,
  actor_oid TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_at ON auth_audit_log(at);

-- The local administrator account (server/auth/localAuth.js) — the
-- bootstrap AND permanent emergency-recovery identity: a real application
-- identity (not a Microsoft directory user, never duplicated with one),
-- always available even when Entra ID is unconfigured or unreachable. A
-- SINGLE row (id is always 'default' — this is deliberately not a general
-- local-user system, just the one emergency account the spec asks for).
-- password_hash is a bcrypt hash ONLY — the plaintext password is never
-- stored or logged anywhere.
CREATE TABLE IF NOT EXISTS local_admin (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- VBU-aware Dashboard Views (branding/theme/sidebar-page-visibility per
-- organizational identity — see server/services/dashboardViews.js). A
-- dashboard_views row is a NAMED, admin-managed config; id is a STABLE
-- identifier set once at creation and never changes (same convention as
-- roles.id) — the three initial views (SSP/SSP_WORLDWIDE/SSP_UK_I) are
-- seeded with fixed ids by seedDefaultDashboardViews(). theme_json/
-- pages_json/dashboard_json are JSON blobs (same convention as
-- roles.allowed_pages_json) — theme_json is a SPARSE set of CSS-token
-- overrides (missing keys fall back to the base theme), pages_json is an
-- array of page-key strings from the central registry (server/auth/
-- pages.js) that this view's sidebar shows (further narrowed by RBAC —
-- this table is never a second permission system), dashboard_json is
-- reserved for future per-view widget/dashboard config (not yet editable
-- through the admin UI). logo_key is a key into the centralized logo
-- registry (src/utils/dashboardViewAssets.js) — never a raw file path, so
-- an admin can never point this at an arbitrary URL. is_builtin protects
-- the 3 seeded views from deletion (mirrors roles.is_builtin); is_active
-- lets a view be retired without deleting it (mirrors cost_rules.is_active).
CREATE TABLE IF NOT EXISTS dashboard_views (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_key TEXT NOT NULL DEFAULT 'ssp',
  theme_json TEXT NOT NULL DEFAULT '{}',
  pages_json TEXT NOT NULL DEFAULT '[]',
  dashboard_json TEXT NOT NULL DEFAULT '{}',
  -- Dashboard View VBU Data Assignment spec: which VBU(s) this view's
  -- business data is scoped to (a JSON array of the same free-text VBU
  -- strings stored on microsoft_users.vbu) — DATA SCOPE, never a second
  -- permission system (RBAC/allowedPages above are untouched by this).
  -- Empty array means "not yet configured" — server/services/
  -- dashboardViews.js treats that as deferring entirely to the viewer's
  -- own resolved VBU (today's exact pre-existing behavior), never as
  -- "unrestricted for everyone."
  allowed_vbus_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Which VBU (the same free-text string already stored on
-- microsoft_users.vbu) gets which dashboard_views row. One VBU maps to at
-- most one view (UNIQUE) — an unmapped VBU falls back to the built-in SSP
-- view (server/services/dashboardViews.js#resolveDashboardView), never to
-- an error or to no branding at all.
CREATE TABLE IF NOT EXISTS vbu_view_assignments (
  id TEXT PRIMARY KEY,
  vbu TEXT NOT NULL UNIQUE,
  dashboard_view_id TEXT NOT NULL REFERENCES dashboard_views(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

// Columns added to an already-shipped table after its first release. A
// fresh CREATE TABLE IF NOT EXISTS above already includes them for a brand
// new database, but an existing database file (created before these columns
// existed) needs them added explicitly — SQLite has no "ADD COLUMN IF NOT
// EXISTS", so we check PRAGMA table_info first.
const COLUMN_MIGRATIONS = [
  ['microsoft_licenses', [
    ['service_plans_json', "TEXT NOT NULL DEFAULT '[]'"],
    // The SKU's real, per-USER service-plan status (cross-referenced from
    // the user's own assignedPlans at sync time) — distinct from
    // service_plans_json above, which is the tenant-wide SKU CATALOG and
    // is identical for every holder of that SKU regardless of their own
    // disabledPlans. See server/services/microsoft/copilotEntitlement.js.
    ['enabled_service_plans_json', "TEXT NOT NULL DEFAULT '[]'"]
  ]],
  ['microsoft_devices', [
    ['management_agent', 'TEXT'],
    ['device_registration_state', 'TEXT'],
    ['email_address', 'TEXT'],
    ['phone_number', 'TEXT'],
    ['wifi_mac_address', 'TEXT'],
    ['ethernet_mac_address', 'TEXT'],
    ['total_storage_bytes', 'INTEGER'],
    ['free_storage_bytes', 'INTEGER']
  ]],
  ['freshservice_agents', [
    ['manager', 'TEXT']
  ]],
  ['microsoft_users', [
    ['vbu', 'TEXT'],
    ['manager_display_name', 'TEXT'],
    ['manager_upn', 'TEXT'],
    // Raw Graph assignedPlans — the per-USER, already-merged-across-every-
    // SKU view of which service plans are Enabled/Disabled/PendingActivation
    // for this specific person (distinct from subscribedSkus[].servicePlans,
    // the per-SKU tenant CATALOG, which is the same for every holder of
    // that SKU regardless of their own disabledPlans). Needed to determine
    // real per-user Copilot service-plan status — see
    // server/services/microsoft/copilotEntitlement.js.
    ['assigned_plans_json', "TEXT NOT NULL DEFAULT '[]'"]
  ]],
  ['claude_mtd_snapshot_records', [
    ['plan', 'TEXT']
  ]],
  ['role_group_mappings', [
    ['role_id', 'TEXT']
  ]],
  ['dashboard_views', [
    ['allowed_vbus_json', "TEXT NOT NULL DEFAULT '[]'"]
  ]]
]

function applyColumnMigrations() {
  for (const [table, columns] of COLUMN_MIGRATIONS) {
    const existing = new Set(all(`PRAGMA table_info(${table})`).map((c) => c.name))
    for (const [name, type] of columns) {
      if (!existing.has(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }
}

// Tables removed from SCHEMA above after this app already created them on
// an existing database file — CREATE TABLE IF NOT EXISTS never drops a
// table that's no longer declared, so this cleans up what's genuinely
// orphaned (no code references it) rather than leaving stale tables around
// forever. pricing_config was superseded by cost_rules/application_settings
// (see server/services/costEngine.js) before any real pricing data was ever
// stored in it.
const STALE_TABLES = ['pricing_config']

function dropStaleTables() {
  for (const table of STALE_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`)
}

let SQL = null
let db = null

export async function initDb() {
  if (db) return db
  SQL = await initSqlJs({ locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) })
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH))
  } else {
    db = new SQL.Database()
  }
  db.run(SCHEMA)
  applyColumnMigrations()
  dropStaleTables()
  persist()
  console.log('[db] Using SQLite database at', DB_PATH)
  return db
}

// Writes the full in-memory database back to disk. Called after every
// mutation — simple and correct; this app's data volume never makes a
// write-through this expensive.
export function persist() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

// Thin helpers so repositories don't each re-implement sql.js's exec/step
// result-marshalling boilerplate.
export function run(sql, params = []) {
  db.run(sql, params)
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export function get(sql, params = []) {
  const rows = all(sql, params)
  return rows[0] || null
}
