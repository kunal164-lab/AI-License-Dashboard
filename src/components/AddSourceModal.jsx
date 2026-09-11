import React from 'react'
import { X, Upload, Plug, Settings } from 'lucide-react'

const SOURCES = [
  { key: 'claude', name: 'Claude', connection: 'OneDrive/SharePoint (auto) / CSV', action: 'Manage Claude Source', Icon: Settings },
  { key: 'github', name: 'GitHub Copilot', connection: 'OAuth', action: 'Connect GitHub', Icon: Plug },
  { key: 'kiro', name: 'Kiro', connection: 'API / CSV', action: 'Configure Kiro', Icon: Settings },
  { key: 'microsoft', name: 'Microsoft 365', connection: 'Microsoft Graph', action: 'Connect Microsoft 365', Icon: Plug },
  { key: 'freshservice', name: 'Freshservice', connection: 'Microsoft 365 Security Group / Manual CSV Upload', action: 'Connect Freshservice', Icon: Settings },
  { key: 'other', name: 'Other CSV/XLSX', connection: 'Manual file import', action: 'Import File', Icon: Upload }
]

export default function AddSourceModal({ onClose, onSelect }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel-header">
          <h4 style={{ margin: 0 }}>Add Data Source</h4>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-panel-body">
          {SOURCES.map((s) => (
            <div key={s.key} className="source-option">
              <div>
                <div className="source-option-name">{s.name}</div>
                <div className="muted small">Connection: {s.connection}</div>
              </div>
              <button className="button primary" onClick={() => onSelect(s.key)}>
                <s.Icon size={16} />
                {s.action}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
