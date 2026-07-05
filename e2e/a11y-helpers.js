import AxeBuilder from '@axe-core/playwright'

/**
 * Serious rules that are widespread and blocked on work that is out of the
 * current change's scope, so they are reported as warnings instead of gating
 * the build. Keep this list SHORT and documented — the whole point of widening
 * the gate to `serious` is to catch regressions like `nested-interactive`, so
 * only park rules here when fixing them needs a dedicated, cross-cutting pass.
 *
 *   color-contrast            — pervasive across the brand gradients / slate
 *                               muted-text tokens shared by Header, Badge,
 *                               Dashboard, WorkBoard, Settings, etc. Needs a
 *                               dedicated design pass to retune the tokens; it
 *                               is not fixable inside a single component.
 *   scrollable-region-focusable — Safari-only keyboard-scroll heuristic firing
 *                               on a shared scroll container; niche and outside
 *                               this change's surface.
 */
const DEFERRED_SERIOUS_RULES = ['color-contrast', 'scrollable-region-focusable']

/**
 * Run axe against the current page and fail on critical + serious violations.
 *
 * Gate policy (v4.x): `critical` AND `serious` = hard fail (blocks the build),
 * EXCEPT the rules in {@link DEFERRED_SERIOUS_RULES}, which are reported as
 * warnings. `moderate`/`minor` are always warnings.
 *
 * The gate was widened from critical-only to critical+serious once the known
 * `nested-interactive` offenders were fixed at the source (RepoCard / PR rows /
 * Issue rows — role="button" wrappers around inner controls replaced with the
 * stretched-control pattern: real sibling buttons layered with z-index). The
 * gate now catches any regression of that shape.
 *
 * `allowlist` disables specific axe rules entirely (e.g., known false positives
 * in third-party widgets). Use sparingly with a comment explaining why.
 *
 * `warnOnly` scans and logs every violation (including gated critical/serious)
 * but never throws. Use it for a view whose only remaining gated violations
 * live in components outside the current change's scope (e.g. the Work Board's
 * own cards still trip `nested-interactive`), so the view is still monitored
 * ("scan-and-warn") without turning the shared gate red. Prefer fixing the
 * source and removing the flag.
 */
export async function checkA11y(page, { allowlist = [], tag = 'WCAG 2.1 AA', warnOnly = false } = {}) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .disableRules(allowlist)
    .analyze()

  const isGated = (v) =>
    ['critical', 'serious'].includes(v.impact) && !DEFERRED_SERIOUS_RULES.includes(v.id)

  const blocking = results.violations.filter(isGated)
  const warnings = results.violations.filter((v) => !isGated(v))

  if (warnings.length > 0) {
    const summary = warnings
      .map((v) => `  ${(v.impact ?? 'n/a').padEnd(8)} ${v.id} (${v.nodes.length} node(s))`)
      .join('\n')

    console.warn(`[a11y] non-blocking violations (${tag}):\n${summary}`)
  }

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `  ${v.impact.padEnd(8)} ${v.id}: ${v.description}\n    ${v.nodes.length} node(s) affected\n    -> ${v.helpUrl}`
      )
      .join('\n')

    if (warnOnly) {
      console.warn(`[a11y] scan-and-warn — gated violations NOT blocking on this view (${tag}):\n${summary}`)
    } else {
      throw new Error(`A11y critical/serious violations detected (${tag}):\n${summary}`)
    }
  }

  return results
}
