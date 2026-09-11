// Mirrors server/services/claude/scheduler.js's established pattern
// (the only other real server-side scheduler in this app): a single
// setInterval per process, checked periodically rather than sleeping for a
// literal 24 hours, so a restarted server still catches up quickly. FX
// due-ness/cooldown itself lives in fxService.js#refreshRates (real DB-
// backed state via settingsRepo, not in-memory), so this loop can simply
// call it every tick and trust it to no-op when nothing needs doing.
//
// Unlike Claude's scheduler (which only acts on already-configured, opted-
// in connections), FX rates are needed by every multi-currency cost
// calculation from the moment the app starts, so this also fires once
// immediately at startup rather than waiting up to a full TICK_MS for the
// first attempt.
import { refreshRates } from './fxService.js'

const TICK_MS = 15 * 60 * 1000

let started = false
let running = false

async function tick() {
  if (running) return // a slow refresh from the previous tick is still in flight — never overlap
  running = true
  try {
    await refreshRates()
  } catch (e) {
    // refreshRates already records its own failure internally; this catch
    // only guards the scheduler loop itself from ever dying.
    console.error('[fx-scheduler] unexpected error refreshing FX rates:', e.message)
  } finally {
    running = false
  }
}

export function startFxScheduler() {
  if (started) return
  started = true
  console.log(`[fx-scheduler] started — checking every ${TICK_MS / 60000} minutes for a due FX rate refresh`)
  tick().catch((e) => console.error('[fx-scheduler] initial tick failed:', e.message))
  setInterval(() => { tick().catch((e) => console.error('[fx-scheduler] tick failed:', e.message)) }, TICK_MS)
}
