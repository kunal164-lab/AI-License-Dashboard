import React from 'react'
import { Inbox } from 'lucide-react'

export default function EmptyState({ title = 'No data available', hint, icon }) {
  const Icon = icon || Inbox
  return (
    <div className="empty-state">
      <Icon size={28} className="empty-state-icon" />
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  )
}
