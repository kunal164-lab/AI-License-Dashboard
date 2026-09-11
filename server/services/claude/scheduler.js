// The ONLY real backend scheduler in this app today (verified during
// implementation: every other "schedule" — Freshservice's scheduleMinutes
// included — is actually enforced by a client-side setInterval in
// src/App.jsx, which only ticks while a browser tab has the dashboard
// open; the server itself never initiates anything on its own). Part 3/18
// of the spec this implements explicitly requires the Claude automatic
// source to keep running after the frontend is closed, so this is new,
// genuinely server-side infrastructure — started once, unconditionally, at
// process boot (see server/index.js), independent of any browser.
//
// Deliberately simple (Part 18: "keep MVP/simple"): a single setInterval
// per server process, checking due-ness periodically rather than sleeping
// for a literal 24 hours — this means a server restarted partway through
// the day still picks up a due sync within one tick, and the schedule
// survives a restart because `scheduleMinutes`/`lastSync` are real DB
// state, not in-memory. If this app is ever deployed across MULTIPLE
// backend instances, each instance would run its own independent copy of
// this loop and could double-run a sync at the same moment — there is no
// distributed lock here. That is a known, accepted limitation for the
// current single-instance deployment model, not something this file tries
// to solve.
import * as connectionsRepo from '../../repositories/connectionsRepo.js'
import { runClaudeSync, isDue } from './sync.js'

const TICK_MS = 15 * 60 * 1000 // check due-ness every 15 minutes; actual sync only fires once/day per isDue()

let started = false
let running = false

async function tick() {
  if (running) return // a slow sync from the previous tick is still in flight — never overlap
  running = true
  try {
    const claudeConnections = connectionsRepo.listConnections('Claude').filter((c) => c.kind === 'api')
    for (const conn of claudeConnections) {
      if (conn.meta.enabled === false) continue
      if (!isDue(conn)) continue
      try {
        await runClaudeSync(conn, { respectSchedule: true })
      } catch (e) {
        // runClaudeSync already handles/records its own errors internally;
        // this catch only guards the scheduler loop itself from ever dying.
        console.error('[claude-scheduler] unexpected error running Claude sync:', e.message)
      }
    }
  } finally {
    running = false
  }
}

// Guarded so a hot-reload or accidental double-import within the same
// process can't start two overlapping intervals.
export function startClaudeScheduler() {
  if (started) return
  started = true
  console.log(`[claude-scheduler] started — checking every ${TICK_MS / 60000} minutes for a due Claude MTD refresh`)
  setInterval(() => { tick().catch((e) => console.error('[claude-scheduler] tick failed:', e.message)) }, TICK_MS)
}
