import AxeBuilder from '@axe-core/playwright'

/**
 * Serious rules that are widespread and blocked on work that is out of the
 * current change's scope, so they are reported as warnings instead of gating
 * the build. Keep this list SHORT and documented — the whole point of widening
 * the gate to `serious` is to catch regressions like `nested-interactive`, so
 * only park rules here when fixing them needs a dedicated, cross-cutting pass.
 *
 *   scrollable-region-focusable — Safari-only keyboard-scroll heuristic firing
 *                               on a shared scroll container; niche and outside
 *                               this change's surface.
 *
 * `color-contrast` was previously parked here (pervasive slate muted-text
 * tokens + solid-fill pills failing AA) but has since been driven to ZERO
 * across all nine scanned views by a dedicated design-conserving pass (muted
 * text `slate-400`→`slate-500`/`slate-600`, solid pill fills `-500`→`-700`,
 * luminance-derived issue-label text) and is now HARD-GATED. Scans first wait
 * for entrance animations to settle (see {@link settleAnimations}) so the check
 * reads final composited colours rather than a mid-fade blend.
 */
const DEFERRED_SERIOUS_RULES = ['scrollable-region-focusable']

/**
 * Wait for entrance animations to reach their resting state before scanning.
 *
 * Framer Motion enter transitions (the modal opacity fade + spring, staggered
 * card reveals) transiently composite text over a half-faded panel/scrim. Axe's
 * `color-contrast` check reads that mid-fade composite as a BLENDED colour and
 * reports contrast failures that don't exist once the animation settles — which
 * would make the (now-gated) colour-contrast rule non-deterministic. Poll the
 * animated surfaces' opacity/transform until they hold steady for a few frames
 * (capped, so persistent shimmer/pulse loops can't hang the scan), so the scan
 * measures FINAL colours. Only `color-contrast` depends on opacity; the other
 * gated rules (nested-interactive, roles, names) are unaffected by this wait.
 */
async function settleAnimations(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const cap = setTimeout(finish, 1500)
        let raf = 0
        let last = null
        let stable = 0
        // Sample only elements that are mid-transition (opacity < 1 or a
        // transform applied) — Framer's enter animations drive exactly those.
        // At-rest elements (opacity:1, transform:none) are skipped so they
        // don't bloat the signature; persistent opacity/transform values are
        // constant frame-to-frame and so never block stability detection.
        // Capped at 4000 nodes so a huge DOM can't stall the poll.
        const signature = () => {
          const els = document.querySelectorAll('body *')
          const n = Math.min(els.length, 4000)
          let s = ''
          for (let i = 0; i < n; i++) {
            const cs = getComputedStyle(els[i])
            if (cs.opacity !== '1' || cs.transform !== 'none') {
              s += `${i}:${cs.opacity}:${cs.transform};`
            }
          }
          return s
        }
        function finish() {
          clearTimeout(cap)
          cancelAnimationFrame(raf)
          resolve()
        }
        function tick() {
          const sig = signature()
          if (sig === last) {
            if (++stable >= 3) return finish()
          } else {
            stable = 0
            last = sig
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
  )
}

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
  await settleAnimations(page)
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
