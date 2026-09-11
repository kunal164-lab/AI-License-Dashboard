import React from 'react'
import { CircleCheck, CircleAlert, CircleX, Circle, RefreshCw } from 'lucide-react'

const STYLES = {
  // Usage Status labels. 'Heavily Active' is the current label ('Highly
  // Active' kept mapped too — see src/utils/activityScore.js — purely
  // defensive in case any stale cached/exported data still has the old
  // string; activityStatusFor itself never produces it anymore). 'No Usage'
  // is the current label for zero recorded usage; it is deliberately a
  // DIFFERENT string from License Status's own 'Inactive' (see
  // src/utils/licenseStatus.js) — the two are unrelated concepts and must
  // never share a display word.
  'Heavily Active': { cls: 'badge-active', Icon: CircleCheck },
  'Highly Active': { cls: 'badge-active', Icon: CircleCheck },
  'Active': { cls: 'badge-active', Icon: CircleCheck },
  'Low Activity': { cls: 'badge-low', Icon: CircleAlert },
  'No Usage': { cls: 'badge-unused', Icon: CircleX },
  // A product with no usage dataset at all (e.g. Freshservice — see
  // src/utils/activityScore.js#activityStatusFor) — deliberately neutral,
  // never styled like 'No Usage'/'Inactive' (an absent metric is not the
  // same claim as "measured and found unused").
  'Not Tracked': { cls: 'badge-neutral', Icon: Circle },
  // License Status label — a revoked/unassigned license, unrelated to usage.
  'Inactive': { cls: 'badge-unused', Icon: CircleX },
  'Unused': { cls: 'badge-unused', Icon: CircleX },
  'Connected': { cls: 'badge-active', Icon: CircleCheck },
  'Syncing': { cls: 'badge-syncing', Icon: RefreshCw },
  'Needs attention': { cls: 'badge-unused', Icon: CircleX },
  'Pending': { cls: 'badge-low', Icon: CircleAlert },
  'Not Connected': { cls: 'badge-neutral', Icon: Circle },
  'Stopped': { cls: 'badge-neutral', Icon: Circle },
  'Disconnected': { cls: 'badge-neutral', Icon: Circle }
}

export default function StatusBadge({ status, spin }) {
  const entry = STYLES[status] || { cls: 'badge-neutral', Icon: Circle }
  const Icon = entry.Icon
  return (
    <span className={`status-badge ${entry.cls}`}>
      <Icon size={12} className={spin ? 'spin' : ''} />
      {status || 'Unknown'}
    </span>
  )
}
