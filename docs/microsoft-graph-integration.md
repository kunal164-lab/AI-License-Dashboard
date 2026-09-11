# Microsoft 365 / Microsoft Graph Integration

Microsoft 365 is a data source (`source: 'microsoft'` in the shared `connections`
table, same as Claude/GitHub Copilot/Kiro) that can synchronize several
independent Microsoft Graph **capabilities** into the central SQLite
database. It is not a single-purpose "Microsoft Copilot connector" — Copilot
is one capability among several. This is a **read-only** integration: no
capability creates, deletes, modifies, or actions anything in Microsoft 365
(no license assignment, no device wipe/retire/reboot, no group/Teams
membership changes).

## 1. Connection architecture

A Microsoft 365 connection is a normal row in the existing generic
`connections` table (`kind: 'api'`, `source: 'microsoft'`) — there is no
separate `microsoft_connections` table. Its `meta_json` column stores:

```json
{ "tenantId": "...", "period": "D7", "signInsDays": 30, "capabilities": ["copilot", "users", "intune_devices"] }
```

`credentials_enc` stores the AES-256-GCM-encrypted `{ tenantId, clientId,
clientSecret }` using the app's existing `server/crypto.js`. Credentials are
never sent to the frontend (`connectionsRepo.toSafeView` strips them) and
never touch `localStorage`.

Auth is Azure AD app-registration, client-credentials flow (app-only, no
user sign-in) — unchanged from the original Copilot-only implementation.

## 2. Capability registry

`server/services/microsoft/capabilities.js` is the single source of truth
for what can be synced. Each capability declares its own Graph endpoint(s)
and required permission(s) explicitly — nothing is requested or synced
just because a checkbox exists.

| Capability | Label | Endpoint(s) | Permission(s) | Status |
|---|---|---|---|---|
| `copilot` | Microsoft 365 Copilot | `GET /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='{period}')` | `Reports.Read.All` | Implemented |
| `users` | Users & Directory | `GET /users` (now also `$select`s `assignedPlans` — the per-user, per-service-plan Enabled/Disabled status, used for Copilot entitlement detection below) | `User.Read.All` | Implemented |
| `departments` | Departments & Organization | *(derived — no Graph call)* | `User.Read.All` (via users) | Implemented |
| `applications` | Installed Applications | `GET /deviceManagement/detectedApps`, `GET /deviceManagement/detectedApps/{id}/managedDevices` | `DeviceManagementManagedDevices.Read.All` | Implemented |
| `intune_devices` | Intune Device Management | `GET /deviceManagement/managedDevices` | `DeviceManagementManagedDevices.Read.All` | Implemented |
| `groups` | Groups & Teams | `GET /groups` | `Group.Read.All` | Implemented (no membership) |
| `licenses` | Microsoft 365 Licenses | `GET /subscribedSkus` (+ `assignedLicenses`/`assignedPlans` from the Users sync) | `Organization.Read.All`, `User.Read.All` | Implemented |
| `signins` | Sign-in / Activity Data | `GET /auditLogs/signIns` | `AuditLog.Read.All` | Implemented |

All 8 capabilities are implemented. Every one is synced independently by
`sync.js` — one capability failing (missing permission, throttled, or a
genuine error) never blocks or fails the others.

**Least-privilege verification (2026-09-10):** Microsoft documents
`LicenseAssignment.Read.All` as the least-privileged Application permission
for `/subscribedSkus`. This app does not request it, and doesn't need to —
`/subscribedSkus` and `assignedLicenses`/`assignedPlans` (both read via
`/users`) already succeed live under the broader `Organization.Read.All` +
`User.Read.All` this app already has consented, which is a superset of what
`LicenseAssignment.Read.All` would cover. No new permission was requested or
is required for the Copilot entitlement work below; no write permission
(`LicenseAssignment.ReadWrite.All` or otherwise) is used anywhere in this
integration.

### Microsoft 365 Copilot entitlement (Premium) — what Graph can and cannot tell you

Investigated live against this project's real connected tenant
(`server/services/microsoft/copilotEntitlement.js` has the full write-up).
`/subscribedSkus` lists **two** distinct Copilot SKUs
(`Microsoft_365_Copilot`, `MICROSOFT_365_COPILOT_DEPT`), but a live
comparison of real holders of each showed their `assignedPlans` are
**identical** — every one of the ten Copilot service plans reports
`capabilityStatus: "Enabled"` for both. Graph's service-plan data therefore
cannot, on its own, distinguish a Basic/Premium/Chat split.

**Business rule (confirmed 2026-09-10):** the business has directly
confirmed every Microsoft Copilot license currently in use in this tenant —
every SKU `isCopilotSku` recognizes, `Microsoft_365_Copilot` and
`MICROSOFT_365_COPILOT_DEPT` alike — is a Copilot **Premium** plan. This is
a business classification applied on top of real SKU recognition, not
something re-derived from Graph service-plan data; a future genuinely
different (e.g. Basic/Chat-tier) SKU would need this rule updated in
`copilotEntitlement.js` explicitly, not inferred automatically.

### Verified against a real tenant (this project's live test connection)

As of this pass: `copilot` (366 records), `users` (2,105), `departments`
(44, derived), `applications` (4,920 detected apps), `intune_devices` (397
managed devices), and `licenses` (1,814 assignments) all sync successfully
with real data. `groups` and `signins` correctly return real, distinct 403s
(`Authorization_RequestDenied` / `Authentication_MSGraphPermissionMissing`)
pending `Group.Read.All` / `AuditLog.Read.All` admin consent — this is
expected, not a bug (see §9).

## 3. "Devices" and "Intune Device Management" — consolidated, not duplicated

An earlier pass had a separate placeholder `intune_devices` capability
described as "future compliance-policy reporting," distinct from a
`devices` capability that already implemented `/deviceManagement/
managedDevices`. This pass's spec re-described "Intune Device Management"
as exactly that same endpoint with an expanded field list — running both
under two different keys would have synced the identical Graph data twice
(double the API calls, double the throttling risk, for no benefit). They
were consolidated into one capability, `intune_devices`, using the existing
working implementation as the base and expanding its field set. Connections
that still carry the old `devices` key in their stored `meta.capabilities`
are remapped to `intune_devices` automatically at sync time (`sync.js`) —
nothing is silently dropped.

## 4. Installed Applications — the A/B/C distinction

Microsoft Graph has (at least) three different "installed application"
concepts. This integration implements **only (A)**:

- **(A) Intune-detected applications** (implemented here) —
  `GET /deviceManagement/detectedApps` (catalog, with a real `deviceCount`
  field) and `GET /deviceManagement/detectedApps/{id}/managedDevices` (which
  devices have it). This is what "installed application" means everywhere
  in this integration's data.
- **(B) Microsoft Teams installed apps** (`GET /users/{id}/teamwork/installedApps`)
  — a completely different, per-user Teams-app-catalog API. Not implemented.
- **(C) Microsoft 365 application usage reports**
  (`GET /reports/getMicrosoft365AppUserDetail`) — usage of Word/Excel/etc.
  themselves, not a list of installed software. Not implemented.

Mixing these would misrepresent what a row in `microsoft_applications` means,
so only (A) is stored, and this distinction is documented in
`server/services/microsoft/applications.js` directly above the fetch
function.

Per-app device linkage is bounded by `MAX_DEVICE_LINKAGE_CALLS = 200` in
`applications.js` (Graph has no single bulk "app → devices" collection, so
this is one extra request per app) — if a tenant has more detected apps than
that, linkage sync stops there and `truncated: true` is reported back rather
than silently dropped. If Graph throttles persistently during that loop, it
stops immediately (rather than hammering through the remaining apps) and
reports `throttledStop: true` — the app catalog itself (already fetched in
one call) is still stored in full.

## 5. Groups & Teams

`GET /groups` with `$select` including `resourceProvisioningOptions`. A
group that also has a Microsoft Team provisioned on it shows
`"Team"` in that array — so a group's own row is flagged `is_team = 1`
directly, with **no separate Teams endpoint call and no second table**. A
Team is a Microsoft 365 group with an extra capability turned on, not a
distinct entity, so representing it that way avoids duplicating the same
group as two records.

**Membership sync is not implemented.** Even a group-centric `/groups/{id}/
members` call (rather than a per-user call) is still one extra Graph
request per group — for a tenant with hundreds of groups, added on top of
five other capabilities already syncing in the same pass, that materially
raises throttling risk for comparatively low reporting value at this MVP
stage. The schema is ready for it (a future `microsoft_group_members` join
table mirroring `microsoft_device_applications`) but it's deliberately left
as future work rather than half-built now, per the spec's own "only if it
can be called efficiently" guidance.

## 6. Sign-in / Activity Data

`GET /auditLogs/signIns` with `$filter=createdDateTime ge {iso}` — **never**
called without a time floor. Two safeguards bound the pull:

- **Configurable period, hard-capped**: `meta.signInsDays` (default 30,
  admin-configurable per connection via the Configure UI or `PATCH
  /api/connections/:id`), clamped to a maximum of 90 days
  (`signins.js`'s `MAX_DAYS`) regardless of what's configured.
- **Incremental after the first sync**: `resolveSinceIso()` uses
  `MAX(created_at)` already stored for the connection (via
  `microsoftRepo.latestSignInTimestamp`) as the filter floor instead of the
  full period, so Refresh All does not re-download the same history every
  time — it only fetches what's new since the last successful sync. If the
  configured period is shortened, the period floor still takes precedence
  over an older stored timestamp, so shortening it takes effect.

`status` is derived from Graph's `status.errorCode` (`0` → `"success"`,
anything else → `"failure"`) rather than stored as the raw status object;
`failure_reason`/`failure_error_code` preserve the detail. `risk_level`
stores Graph's `riskLevelAggregated` specifically (not
`riskLevelDuringSignIn`, a separate field Graph also exposes) — noted here
since the product spec's generic "riskLevel" doesn't disambiguate between
the two.

## 7. Data returned per capability, and what's honestly unavailable

- **Copilot**: per-user last-activity dates for Teams/Word/Excel/PowerPoint/
  Outlook/OneNote/Loop/Copilot Chat, report refresh date/period. Feeds the
  *existing* AI License & Usage dashboard unchanged (`src/utils/microsoftNormalizer.js`).
  No real spend/cost field exists in this report — cost stays `null`
  everywhere, never fabricated.
- **Users & Directory**: id, displayName, givenName, surname,
  userPrincipalName, mail, accountEnabled, department, jobTitle,
  officeLocation, companyName, employeeId, usageLocation, assignedLicenses.
  `manager` is **not** fetched — Graph's `$expand=manager` support on the
  *list* endpoint (vs. a single user) is inconsistent enough that guessing
  at it risked silent partial data; a per-user `/users/{id}/manager` call
  can be added later if needed.
- **Intune Device Management**: id, deviceName, userId/userPrincipalName,
  operatingSystem, osVersion, complianceState, managementState,
  managedDeviceOwnerType ("ownership"), managementAgent, enrolledDateTime,
  lastSyncDateTime, deviceRegistrationState, manufacturer, model,
  serialNumber, azureADDeviceId, emailAddress, phoneNumber,
  wiFiMacAddress, ethernetMacAddress, totalStorageSpaceInBytes,
  freeStorageSpaceInBytes. `approximateLastSignInDateTime` was requested
  but **removed** — live testing against a real tenant returned Graph v1.0
  400 `"Could not find a property named 'approximateLastSignInDateTime' on
  type 'microsoft.graph.managedDevice'"` (an invalid field in `$select`
  fails the *entire* request, not just that field). It is not a real v1.0
  property; no substitute field was requested in its place. Field
  availability otherwise varies by tenant/Intune config/platform; anything
  omitted is stored as `null`, never invented.
- **Applications**: id, displayName, version, publisher, platform,
  deviceCount, plus the device-linkage join table.
- **Groups & Teams**: id, displayName, description, mail, mailNickname,
  groupTypes, securityEnabled, mailEnabled, visibility, createdDateTime,
  is_team (derived). No membership (see §5).
- **Sign-ins**: see §6's field list — all optional fields default to
  `null` when Graph omits them, never fabricated.
- **Licenses**: tenant SKU catalog (`skuId` → `skuPartNumber`) cross-
  referenced against each user's `assignedLicenses`. This reflects
  **assignment**, not active usage — deliberately not confused with Copilot
  usage data.
- **Departments**: derived by grouping already-synced users on their real
  `department` field. No department is ever invented; ungrouped users show
  as `"Unknown"`.

## 8. SQLite schema

All new tables (`server/db/index.js`) are scoped by `connection_id` and
keyed by the stable Microsoft Graph object id (`ms_id`/`graph_signin_id`)
via a `UNIQUE(connection_id, ...)` constraint, upserted with `INSERT OR
REPLACE` on every sync so repeated syncs never duplicate rows:

- `microsoft_sync_runs` — one row per capability per sync attempt (status,
  record count, error) — powers the per-capability status the UI shows.
- `microsoft_users`, `microsoft_devices`, `microsoft_applications`,
  `microsoft_device_applications` (join table), `microsoft_licenses`,
  `microsoft_groups`, `microsoft_sign_ins`.

**Migrations**: `microsoft_devices` shipped before this pass's expanded
field set — `db/index.js`'s `applyColumnMigrations()` runs
`ALTER TABLE ... ADD COLUMN` (checked against `PRAGMA table_info` first, so
it's safe to run on every boot) for the columns added in this pass
(`management_agent`, `device_registration_state`, `email_address`,
`phone_number`, `wifi_mac_address`, `ethernet_mac_address`,
`total_storage_bytes`, `free_storage_bytes`) so an already-deployed database
picks them up without losing any existing rows. Brand-new databases get
them for free from the `CREATE TABLE` statement itself.

**Deliberately not created** (see the schema comment in `db/index.js` for
the same reasoning inline):

- `microsoft_connections` — the existing generic `connections` table already
  covers this; a parallel table would just duplicate that row.
- `microsoft_capabilities` — fixed application metadata, not per-tenant
  data; lives as the code registry in `capabilities.js` instead (matching
  the spec's own suggested `MICROSOFT_CAPABILITIES = {...}` structure).
- `microsoft_departments` — derived on demand from `microsoft_users`
  (group-by), not separately stored.
- `microsoft_copilot_usage` — Copilot records continue to flow through the
  existing generic `usage_records` table so the already-working AI License
  & Usage dashboard (Users/Overview/Optimization) keeps working unchanged;
  a separate table would fork that data into two places.
- `microsoft_teams` — see §5; a Team is flagged on its group's own row.

## 9. Service layer

```
server/services/microsoft/
  capabilities.js  - the registry described above
  auth.js          - client-credentials token acquisition
  graphClient.js   - shared HTTP layer: pagination (@odata.nextLink),
                     429 retry/backoff, capability-aware error messages
  copilot.js       - usage-detail / user-count-summary / user-count-trend
  users.js         - GET /users
  departments.js   - pure aggregation over synced users
  devices.js       - GET /deviceManagement/managedDevices (backs "intune_devices")
  applications.js  - GET /deviceManagement/detectedApps (+ device links)
  groups.js        - GET /groups
  signins.js       - GET /auditLogs/signIns, incremental $filter resolution
  licenses.js      - GET /subscribedSkus
  sync.js          - orchestrator: runs every enabled capability
                     independently, records a microsoft_sync_runs row per
                     attempt
```

`server/repositories/microsoftRepo.js` holds all SQL for the new tables
(upserts, listers, `latestSyncStatus`, `latestSignInTimestamp`,
`deleteAllForConnection`).

## 10. Sync process

`server/index.js`'s `runMicrosoftSync(conn)` (a dedicated branch off the
shared `runSync`, since Microsoft's multi-capability result shape doesn't
fit the single-record-set model every other provider uses):

1. Acquire one access token for the connection.
2. Run every *enabled* capability independently, in dependency order
   (`departments`/`licenses` run after `users` so they can use its output).
3. Each capability's failure is caught independently — one capability
   failing (permission missing, throttled, or a genuine error) never stops
   the others. Upserts only ever run on a capability's success path, so a
   failed/throttled attempt leaves whatever data a previous successful sync
   already stored completely untouched — nothing is deleted on failure.
4. The connection's overall `status` is `connected` if at least one
   *meaningful* (real Graph-backed) capability succeeded — a purely derived
   capability like `departments` succeeding on its own does not count, so
   the connection doesn't look "healthy" while every real Graph call is
   failing.
5. A `microsoft_sync_runs` row is written per capability per attempt, with
   status one of `success`, `permission_missing`, `throttled`, or `error`;
   the existing generic `sync_history` table also gets one row for the
   whole connection-level attempt (unchanged behavior other providers
   already use).

### Refresh All Sources

`POST /api/sources/refresh-all` already loops every `kind: 'api'`
connection (CSV sources skipped, unchanged). For a Microsoft 365
connection, each result now also carries `capabilityResults` — one entry
per capability with `ok`/`count`/`error` — so the caller can show
per-capability outcomes, not just one pass/fail per connection. A single
throttled or permission-denied capability (e.g. Groups & Teams) never
fails Refresh All as a whole, and never blocks the other capabilities on
the same connection from running.

### Sync status API

`GET /api/connections` (and `?source=microsoft`) enriches each Microsoft
connection with:
- `capabilities`: the enabled capability keys.
- `capabilityStatus`: each enabled capability merged with its latest
  `microsoft_sync_runs` row into one of: `not_implemented`, `ready`
  (enabled, never synced yet), `synced` (last sync succeeded with >0
  records), `no_data` (last sync succeeded, 0 rows returned),
  `permission_missing`, `throttled`, `error` — `{ key, label, implemented,
  requiredPermissions, status, lastAttemptedAt, recordCount, error }`.
  `"synced"` is only ever shown after a real successful
  `microsoft_sync_runs` row exists — never assumed from the capability
  simply being enabled.

`PATCH /api/connections/:id` lets the "Configure" UI change enabled
capabilities, the Copilot period, the sign-in activity period
(`signInsDays`), or the label — without recreating the connection or
touching its credentials.

## 11. Error handling

`graphClient.js` maps every Graph response into one message. A 403 is
**never** blindly translated to "permission missing" — Microsoft's own
`error.code`/`error.message` from the response body is parsed and surfaced
directly, with the capability's normally-required permission included only
as context:

| Status | Message |
|---|---|
| 401 | "Microsoft authentication/token is invalid or expired." |
| 403 | "`<Capability>` Microsoft Graph denied this request with 403 (`<Graph error code>`): `<Graph error message>`. This capability normally requires: `<permissions>` — verify that permission is an Application permission (not Delegated) with admin consent granted to THIS exact app registration." |
| 404 | "Microsoft Graph endpoint or resource not found. (...)" |
| 429 | Retried with exponential backoff (see §12); after retries are exhausted, throws a distinguishable *throttled* error rather than a generic one |
| 5xx | "Microsoft Graph service error." |
| 400 | "Microsoft Graph error (400): `<Graph error message>`" — this is exactly how the `approximateLastSignInDateTime` field bug (§7) was caught: a real, specific Graph message, not a generic failure |
| network failure | "Network failure while calling Microsoft Graph: ..." |

Secrets (client secret, access token, Authorization header) are never
logged or included in any error message — only the Graph error body, which
never contains caller credentials. `graphClient.js`'s only `console.log`
call is the throttling retry line, which logs a delay and attempt count —
nothing else.

## 12. Pagination and throttling

`graphClient.graphGetAllPages` follows `@odata.nextLink` until Graph stops
returning one — no endpoint assumes a single page contains the full
collection.

`fetchWithRetry` retries a `429` up to `MAX_RETRIES = 4` times:
- **`Retry-After` present**: waited exactly (capped at `MAX_RETRY_DELAY_SEC
  = 30` so a pathological header value can't stall a sync for minutes).
- **`Retry-After` absent**: exponential backoff — `2^attempt` seconds
  (1s, 2s, 4s, 8s), also capped at 30s. Never immediate.
- **Retries exhausted**: throws an `Error` with `.throttled = true` instead
  of a generic one, so `sync.js` records `microsoft_sync_runs.status =
  'throttled'` (distinct from `'error'`) and the connection's other
  capabilities are unaffected.

All of this was verified with a mocked-fetch test suite (persistent 429 →
exactly 5 attempts with 1s/2s/4s/8s gaps, not a retry storm;
`Retry-After` honored; an absurd `Retry-After` value capped rather than
honored literally) rather than assumed from reading the code.

Requests are always issued **sequentially**, never in uncontrolled
parallel batches — `applications.js`'s per-app device-linkage loop is a
plain `for` loop with `await` each iteration (see §4 for how it also stops
early on persistent throttling rather than working through the rest of a
large app catalog against a service that just said "back off").

## 13. Two-domain handling

`microsoft_users.domain` is derived from `userPrincipalName`/`mail`
(`email.split('@')[1].toLowerCase()`) at sync time — never assumed to be a
single value. `departments.js`'s `aggregateDomains()` groups by this field.
The Microsoft 365 dashboard page shows a "Domain Comparison" table
whenever more than one domain is present, plus a domain filter dropdown
that also narrows the department chart/table — so Domain A vs. Domain B
(e.g. two different company domains sharing one tenant) is a first-class
view, not an afterthought. Confirmed against real tenant data: at least one
synced device's `email_address` (`jason.roberts@ssp-uki.com`) differs from
its user's UPN domain (`Jason.Roberts@ssp-worldwide.com`) — genuine
multi-domain data, not a hypothetical.

## 14. Dashboard (frontend)

`src/pages/Microsoft365.jsx` — one consolidated page (reached via the
Products page's "Dedicated Product Pages" menu), covering:

- **KPIs**: Users, Active Users, Devices, Compliant Devices,
  Non-Compliant Devices, Applications, Copilot Users, Copilot Active Users,
  Assigned Licenses, Groups, Teams, Sign-ins, Successful/Failed Sign-ins,
  Unique Sign-in Users.
- **Charts**: Users by Domain, Users by Department, Devices by OS, License
  Assignment, Groups by Type, Sign-ins by Day, Sign-ins by Application.
- **Tables**: Users, Devices, Applications, Groups & Teams, Failed Sign-ins
  (with risk fields shown only where Graph actually returns them).

Every KPI/chart/table renders directly from `/api/microsoft/data` — a
capability with no permission yet (e.g. Groups & Teams) simply shows 0 /
an empty-state card, never a fabricated number.

## 15. Future extension model

To add a new capability: add one entry to `MICROSOFT_CAPABILITIES`, a small
fetch function in its own `services/microsoft/<name>.js` file, a branch in
`sync.js`'s `runCapability()`, and (if it needs its own table) a
`CREATE TABLE IF NOT EXISTS` block in `db/index.js` plus upsert/list
functions in `microsoftRepo.js`. Nothing about the connection model, the
UI's capability checkboxes, or the refresh-all/error-handling plumbing
needs to change.

## Known limitations / explicitly future work

- **Group/Team membership** is not synced (see §5) — architecture-ready,
  deliberately deferred.
- **`manager`** is not fetched for users (see §7).
- **Per-app device linkage** is capped at 200 Graph calls per sync and
  stops early on persistent throttling (see §4); truncation is reported,
  not silently dropped.
- **`getMicrosoft365CopilotUserCountSummary`/`...UserCountTrend`** are
  implemented in `copilot.js` but not called by `sync.js` — the user-detail
  report already gives a reliable per-user total/active count, so calling
  the summary endpoint too would duplicate that data; the trend endpoint is
  a genuine future addition (a real time series the snapshot report can't
  provide) once a trend chart is worth building.
- **Copilot "v2" report columns** (prompts submitted, active usage days,
  more granular last-activity fields) are extracted opportunistically by
  `src/utils/microsoftNormalizer.js` if a tenant ever returns them, but v2
  activation itself (Microsoft's exact request contract for it) was not
  implemented — it could not be verified against a live tenant from this
  environment, and shipping a guessed activation mechanism as the default
  would risk silently mis-requesting data.
- **`approximateLastSignInDateTime`** is not a valid Graph v1.0 field on
  `managedDevice` — confirmed via a real 400 against a live tenant (§7);
  removed rather than guessed at further.
- **Intune Device Management** currently covers the managed-device roster
  only — deeper Intune policy/compliance-profile reporting (a distinct
  Graph surface) remains future work if ever needed.

## References

- [Copilot usage report API](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail)
- [User resource / list users](https://learn.microsoft.com/en-us/graph/api/user-list)
- [Intune managedDevice resource](https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice)
- [Intune detectedApp resource](https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-detectedapp)
- [Group resource (resourceProvisioningOptions)](https://learn.microsoft.com/en-us/graph/api/resources/group)
- [List groups](https://learn.microsoft.com/en-us/graph/api/group-list)
- [List sign-ins](https://learn.microsoft.com/en-us/graph/api/signin-list)
- [subscribedSku / list](https://learn.microsoft.com/en-us/graph/api/subscribedsku-list)
- [Microsoft Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)
