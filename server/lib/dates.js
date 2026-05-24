// Date helpers shared by routes/services. Intentionally minimal — add only
// when callsites duplicate the same shape across 3+ files.

/**
 * Today as ISO date (YYYY-MM-DD). Used for migration tags, report keys,
 * KPI snapshots — anywhere we need a date-only stamp without timezone games.
 * Truncates the UTC ISO timestamp; for user-facing labels prefer the locale-
 * aware helpers in src/utils/format.js instead.
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
