import React, { useState } from 'react'
import { FileDown } from 'lucide-react'
import CostOverview from './cost/CostOverview'
import CostDimensionView from './cost/CostDimensionView'
import CostByVbu from './cost/CostByVbu'
import CostByUser from './cost/CostByUser'
import CostByGroup from './cost/CostByGroup'
import CostByPlan from './cost/CostByPlan'
import CostSavings from './cost/CostSavings'
import CostSettings from './cost/CostSettings'
import { buildCostReportModel } from '../reports/reportBuilder'

const VIEWS = [
  { key: 'overview', label: 'Cost Overview' },
  { key: 'product', label: 'By Product' },
  { key: 'department', label: 'By Department' },
  { key: 'vbu', label: 'By VBU' },
  { key: 'domain', label: 'By Domain' },
  { key: 'user', label: 'By User' },
  { key: 'group', label: 'By Group' },
  { key: 'plan', label: 'By License / Plan' },
  { key: 'savings', label: 'Potential Savings' },
  { key: 'settings', label: 'Cost Settings' }
]

// Cost is now a full Cost Analytics & Management area (audit/management
// focused — see the spec this implements): one view selector switches
// between the analytics perspectives below, all reading the SAME
// server-side Cost Analytics engine (server/services/costAnalytics.js,
// itself built on the existing centralized costEngine.js), plus the
// existing pricing-configuration UI kept intact as its own "Cost Settings"
// view (Part 28: analytics and administration are deliberately separated).
//
// `data`/`allData`/`globalFilters`/`setFilter`/`onOpenReport` are the SAME
// props Optimization/Users/Products already receive from App.jsx — Cost's
// "Generate Report" reuses the exact existing report pipeline
// (buildCostReportModel + the ReportModal already wired in App.jsx), never
// a second reporting engine, and drilling into a product/department/VBU
// here also writes to the shared global filter state so the report (and
// any cross-page navigation) reflects exactly what's on screen.
export default function Cost({ navigate, currency, onCurrencyChange, setFilter, clearFilter, onOpenReport }) {
  const [view, setView] = useState('overview')
  // Per-dimension "last selected" drill-down, kept here (not inside each
  // view) so switching views and coming back preserves context (Part 27:
  // Cost -> By Department -> Internal IT -> Claude should not lose "Internal
  // IT" when you go look at Claude's own product view and come back).
  const [selection, setSelection] = useState({ product: null, department: null, vbu: null, domain: null })

  // Missing Pricing → Configure Cost workflow (Part 37): jump into Cost
  // Settings and scroll to its existing Missing Pricing table, where each
  // row already has its own "Configure Cost" button (unchanged) — no new
  // prefill plumbing needed, just getting the admin to the right place.
  function openMissingPricing() {
    setView('settings')
    setTimeout(() => document.getElementById('missing-pricing')?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  function selectDimension(dim, name) {
    setSelection((prev) => ({ ...prev, [dim]: name }))
    // product/department/vbu are real fields on every record elsewhere in
    // the app (Users/Products/Optimization) — syncing them into the shared
    // global filter means a report generated from here, or a navigation to
    // another page, reflects this exact drill-down. Domain has no
    // equivalent field on those pages' records, so it stays local to Cost.
    // A falsy `name` means "cleared" (e.g. Cost by VBU's own Clear Filters
    // or its "back" action) — must actually clear the global filter, never
    // set it to a literal null value.
    if (dim === 'domain' || !setFilter) return
    if (name) setFilter(dim, { type: 'category', values: [name] })
    else if (clearFilter) clearFilter(dim)
  }

  function goTo(dim, name) {
    setView(dim)
    selectDimension(dim, name)
  }

  function handleGenerateReport() {
    onOpenReport({
      title: 'Cost & License Audit Report',
      buildModel: buildCostReportModel,
      filePrefix: 'Internal_IT_Cost_Report'
    })
  }

  return (
    <div>
      <div className="section-header">
        <div className="section-header-text">
          <h3 style={{ margin: 0 }}>Cost</h3>
          <div className="muted small" style={{ marginTop: 4, maxWidth: 700 }}>
            License cost, utilization and potential savings across every provider — built for management and audit reporting.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={view} onChange={(e) => setView(e.target.value)} style={{ width: 200 }} aria-label="Cost view">
            {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
          {onOpenReport && view !== 'settings' && (
            <button className="button secondary" onClick={handleGenerateReport}><FileDown size={16} /> Generate Report</button>
          )}
        </div>
      </div>

      {view === 'overview' && (
        <CostOverview
          currency={currency}
          onOpenProduct={(name) => goTo('product', name)}
          onOpenDepartment={(name) => goTo('department', name)}
          onOpenVbu={(name) => goTo('vbu', name)}
          onOpenMissingPricing={openMissingPricing}
        />
      )}

      {view === 'product' && (
        <CostDimensionView
          apiBase="/api/cost/products"
          nameLabel="Product"
          currency={currency}
          selected={selection.product}
          onSelectedChange={(name) => selectDimension('product', name)}
          extraListColumns={[{ key: 'provider', label: 'Provider' }]}
          onOpenUser={(id) => goTo('user', id)}
          buildBreakdowns={(detail) => [
            { key: 'byPlan', label: 'Plans', items: detail.byPlan, nameLabel: 'Plan', chart: true },
            { key: 'byDepartment', label: 'Department Distribution', items: detail.byDepartment, nameLabel: 'Department', chart: true, onSelect: (name) => goTo('department', name) },
            { key: 'byVbu', label: 'VBU Distribution', items: detail.byVbu, nameLabel: 'VBU', onSelect: (name) => goTo('vbu', name) },
            { key: 'byDomain', label: 'Domain Distribution', items: detail.byDomain, nameLabel: 'Domain', onSelect: (name) => goTo('domain', name) }
          ]}
        />
      )}

      {view === 'department' && (
        <CostDimensionView
          apiBase="/api/cost/departments"
          nameLabel="Department"
          currency={currency}
          selected={selection.department}
          onSelectedChange={(name) => selectDimension('department', name)}
          onOpenUser={(id) => goTo('user', id)}
          buildBreakdowns={(detail) => [
            { key: 'byProduct', label: 'Cost by Product', items: detail.byProduct, nameLabel: 'Product', chart: true, onSelect: (name) => goTo('product', name) },
            { key: 'byProvider', label: 'Cost by Provider', items: detail.byProvider, nameLabel: 'Provider' },
            { key: 'byPlan', label: 'Cost by Plan', items: detail.byPlan, nameLabel: 'Plan' }
          ]}
        />
      )}

      {view === 'vbu' && (
        <CostByVbu
          currency={currency}
          selectedVbu={selection.vbu}
          onSelectedVbuChange={(name) => selectDimension('vbu', name)}
        />
      )}

      {view === 'domain' && (
        <CostDimensionView
          apiBase="/api/cost/domains"
          nameLabel="Domain"
          currency={currency}
          selected={selection.domain}
          onSelectedChange={(name) => selectDimension('domain', name)}
          onOpenUser={(id) => goTo('user', id)}
          buildBreakdowns={(detail) => [
            { key: 'byProduct', label: 'Cost by Product', items: detail.byProduct, nameLabel: 'Product', chart: true, onSelect: (name) => goTo('product', name) },
            { key: 'byProvider', label: 'Cost by Provider', items: detail.byProvider, nameLabel: 'Provider' },
            { key: 'byPlan', label: 'Cost by Plan', items: detail.byPlan, nameLabel: 'Plan' }
          ]}
        />
      )}

      {view === 'user' && <CostByUser currency={currency} />}
      {view === 'group' && <CostByGroup />}
      {view === 'plan' && <CostByPlan currency={currency} />}
      {view === 'savings' && (
        <CostSavings currency={currency} onGoToOptimization={() => navigate && navigate('/optimization')} />
      )}
      {view === 'settings' && (
        <CostSettings currency={currency} onCurrencyChange={onCurrencyChange} />
      )}
    </div>
  )
}
