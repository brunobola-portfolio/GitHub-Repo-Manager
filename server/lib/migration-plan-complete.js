/**
 * Post-completion side effects for a migration plan's `plan-complete` event.
 *
 * Kept as a pure, dependency-injected function (no `db.js` import) so it can be
 * unit-tested against an in-memory credential manager without opening the real
 * database. `server/routes/migration.js` wires it onto the engine event.
 */

/**
 * Handle a `plan-complete` event. Runs ONLY for a terminal `status === 'completed'`:
 *   1. apply provenance tagging marks (best-effort; failure is logged, never thrown)
 *   2. forget (clear) the encrypted credentials — defense-in-depth so a stored
 *      PAT/token doesn't linger up to 48h waiting for the periodic purge
 *
 * `forget` is chained in `.finally()` so it always runs even when tagging
 * fails, and only after tagging has awaited its own credential reads — so it
 * can never race the credential resolver. `forget()` is idempotent.
 *
 * @param {{ planId: number|string, status: string }} event
 * @param {{
 *   taggingService: { applyTaggingForPlan: (planId) => Promise<any> },
 *   credentials: { forget: (planId) => void },
 *   logger: { error: Function }
 * }} deps
 * @returns {Promise<void>} resolves once tagging + forget have settled.
 */
export function handlePlanComplete({ planId, status }, { taggingService, credentials, logger }) {
  if (status !== 'completed') return Promise.resolve();
  return taggingService.applyTaggingForPlan(planId)
    .catch(err => logger.error({ err, planId }, 'tagging service failed for plan'))
    .finally(() => {
      try {
        credentials.forget(planId);
      } catch (err) {
        logger.error({ err, planId }, 'failed to forget credentials after plan-complete');
      }
    });
}
