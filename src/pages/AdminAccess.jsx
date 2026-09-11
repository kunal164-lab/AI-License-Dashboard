import React, { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Trash2, Save, X, Pencil, Palette, Download } from 'lucide-react'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import PagesCheckboxGrid from '../components/PagesCheckboxGrid'
import toast from '../utils/toast'

// Microsoft Entra ID SSO configuration (Part 6/7 of the local-admin auth
// spec) — replaces the old one-time setup-token form. The client secret is
// write-only: the server never returns it, only whether one is stored.
function EntraConfigSection() {
  const [config, setConfig] = useState(null)
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [bootstrapAdminGroup, setBootstrapAdminGroup] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function load() {
    const j = await fetch('/api/admin/entra-config').then((r) => r.json())
    setConfig(j)
    setTenantId(j.tenantId || '')
    setClientId(j.clientId || '')
    setBootstrapAdminGroup(j.bootstrapAdminGroup || '')
  }
  useEffect(() => { load() }, [])

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/admin/entra-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, clientId, clientSecret, bootstrapAdminGroup })
      })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'Save failed'); return }
      toast.success('Entra ID configuration saved.')
      setClientSecret('')
      setTestResult(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch('/api/admin/entra-config/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, clientId, clientSecret })
      })
      const j = await r.json().catch(() => ({}))
      setTestResult(j)
    } finally {
      setTesting(false)
    }
  }

  if (!config) return null
  const canTest = tenantId.trim() && clientId.trim() && (clientSecret || config.clientSecretConfigured)
  return (
    <div className="card card-narrow" style={{ marginTop: 16 }}>
      <div className="card-title">Microsoft Entra ID SSO Configuration</div>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 16 }}>
        Configure Microsoft sign-in for this dashboard. The local Administrator account remains available at all times, even if this configuration is incomplete, incorrect, or Microsoft Graph is temporarily unreachable.
      </div>

      <div className="settings-form">
        <div className="settings-row">
          <div className="settings-row-label">Tenant ID</div>
          <div className="settings-row-field">
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Client ID</div>
          <div className="settings-row-field">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Client Secret</div>
          <div className="settings-row-field">
            <input
              type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config.clientSecretConfigured ? 'Client secret configured — leave blank to keep it' : 'Enter client secret'}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Bootstrap Admin Group</div>
          <div className="settings-row-field">
            <input value={bootstrapAdminGroup} onChange={(e) => setBootstrapAdminGroup(e.target.value)} placeholder="e.g. IT Dashboard Admins" />
            <div className="settings-row-help">Members of this Microsoft 365 security group get full admin access once they sign in with Microsoft.</div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Redirect URI</div>
          <div className="settings-row-field">
            <input readOnly value={`${window.location.origin}/auth/microsoft/callback`} />
            <div className="settings-row-help">Add this exact URI to your Entra app registration.</div>
          </div>
        </div>
      </div>

      {testResult && (
        <div className="small" style={{ color: testResult.ok ? 'var(--good)' : 'var(--bad)', marginTop: 14 }}>
          {testResult.ok ? testResult.message : testResult.error}
        </div>
      )}

      <div className="form-actions">
        <button className="button secondary" disabled={testing || !canTest} onClick={test}>
          {testing ? 'Testing...' : 'Test Microsoft Entra Configuration'}
        </button>
        <button className="button primary" disabled={saving || !tenantId.trim() || !clientId.trim()} onClick={save}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  )
}

// Local administrator management (Part 10 of the local-admin auth spec) —
// change password, view/toggle enabled status. Never displays the existing
// password or its hash.
function LocalAdminSection() {
  const [info, setInfo] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  async function load() {
    const j = await fetch('/api/admin/local-admin').then((r) => r.json())
    setInfo(j.localAdmin)
  }
  useEffect(() => { load() }, [])

  async function changePassword() {
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/admin/local-admin/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword })
      })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'Failed to change password'); return }
      toast.success('Administrator password changed.')
      setNewPassword(''); setConfirmPassword('')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled() {
    if (info?.enabled && !confirm('Disable the local Administrator sign-in? Confirm Microsoft Entra ID sign-in works reliably before doing this — the Administrator account is the emergency recovery path.')) return
    setToggling(true)
    try {
      const r = await fetch('/api/admin/local-admin/enabled', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !info.enabled })
      })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'Failed'); return }
      setInfo(j.localAdmin)
      toast.success(j.localAdmin.enabled ? 'Administrator sign-in re-enabled.' : 'Administrator sign-in disabled.')
    } finally {
      setToggling(false)
    }
  }

  if (!info) return null
  const passwordsEnteredMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  return (
    <div className="card card-narrow" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="card-title">Local Administrator Account</div>
        <span className={`status-badge ${info.enabled ? 'good' : 'bad'}`}>Administrator: {info.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div className="muted small" style={{ marginTop: 8, marginBottom: 16 }}>
        Username: <strong>{info.username}</strong>. This account can always sign in to this dashboard as an administrator, independent of Microsoft Entra ID — it is the emergency recovery path.
      </div>

      <div className="settings-form">
        <div className="settings-row">
          <div className="settings-row-label">New Password</div>
          <div className="settings-row-field">
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Confirm New Password</div>
          <div className="settings-row-field">
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            {passwordsEnteredMismatch && <div className="settings-row-help" style={{ color: 'var(--bad)' }}>Passwords do not match.</div>}
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button className="button secondary" disabled={toggling} onClick={toggleEnabled}>
          {toggling ? 'Saving...' : info.enabled ? 'Disable Administrator Sign-In' : 'Re-enable Administrator Sign-In'}
        </button>
        <button className="button primary" disabled={saving || newPassword.length < 10 || newPassword !== confirmPassword} onClick={changePassword}>
          <Save size={14} /> {saving ? 'Saving...' : 'Change Password'}
        </button>
      </div>
    </div>
  )
}

// Shown only when the server reports more than one Microsoft 365 security
// group with the exact same display name (Part 7/8 of the auth spec:
// never silently pick one). The administrator picks the real one; that
// choice is re-submitted with its Graph group id attached.
function GroupPicker({ groups, onPick, onCancel }) {
  return (
    <div style={{ marginTop: 8, padding: 12, border: '1px solid var(--bad)', borderRadius: 8 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Multiple security groups share this name. Select the correct one:</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {groups.map((g) => (
          <button key={g.id} className="button secondary" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => onPick(g)}>
            <div>
              <div style={{ fontWeight: 600 }}>{g.displayName}</div>
              {g.description && <div className="small muted">{g.description}</div>}
              <div className="small muted">{g.id}</div>
            </div>
          </button>
        ))}
      </div>
      <button className="button secondary" style={{ marginTop: 8 }} onClick={onCancel}>Cancel</button>
    </div>
  )
}

// Role creation/editing (Part 3 of the custom-roles spec). A role owns a
// permission set (allowed pages + write access) — a security group never
// gets permissions directly, only through the role it's mapped to. The
// name is fixed once created (not in the editable-fields list the spec
// gives for role editing: description/allowed pages/write access) since
// it's how administrators tell roles apart in the mapping selector — only
// description/pages/write can be changed afterward, on both built-in and
// custom roles alike.
function RoleForm({ pages, initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [canWrite, setCanWrite] = useState(initial?.canWrite ?? false)
  const [allowedPages, setAllowedPages] = useState(new Set(initial?.allowedPages || []))

  function togglePage(key) {
    setAllowedPages((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function setWriteAccess(checked) {
    setCanWrite(checked)
    if (!checked) {
      setAllowedPages((prev) => {
        const next = new Set(prev)
        for (const p of pages) if (p.adminOnly) next.delete(p.key)
        return next
      })
    }
  }

  function submit() {
    onSave({ name, description, canWrite, allowedPages: Array.from(allowedPages) })
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ maxWidth: 640 }}>
        <div className="settings-form">
          <div className="settings-row">
            <div className="settings-row-label">Role Name</div>
            <div className="settings-row-field">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. License Manager" disabled={!!initial} maxLength={60} />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Description</div>
            <div className="settings-row-field">
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Can view and manage licensing information." />
            </div>
          </div>
        </div>

        <label className="checkbox-row" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={canWrite} onChange={(e) => setWriteAccess(e.target.checked)} />
          Allow Write Access
        </label>

        <div className="form-section-title">Allowed Pages</div>
        <PagesCheckboxGrid pages={pages} allowedPages={allowedPages} canWrite={canWrite} onToggle={togglePage} />

        <div className="form-actions">
          <button className="button secondary" onClick={onCancel} disabled={saving}><X size={14} /> Cancel</button>
          <button className="button primary" disabled={saving || !name.trim()} onClick={submit}>
            <Save size={14} /> {saving ? 'Saving...' : (initial ? 'Save Role' : 'Create Role')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Role/Group mapping form — simplified now that a role owns its own
// pages/write (Part 3): this form only ever links a security group to an
// EXISTING role (built-in or custom), never defines permissions itself.
function MappingForm({ roles, initial, onSave, onCancel, saving }) {
  const [securityGroupName, setSecurityGroupName] = useState(initial?.securityGroupName || '')
  const [roleId, setRoleId] = useState(initial?.role || roles[0]?.id || '')
  const [multipleGroups, setMultipleGroups] = useState(null)

  function submit(securityGroupId) {
    onSave({ securityGroupName, securityGroupId, roleId }, (result) => {
      if (result?.multipleGroups) setMultipleGroups(result.multipleGroups)
    })
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="settings-form" style={{ maxWidth: 480 }}>
        <div className="settings-row">
          <div className="settings-row-label">Security Group</div>
          <div className="settings-row-field">
            <input value={securityGroupName} onChange={(e) => setSecurityGroupName(e.target.value)}
              placeholder="e.g. IT Dashboard Admins" disabled={!!initial} />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Role</div>
          <div className="settings-row-field">
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        {multipleGroups && <GroupPicker groups={multipleGroups} onPick={(g) => submit(g.id)} onCancel={() => setMultipleGroups(null)} />}

        <div className="form-actions">
          <button className="button secondary" onClick={onCancel} disabled={saving}><X size={14} /> Cancel</button>
          <button className="button primary" disabled={saving || !securityGroupName.trim() || !roleId} onClick={() => submit(initial?.securityGroupId)}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Presentation-only derivation from the audit log's own event_type string
// (never a separate stored field) — splits "what kind of action" from
// "did it succeed" so the table reads cleanly. Left as null/'—' wherever
// this genuinely can't be determined from the stored event (e.g. an RBAC
// mapping change could have been made by either a local or a
// Microsoft-authenticated admin) rather than guessing.
const AUDIT_EVENT_META = {
  login_success: { action: 'Sign In', provider: 'Microsoft', result: 'success' },
  login_failed: { action: 'Sign In', provider: 'Microsoft', result: 'failed' },
  login_denied: { action: 'Sign In', provider: 'Microsoft', result: 'denied' },
  logout: { action: 'Sign Out', provider: 'Microsoft', result: null },
  local_login_success: { action: 'Sign In', provider: 'Local', result: 'success' },
  local_login_failure: { action: 'Sign In', provider: 'Local', result: 'failed' },
  local_logout: { action: 'Sign Out', provider: 'Local', result: null },
  local_admin_created: { action: 'Administrator Created', provider: 'Local', result: 'success' },
  local_password_changed: { action: 'Password Changed', provider: 'Local', result: 'success' },
  local_admin_enabled: { action: 'Administrator Enabled', provider: 'Local', result: 'success' },
  local_admin_disabled: { action: 'Administrator Disabled', provider: 'Local', result: 'success' },
  access_denied: { action: 'Access Denied', provider: null, result: 'denied' },
  rbac_mapping_created: { action: 'Mapping Created', provider: null, result: 'success' },
  rbac_mapping_updated: { action: 'Mapping Updated', provider: null, result: 'success' },
  rbac_mapping_deleted: { action: 'Mapping Deleted', provider: null, result: 'success' },
  role_created: { action: 'Role Created', provider: null, result: 'success' },
  role_updated: { action: 'Role Updated', provider: null, result: 'success' },
  role_deleted: { action: 'Role Deleted', provider: null, result: 'success' },
  entra_config_changed: { action: 'Entra Config Saved', provider: null, result: 'success' },
  entra_config_tested: { action: 'Entra Config Tested', provider: null, result: null }
}

function describeAuditEvent(e) {
  const meta = AUDIT_EVENT_META[e.event_type] || { action: e.event_type, provider: null, result: null }
  let result = meta.result
  if (e.event_type === 'entra_config_tested') result = e.detail?.ok ? 'success' : 'failed'
  return { action: meta.action, provider: meta.provider, result }
}

function ResultBadge({ result }) {
  if (!result) return <span className="muted small">—</span>
  const cls = result === 'success' ? 'good' : (result === 'failed' || result === 'denied' ? 'bad' : 'neutral')
  const label = result[0].toUpperCase() + result.slice(1)
  return <span className={`status-badge ${cls}`}>{label}</span>
}

// Audit-event retention/range spec — the frontend's own choices are just a
// UI convenience; the backend independently clamps both (server/
// repositories/auditLogRepo.js#queryEvents) regardless of what's requested
// here, so these are never the real security/retention boundary.
const AUDIT_RANGE_OPTIONS = [1, 2, 3, 4]
const AUDIT_LIMIT_OPTIONS = [5, 10, 25, 50, 100]
const AUDIT_TABLE_VISIBLE_ROWS = 5

export default function AdminAccess({ navigate }) {
  const [pages, setPages] = useState([])
  const [roles, setRoles] = useState([])
  const [mappings, setMappings] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [auditRangeDays, setAuditRangeDays] = useState(1)
  const [auditLimit, setAuditLimit] = useState(AUDIT_TABLE_VISIBLE_ROWS)
  const [auditLoading, setAuditLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  const [showRoleForm, setShowRoleForm] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [savingRole, setSavingRole] = useState(false)

  const [showMappingForm, setShowMappingForm] = useState(false)
  const [editingMapping, setEditingMapping] = useState(null)
  const [savingMapping, setSavingMapping] = useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      const [pagesRes, rolesRes, mappingsRes] = await Promise.all([
        fetch('/api/admin/access/pages').then((r) => r.json()),
        fetch('/api/admin/access/roles').then((r) => r.json()),
        fetch('/api/admin/access/mappings').then((r) => r.json())
      ])
      setPages(pagesRes.pages || [])
      setRoles(rolesRes.roles || [])
      setMappings(mappingsRes.mappings || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  // Separate from loadAll above — re-fetches whenever the admin changes the
  // range/count selectors, always going through the backend's own
  // clamping (server/repositories/auditLogRepo.js#queryEvents); this is
  // never filtered/paginated client-side.
  async function loadAuditLog() {
    setAuditLoading(true)
    try {
      const r = await fetch(`/api/admin/access/audit-log?rangeDays=${auditRangeDays}&limit=${auditLimit}`)
      const j = await r.json()
      setAuditLog(j.events || [])
    } finally {
      setAuditLoading(false)
    }
  }
  useEffect(() => { loadAuditLog() }, [auditRangeDays, auditLimit]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportAuditEvents() {
    window.location.href = `/api/admin/access/audit-log/export?rangeDays=${auditRangeDays}&limit=${auditLimit}`
  }

  async function saveRole(form) {
    setSavingRole(true)
    try {
      const isEdit = !!editingRole
      const url = isEdit ? `/api/admin/access/roles/${editingRole.id}` : '/api/admin/access/roles'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'Save failed'); return }
      toast.success(`${j.role.name} saved.`)
      setShowRoleForm(false)
      setEditingRole(null)
      await loadAll()
    } finally {
      setSavingRole(false)
    }
  }

  async function deleteRole(role) {
    if (!confirm(`Delete the "${role.name}" role?`)) return
    const r = await fetch(`/api/admin/access/roles/${role.id}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Delete failed'); return }
    toast.info(`${role.name} role removed.`)
    await loadAll()
  }

  async function saveMapping(form, onAmbiguous) {
    setSavingMapping(true)
    try {
      const isEdit = !!editingMapping
      const url = isEdit ? `/api/admin/access/mappings/${editingMapping.id}` : '/api/admin/access/mappings'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await r.json()
      if (!r.ok) {
        if (r.status === 409 && j.multipleGroups) { onAmbiguous(j); return }
        toast.error(j.error || 'Save failed')
        return
      }
      toast.success(`${form.securityGroupName} saved.`)
      setShowMappingForm(false)
      setEditingMapping(null)
      await loadAll()
    } finally {
      setSavingMapping(false)
    }
  }

  async function deleteMapping(m) {
    if (!confirm(`Remove the mapping for "${m.securityGroupName}"? Members of that group will lose the access it granted.`)) return
    await fetch(`/api/admin/access/mappings/${m.id}`, { method: 'DELETE' })
    toast.info(`${m.securityGroupName} mapping removed.`)
    await loadAll()
  }

  const pageLabelByKey = Object.fromEntries(pages.map((p) => [p.key, p.label]))
  const builtinRoles = roles.filter((r) => r.isBuiltin)
  const customRoles = roles.filter((r) => !r.isBuiltin)

  function RoleRow({ role }) {
    return (
      <tr>
        <td><strong>{role.id}</strong>{role.name !== role.id && <div className="small muted">{role.name}</div>}</td>
        <td className="small muted">{role.description || '—'}</td>
        <td title={role.allowedPages.map((k) => pageLabelByKey[k] || k).join(', ')}>
          {role.allowedPages.length} page{role.allowedPages.length === 1 ? '' : 's'}
        </td>
        <td><span className={`status-badge ${role.canWrite ? 'good' : 'neutral'}`}>{role.canWrite ? 'Write' : 'Read Only'}</span></td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="button secondary" onClick={() => { setEditingRole(role); setShowRoleForm(true); setShowMappingForm(false) }}><Pencil size={14} /> Edit</button>
          {!role.isBuiltin && (
            <button className="danger" style={{ marginLeft: 6 }} onClick={() => deleteRole(role)}><Trash2 size={14} /></button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h3 style={{ margin: 0 }}>Access Management</h3>
          <div className="muted small" style={{ marginTop: 4 }}>
            Roles define permissions. Security-group mappings decide which Microsoft Entra security group receives which role. Membership in an Entra security group is the only source of authorization — nothing here is user-specific.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {navigate && <button className="button secondary" onClick={() => navigate('/admin/dashboard-views')}><Palette size={16} /> Dashboard Views</button>}
          {navigate && <button className="button secondary" onClick={() => navigate('/')}><ArrowLeft size={16} /> Back to Dashboard</button>}
        </div>
      </div>

      {loading ? <div className="muted">Loading...</div> : (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title">Role Management</div>
              {!showRoleForm && (
                <button className="button primary" onClick={() => { setEditingRole(null); setShowRoleForm(true); setShowMappingForm(false) }}>
                  <Plus size={16} /> Add Role
                </button>
              )}
            </div>

            {showRoleForm && (
              <RoleForm pages={pages} initial={editingRole} onSave={saveRole} onCancel={() => { setShowRoleForm(false); setEditingRole(null) }} saving={savingRole} />
            )}

            <div className="table" style={{ marginTop: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead><tr><th>Role</th><th>Description</th><th>Allowed Pages</th><th>Write Access</th><th></th></tr></thead>
                <tbody>
                  {builtinRoles.map((role) => <RoleRow key={role.id} role={role} />)}
                  {customRoles.length > 0 && (
                    <tr><td colSpan={5} className="small muted" style={{ paddingTop: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>Custom Roles</td></tr>
                  )}
                  {customRoles.map((role) => <RoleRow key={role.id} role={role} />)}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title">Role / Group Mappings</div>
              {!showMappingForm && (
                <button className="button primary" onClick={() => { setEditingMapping(null); setShowMappingForm(true); setShowRoleForm(false) }}>
                  <Plus size={16} /> Add Mapping
                </button>
              )}
            </div>

            {showMappingForm && (
              <MappingForm roles={roles} initial={editingMapping} onSave={saveMapping} onCancel={() => { setShowMappingForm(false); setEditingMapping(null) }} saving={savingMapping} />
            )}

            {mappings.length === 0 ? (
              <div className="muted small" style={{ marginTop: 10 }}>No role/group mappings configured yet — no one can access this dashboard until at least one is added, unless the bootstrap admin group (server configuration) applies.</div>
            ) : (
              <div className="table" style={{ marginTop: 10, overflowX: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead><tr><th>Security Group</th><th>Role</th><th>Allowed Pages</th><th>Write Access</th><th></th></tr></thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id}>
                        <td>{m.securityGroupName}</td>
                        <td>{m.role}</td>
                        <td title={m.allowedPages.map((k) => pageLabelByKey[k] || k).join(', ')}>
                          {m.allowedPages.length} page{m.allowedPages.length === 1 ? '' : 's'}
                        </td>
                        <td><span className={`status-badge ${m.canWrite ? 'good' : 'neutral'}`}>{m.canWrite ? 'Write' : 'Read Only'}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="button secondary" onClick={() => { setEditingMapping(m); setShowMappingForm(true); setShowRoleForm(false) }}>Edit</button>
                          <button className="danger" style={{ marginLeft: 6 }} onClick={() => deleteMapping(m)}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <EntraConfigSection />
          <LocalAdminSection />

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <div className="section-header-text">
                <div className="card-title">Recent Authentication/Authorization Events</div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  Kept for a maximum of {AUDIT_RANGE_OPTIONS[AUDIT_RANGE_OPTIONS.length - 1]} days — older events are automatically removed.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Range
                  <select value={auditRangeDays} onChange={(e) => setAuditRangeDays(Number(e.target.value))}>
                    {AUDIT_RANGE_OPTIONS.map((d) => <option key={d} value={d}>Last {d} day{d === 1 ? '' : 's'}</option>)}
                  </select>
                </label>
                <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Count
                  <select value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value))}>
                    {AUDIT_LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button className="button secondary" onClick={exportAuditEvents}>
                  <Download size={14} /> Export Events
                </button>
              </div>
            </div>
            <div className="table" style={{ marginTop: 12, overflowX: 'auto', overflowY: 'auto', maxHeight: 46 + AUDIT_TABLE_VISIBLE_ROWS * 41 }}>
              <table style={{ width: '100%' }}>
                <thead><tr><th>Timestamp</th><th>Authentication</th><th>Action</th><th>Result</th><th>User</th><th>Details</th></tr></thead>
                <tbody>
                  {auditLoading ? (
                    <tr><td colSpan={6} className="muted small">Loading...</td></tr>
                  ) : auditLog.length === 0 ? (
                    <tr><td colSpan={6} className="muted small">No events in the selected range.</td></tr>
                  ) : auditLog.map((e) => {
                    const meta = describeAuditEvent(e)
                    return (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatRelativeTime(e.at)}</td>
                        <td>{meta.provider || <span className="muted small">—</span>}</td>
                        <td>{meta.action}</td>
                        <td><ResultBadge result={meta.result} /></td>
                        <td>{e.actor_upn || <span className="muted small">N/A</span>}</td>
                        <td className="small muted">{Object.keys(e.detail || {}).length ? JSON.stringify(e.detail) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
