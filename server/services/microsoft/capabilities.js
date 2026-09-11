// Single source of truth for what "Microsoft 365" can sync. Every capability
// declares its own Graph endpoint(s) and required permission(s) explicitly —
// nothing is synced just because a checkbox exists, and nothing requests a
// permission it doesn't actually need (least-privilege, per capability).
//
// `implemented: false` capabilities are intentionally left as declared-but-
// not-wired-up: their endpoint/permission mapping is documented so the UI
// and future work can build on it, but sync.js will not attempt them yet.
// This keeps the registry honest — a capability only claims to "sync" if it
// really does.
//
// Order here is also the order shown in the connect-form checkboxes.
export const MICROSOFT_CAPABILITIES = {
  copilot: {
    key: 'copilot',
    label: 'Microsoft 365 Copilot',
    description: 'Per-user Microsoft 365 Copilot usage (Teams, Word, Excel, PowerPoint, Outlook, OneNote, Loop, Copilot Chat). Feeds the existing AI License & Usage dashboard.',
    endpoints: ['GET /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period=\'{period}\')'],
    permissions: ['Reports.Read.All'],
    implemented: true
  },
  users: {
    key: 'users',
    label: 'Users & Directory',
    description: 'Entra ID user directory: name, UPN/email, department, job title, office, company, account status, usage location, assigned licenses.',
    endpoints: ['GET /users'],
    permissions: ['User.Read.All'],
    implemented: true
  },
  departments: {
    key: 'departments',
    label: 'Departments & Organization',
    description: 'Derived from synced Users & Directory data (grouped by the department field) — no separate Graph call and no dedicated table.',
    endpoints: [],
    permissions: ['User.Read.All'],
    dependsOn: ['users'],
    implemented: true
  },
  applications: {
    key: 'applications',
    label: 'Installed Applications',
    description: 'Intune-detected applications on managed devices, with per-device linkage (which devices have each app). This is option (A) in the spec’s A/B/C distinction: Intune-detected apps — NOT Microsoft Teams app installs (B) and NOT Microsoft 365 app-usage reports (C), which are different Graph APIs and are not implemented here.',
    endpoints: [
      'GET /deviceManagement/detectedApps',
      'GET /deviceManagement/detectedApps/{id}/managedDevices'
    ],
    permissions: ['DeviceManagementManagedDevices.Read.All'],
    implemented: true
  },
  intune_devices: {
    key: 'intune_devices',
    label: 'Intune Device Management',
    description: 'Intune-managed device inventory: OS, compliance/management state, ownership, enrollment/last-sync dates, manufacturer/model/serial, storage, network MAC addresses, linked primary user. Detected Apps are covered separately by "Installed Applications" below.',
    endpoints: ['GET /deviceManagement/managedDevices'],
    permissions: ['DeviceManagementManagedDevices.Read.All'],
    implemented: true
  },
  groups: {
    key: 'groups',
    label: 'Groups & Teams',
    description: 'Microsoft 365/Entra ID groups, with Teams identified on the same row (a group that also has a Team provisioned is flagged, not duplicated). Read-only — no create/delete/membership-change of any kind. Membership sync is not implemented (see docs).',
    endpoints: ['GET /groups'],
    permissions: ['Group.Read.All'],
    implemented: true
  },
  licenses: {
    key: 'licenses',
    label: 'Microsoft 365 Licenses',
    description: 'Tenant subscribed SKUs (from /subscribedSkus) cross-referenced with each synced user’s assignedLicenses to show who holds which license. Reflects assignment, not active usage.',
    endpoints: ['GET /subscribedSkus', 'GET /users (assignedLicenses, selected during the Users sync)'],
    permissions: ['Organization.Read.All', 'User.Read.All'],
    dependsOn: ['users'],
    implemented: true
  },
  signins: {
    key: 'signins',
    label: 'Sign-in / Activity Data',
    description: 'Entra ID sign-in logs, time-windowed (default last 30 days, configurable) and synced incrementally after the first run — never an unbounded historical download.',
    endpoints: ['GET /auditLogs/signIns'],
    permissions: ['AuditLog.Read.All'],
    implemented: true
  }
}

export const CAPABILITY_ORDER = Object.keys(MICROSOFT_CAPABILITIES)

export function isImplemented(key) {
  return !!MICROSOFT_CAPABILITIES[key]?.implemented
}

export function requiredPermissionsFor(key) {
  return MICROSOFT_CAPABILITIES[key]?.permissions || []
}
