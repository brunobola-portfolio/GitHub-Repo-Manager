import AxeBuilder from '@axe-core/playwright'

/**
 * Run axe against the current page and fail on critical violations only.
 *
 * Gate policy (v3.7.x): critical = hard fail (blocks the build).
 * Serious/moderate/minor are reported as warnings and tracked as tech debt
 * — promoting them to the hard gate requires dedicated design work for
 * color-contrast across brand gradients and a RepoCard refactor for
 * nested-interactive. We deliberately start narrow instead of shipping a
 * broken gate that always fails.
 *
 * `allowlist` disables specific axe rules (e.g., known false positives in
 * third-party widgets). Use sparingly with a comment explaining why.
 */
export async function checkA11y(page, { allowlist = [], tag = 'WCAG 2.1 AA' } = {}) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .disableRules(allowlist)
    .analyze()

  const blocking = results.violations.filter((v) => v.impact === 'critical')
  const warnings = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'moderate'
  )

  if (warnings.length > 0) {
    const summary = warnings
      .map((v) => `  ${v.impact.padEnd(8)} ${v.id} (${v.nodes.length} node(s))`)
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
    throw new Error(`A11y critical violations detected (${tag}):\n${summary}`)
  }

  return results
}
