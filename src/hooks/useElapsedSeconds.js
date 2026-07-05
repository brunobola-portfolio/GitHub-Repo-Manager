import { useEffect, useState } from 'react'
import { parseServerTimestamp } from '../utils/format'

/**
 * Live elapsed-seconds counter since `startedAt`. Ticks every second while
 * `active` is true so running tasks show a moving timer instead of a stale
 * value frozen at the last re-render. Returns null when there's no start
 * timestamp so callers can hide the badge entirely.
 *
 * @param {string|number|Date|null} startedAt - ISO string, Date, or epoch ms.
 * @param {boolean} active - keep ticking while true; stops on false (e.g. when
 *   the task transitions to completed/failed) so the displayed duration locks
 *   to the final value.
 * @returns {number|null}
 */
export function useElapsedSeconds(startedAt, active = true) {
  // parseServerTimestamp treats naive-UTC server timestamps as UTC; without it
  // the live elapsed timer (Date.now() - startMs) is off by the viewer's offset.
  const startDate = parseServerTimestamp(startedAt)
  const startMs = startDate ? startDate.getTime() : null
  const valid = startMs != null && Number.isFinite(startMs)

  const compute = () => (valid ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : null)
  const [seconds, setSeconds] = useState(compute)

  useEffect(() => {
    // Always resync once when inputs change — covers the case where the
    // task finishes between renders and we want a final accurate value.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing a clock to the current wall time when its inputs change is exactly the sync-with-external-system pattern this rule excludes; the interval below is the steady-state subscription.
    setSeconds(compute())
    if (!valid || !active) return undefined
    const id = setInterval(() => setSeconds(compute()), 1000)
    return () => clearInterval(id)
    // compute is intentionally not in deps — it closes over startMs which IS
    // in deps (via startedAt), and re-creating it each render would reset the
    // interval every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, active])

  return seconds
}
