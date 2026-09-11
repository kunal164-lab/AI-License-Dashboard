import React, { useEffect, useState } from 'react'
import { ArrowLeft, ShieldCheck, Plus, Trash2, Save, X, Pencil, Eye } from 'lucide-react'
import PagesCheckboxGrid from '../components/PagesCheckboxGrid'
import AppLogo from '../components/AppLogo'
import { LOGO_KEYS, THEME_TOKEN_KEYS } from '../utils/dashboardViewAssets'
import toast from '../utils/toast'

const THEME_TOKEN_LABELS = {
  accent: 'Accent',
  accentDark: 'Accent (dark)',
  sidebarGradientStart: 'Sidebar gradient start',
  sidebarGradientEnd: 'Sidebar gradient end',
  sidebarActive: 'Sidebar active item',
  sidebarActiveBg: 'Sidebar active item (background)',
  sidebarActiveText: 'Sidebar active item (text)',
  headerAccent: 'Header accent',
  contentBackgroundWash: 'Background wash',
  sidebarLogoWidth: 'Sidebar logo width',
  sidebarDecorationColor: 'Sidebar decoration color',
  headerDecorationColor: 'Header decoration color',
  sidebarWidth: 'Sidebar width',
  headerMinHeight: 'Header min height',
  headerBackground: 'Header background',
  contentBackground: 'Main content background',
  contentBorderColor: 'Content border color'
}

// Tokens whose value is a CSS length/gradient string, not a color — these
// get a plain text field in the editor (and are left out of the color-chip
// previews below) rather than a broken <input type="color">.
const NON_COLOR_THEME_KEYS = ['sidebarLogoWidth', 'sidebarWidth', 'headerMinHeight', 'headerBackground']

// Create/edit form for one Dashboard View. Mirrors AdminAccess.jsx's
// RoleForm exactly (inline card, not a modal) — a view owns display
// configuration (logo/theme/visible pages), never permissions; RBAC still
// decides what a page grants (server/services/dashboardViews.js#
// effectivePages), so there is no "Write Access" concept here.
function ViewForm({ pages, vbus, initial, onSave, onCancel, saving }) {
  const [displayName, setDisplayName] = useState(initial?.displayName || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [logoKey, setLogoKey] = useState(initial?.logoKey || 'ssp')
  const [theme, setTheme] = useState(initial?.theme || {})
  const [allowedPages, setAllowedPages] = useState(new Set(initial?.pages || []))
  const [allowedVbuIds, setAllowedVbuIds] = useState(new Set(initial?.allowedVbuIds || []))

  function togglePage(key) {
    setAllowedPages((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleVbu(vbu) {
    setAllowedVbuIds((prev) => {
      const next = new Set(prev)
      if (next.has(vbu)) next.delete(vbu); else next.add(vbu)
      return next
    })
  }

  function setToken(key, value) {
    setTheme((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    onSave({ displayName, description, logoKey, theme, pages: Array.from(allowedPages), allowedVbuIds: Array.from(allowedVbuIds) })
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ maxWidth: 640 }}>
        <div className="settings-form">
          <div className="settings-row">
            <div className="settings-row-label">Display Name</div>
            <div className="settings-row-field">
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. SSP Worldwide" maxLength={60} />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Description</div>
            <div className="settings-row-field">
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. The SSP Worldwide dashboard experience." />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Logo</div>
            <div className="settings-row-field">
              <select value={logoKey} onChange={(e) => setLogoKey(e.target.value)}>
                {LOGO_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <div className="settings-row-help">Logo assets are centrally managed (src/utils/dashboardViewAssets.js) — an administrator picks which registered logo this view uses, never a raw file path.</div>
            </div>
          </div>
        </div>

        <div className="form-section-title">Theme (optional overrides)</div>
        <div className="settings-form">
          {THEME_TOKEN_KEYS.map((key) => (
            <div className="settings-row" key={key}>
              <div className="settings-row-label">{THEME_TOKEN_LABELS[key] || key}</div>
              <div className="settings-row-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {NON_COLOR_THEME_KEYS.includes(key) ? (
                  <input
                    type="text"
                    value={theme[key] || ''}
                    placeholder="e.g. 268px"
                    onChange={(e) => setToken(key, e.target.value)}
                    style={{ maxWidth: 280 }}
                  />
                ) : (
                  <input
                    type="color"
                    value={theme[key] || '#0b5fff'}
                    onChange={(e) => setToken(key, e.target.value)}
                    style={{ width: 40, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                )}
                <button type="button" className="button secondary" onClick={() => setTheme((prev) => { const next = { ...prev }; delete next[key]; return next })}>
                  Use default
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="form-section-title">VBU Data</div>
        <div className="settings-row-help" style={{ marginBottom: 8 }}>
          Which VBU(s) this Dashboard View belongs to — this is the ONE place that controls both (1) which VBU's users automatically land on this view after signing in, and (2) which VBU's business data this view can show. Leave everything unchecked to defer to each viewer's own VBU with no view routing (today's default behavior). A VBU can only ever belong to one Dashboard View at a time — if it's already checked on another view, remove it there first.
        </div>
        {vbus.length === 0 ? (
          <div className="muted small" style={{ marginBottom: 12 }}>No VBU values found yet in the synced Microsoft 365 directory.</div>
        ) : (
          <div className="checkbox-grid" style={{ marginBottom: 12 }}>
            {vbus.map((vbu) => (
              <label key={vbu} className="checkbox-row">
                <input type="checkbox" checked={allowedVbuIds.has(vbu)} onChange={() => toggleVbu(vbu)} />
                {vbu}
              </label>
            ))}
          </div>
        )}

        <div className="form-section-title">Visible Pages</div>
        <PagesCheckboxGrid pages={pages} allowedPages={allowedPages} onToggle={togglePage} />

        <div className="form-actions">
          <button className="button secondary" onClick={onCancel} disabled={saving}><X size={14} /> Cancel</button>
          <button className="button primary" disabled={saving || !displayName.trim()} onClick={submit}>
            <Save size={14} /> {saving ? 'Saving...' : (initial ? 'Save View' : 'Create View')}
          </button>
        </div>
      </div>
    </div>
  )
}

// A static, config-only mock of the view's shell — logo, theme swatches,
// visible page list. NEVER an API call, NEVER a data fetch, NEVER renders
// as any other user (Part 12 of the spec: "Preview must not grant the
// administrator or browser additional data access... do not implement
// preview by pretending the administrator is another user"). Everything
// shown here comes straight from the `view` object already loaded by
// loadAll() below — there is nothing for this to bypass.
function ViewPreview({ view, pageLabelByKey }) {
  return (
    <div className="card" style={{ marginTop: 12, background: 'var(--bg)' }}>
      <div className="card-title">Preview — {view.displayName}</div>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 12 }}>
        Visual configuration only. This does not fetch or display any real user data.
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ background: 'linear-gradient(180deg, var(--navy-900) 0%, var(--navy-800) 100%)', borderRadius: 10, padding: 16, width: 200 }}>
          <AppLogo logoKey={view.logoKey} style={{ width: 64 }} />
          <div style={{ color: '#9fb3c8', fontSize: 11, marginTop: 8, marginBottom: 10 }}>{view.displayName}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {view.pages.slice(0, 6).map((key) => (
              <div key={key} style={{ color: '#e6f2ff', fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
                {pageLabelByKey[key] || key}
              </div>
            ))}
            {view.pages.length > 6 && <div style={{ color: '#7e93aa', fontSize: 11 }}>+{view.pages.length - 6} more</div>}
          </div>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Theme</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {THEME_TOKEN_KEYS.filter((key) => !NON_COLOR_THEME_KEYS.includes(key)).map((key) => (
              <div key={key} style={{ textAlign: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: view.theme?.[key] || 'var(--border)', border: '1px solid var(--border)' }} />
                <div className="small muted" style={{ fontSize: 10, maxWidth: 60 }}>{THEME_TOKEN_LABELS[key]}</div>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 12 }}>{view.pages.length} visible page{view.pages.length === 1 ? '' : 's'} · {view.isActive ? 'Active' : 'Inactive'}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            VBU Data: {view.allowedVbuIds && view.allowedVbuIds.length ? view.allowedVbuIds.join(', ') : "each viewer's own VBU (not yet restricted)"}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboardViews({ navigate }) {
  const [pages, setPages] = useState([])
  const [views, setViews] = useState([])
  const [vbus, setVbus] = useState([])
  const [loading, setLoading] = useState(true)

  const [showViewForm, setShowViewForm] = useState(false)
  const [editingView, setEditingView] = useState(null)
  const [savingView, setSavingView] = useState(false)
  const [previewViewId, setPreviewViewId] = useState(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [pagesRes, viewsRes, vbusRes] = await Promise.all([
        fetch('/api/admin/access/pages').then((r) => r.json()),
        fetch('/api/admin/dashboard-views').then((r) => r.json()),
        fetch('/api/admin/dashboard-views/vbus').then((r) => r.json())
      ])
      setPages(pagesRes.pages || [])
      setViews(viewsRes.views || [])
      setVbus(vbusRes.vbus || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  async function saveView(form) {
    setSavingView(true)
    try {
      const isEdit = !!editingView
      const url = isEdit ? `/api/admin/dashboard-views/${editingView.id}` : '/api/admin/dashboard-views'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'Save failed'); return }
      toast.success(`${j.view.displayName} saved.`)
      setShowViewForm(false)
      setEditingView(null)
      await loadAll()
    } finally {
      setSavingView(false)
    }
  }

  async function deleteView(view) {
    if (!confirm(`Delete the "${view.displayName}" dashboard view?`)) return
    const r = await fetch(`/api/admin/dashboard-views/${view.id}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Delete failed'); return }
    toast.info(`${view.displayName} view removed.`)
    await loadAll()
  }

  const pageLabelByKey = Object.fromEntries(pages.map((p) => [p.key, p.label]))

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h3 style={{ margin: 0 }}>Dashboard Views</h3>
          <div className="muted small" style={{ marginTop: 4 }}>
            Configure the branded dashboard experiences (logo, theme, visible pages) and which VBU receives which one. RBAC still decides what a page actually grants — a view can only hide pages, never grant access RBAC does not already allow.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {navigate && <button className="button secondary" onClick={() => navigate('/admin/access')}><ShieldCheck size={16} /> Access Management</button>}
          {navigate && <button className="button secondary" onClick={() => navigate('/')}><ArrowLeft size={16} /> Back to Dashboard</button>}
        </div>
      </div>

      {loading ? <div className="muted">Loading...</div> : (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title">Dashboard Views</div>
              {!showViewForm && (
                <button className="button primary" onClick={() => { setEditingView(null); setShowViewForm(true) }}>
                  <Plus size={16} /> Add View
                </button>
              )}
            </div>

            {showViewForm && (
              <ViewForm pages={pages} vbus={vbus} initial={editingView} onSave={saveView} onCancel={() => { setShowViewForm(false); setEditingView(null) }} saving={savingView} />
            )}

            <div className="table" style={{ marginTop: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead><tr><th>Name</th><th>Description</th><th>Logo</th><th>Theme</th><th>VBU Data</th><th>Visible Pages</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {views.map((view) => (
                    <tr key={view.id}>
                      <td><strong>{view.displayName}</strong>{view.isBuiltin && <div className="small muted">Built-in</div>}</td>
                      <td className="small muted">{view.description || '—'}</td>
                      <td><AppLogo logoKey={view.logoKey} style={{ width: 32 }} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {THEME_TOKEN_KEYS.filter((k) => view.theme?.[k] && !NON_COLOR_THEME_KEYS.includes(k)).map((k) => (
                            <span key={k} title={THEME_TOKEN_LABELS[k]} style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block', background: view.theme[k], border: '1px solid var(--border)' }} />
                          ))}
                          {!Object.keys(view.theme || {}).length && <span className="small muted">Default</span>}
                        </div>
                      </td>
                      <td className="small muted" title={(view.allowedVbuIds || []).join(', ')}>
                        {view.allowedVbuIds && view.allowedVbuIds.length ? `${view.allowedVbuIds.length} VBU${view.allowedVbuIds.length === 1 ? '' : 's'}` : "Viewer's own VBU"}
                      </td>
                      <td title={view.pages.map((k) => pageLabelByKey[k] || k).join(', ')}>{view.pages.length} page{view.pages.length === 1 ? '' : 's'}</td>
                      <td><span className={`status-badge ${view.isActive ? 'good' : 'neutral'}`}>{view.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="button secondary" onClick={() => setPreviewViewId(previewViewId === view.id ? null : view.id)}><Eye size={14} /> Preview</button>
                        <button className="button secondary" style={{ marginLeft: 6 }} onClick={() => { setEditingView(view); setShowViewForm(true) }}><Pencil size={14} /> Edit</button>
                        {!view.isBuiltin && (
                          <button className="danger" style={{ marginLeft: 6 }} onClick={() => deleteView(view)}><Trash2 size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {previewViewId && views.find((v) => v.id === previewViewId) && (
              <ViewPreview view={views.find((v) => v.id === previewViewId)} pageLabelByKey={pageLabelByKey} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
