import React from 'react'
import { Users2 } from 'lucide-react'
import { useCostJson } from './useCostJson'

// Cost by Group (Part 15) — Microsoft Graph groups are synced, but without
// membership data there is no real way to attribute license cost to a
// group's members, so this is an honest empty state rather than an invented
// one. See server/services/costAnalytics.js#groupsAvailability.
export default function CostByGroup() {
  const { data, loading } = useCostJson('/api/cost/groups')
  if (loading) return <div className="muted">Loading group cost data...</div>
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <Users2 size={40} style={{ color: '#c3cbd9', marginBottom: 12 }} />
      <h3>Group cost analysis is unavailable</h3>
      <p className="muted">{data?.message || 'No group membership data is currently connected.'}</p>
      {data?.groupCount > 0 && (
        <p className="small muted">{data.groupCount} Microsoft 365 group(s) are synced, but without membership data there is no way to attribute license cost to them.</p>
      )}
    </div>
  )
}
