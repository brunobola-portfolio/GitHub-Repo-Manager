/**
 * Pure decision for the Free-tier "1 full migration / month" meter.
 *
 * Keeping this side-effect-free (no db / no req) makes the gating rule trivial
 * to unit-test and impossible to get subtly wrong in the middleware wiring.
 *
 * @param {object}  o
 * @param {boolean} o.isDryRun      plan.is_dry_run — dry-runs are always free + unmetered
 * @param {boolean} o.isPro         caller tier >= pro — unlimited full migrations
 * @param {boolean} o.quotaCharged  plan.quota_charged — already consumed a unit (resume/retry)
 * @param {number}  o.currentCount  full migrations already executed this period
 * @param {number}  o.cap           migrationFullPerMonth for the caller's tier
 * @returns {'allow'|'charge'|'deny'}
 *   'allow'  → proceed, do NOT charge
 *   'charge' → proceed AND consume one monthly unit
 *   'deny'   → block (403, quota exhausted)
 */
export function migrationQuotaDecision({ isDryRun, isPro, quotaCharged, currentCount, cap }) {
  if (isDryRun || isPro) return 'allow'
  if (quotaCharged) return 'allow'
  if (currentCount < cap) return 'charge'
  return 'deny'
}
