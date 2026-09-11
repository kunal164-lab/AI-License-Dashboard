// Wraps the raw /api/microsoft/users/:id and /api/microsoft/applications/:name
// responses with the generic header fields (title/generatedAt/scope/...) the
// existing report engine's reportHeader() already knows how to render, so
// the PDF/Excel/CSV builders in src/reports/ don't need a second header
// implementation.
export function buildUserReportModel(detail) {
  const p = detail.user
  return {
    title: `Microsoft 365 User — ${p.display_name || p.upn || 'Unknown'}`,
    generatedAt: new Date().toISOString(),
    dataLastUpdated: p.synced_at || null,
    scope: 'single-user',
    recordCount: 1,
    sources: [{ label: 'Microsoft 365' }],
    filtersApplied: [],
    profile: p,
    licenses: detail.licenses || [],
    devices: detail.devices || [],
    applications: detail.applications || [],
    applicationsError: detail.applicationsError || null,
    copilot: detail.copilot || null,
    signIns: detail.signIns || []
  }
}

export function buildApplicationReportModel(detail) {
  const s = detail.summary
  return {
    title: `Microsoft 365 Application — ${s.displayName}`,
    generatedAt: new Date().toISOString(),
    dataLastUpdated: s.lastSyncedAt || null,
    scope: 'single-application',
    recordCount: s.totalDeviceCount || 0,
    sources: [{ label: 'Microsoft 365' }],
    filtersApplied: [],
    summary: s,
    versions: detail.versions || [],
    devices: detail.devices || [],
    linkageCoverage: detail.linkageCoverage || null
  }
}
