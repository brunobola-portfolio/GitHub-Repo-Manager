// Date helpers shared by frontend components/hooks. Intentionally minimal.
//
// For locale-aware formatting (e.g. "May 23, 2026") see src/utils/format.js —
// this file holds date-arithmetic primitives only.

/**
 * Today as ISO date (YYYY-MM-DD). Matches server/lib/dates.js#todayISO so
 * a date stamped on the client and re-stamped on the server compare equal
 * within the same UTC day.
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
