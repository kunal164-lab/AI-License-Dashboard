// Shared by Microsoft365.jsx and Applications.jsx — the ONE place that
// groups raw microsoft_applications rows into "an application." Intune's
// detectedApps API stores one row per (name, version) combination, not one
// row per app, so "Google Chrome" genuinely appears as dozens of rows
// (one per version) that must be summed together to answer "how many
// installs does Google Chrome have."
//
// device_count here is the SUM of each version's own Graph-reported
// device_count — this is real, Graph-provided data, but it's an
// installation-count proxy, not a guaranteed-unique device count (the same
// physical device running two versions of the same app would be counted
// twice). That's the same convention this app has used since Microsoft 365
// Applications shipped; the true unique-device count for one specific
// application is available on demand via getApplicationDetail's
// uniqueLinkedDeviceCount, which this function does not attempt to
// replicate for every application at once (that would require live Graph
// calls per app - not something the main inventory list should ever do).
export function groupApplicationsByName(applications) {
  const map = new Map()
  for (const a of applications || []) {
    if (!map.has(a.display_name)) map.set(a.display_name, { display_name: a.display_name, publisher: a.publisher, platform: a.platform, device_count: 0, version_count: 0, last_synced_at: null })
    const g = map.get(a.display_name)
    g.device_count += (a.device_count || 0)
    g.version_count += 1
    if (!g.publisher && a.publisher) g.publisher = a.publisher
    if (!g.platform && a.platform) g.platform = a.platform
    if (a.synced_at && (!g.last_synced_at || a.synced_at > g.last_synced_at)) g.last_synced_at = a.synced_at
  }
  return Array.from(map.values()).sort((a, b) => b.device_count - a.device_count || String(a.display_name).localeCompare(String(b.display_name)))
}
