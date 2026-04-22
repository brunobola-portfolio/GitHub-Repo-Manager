import AxeBuilder from '@axe-core/playwright'

/**
 * Run axe against the current page and fail if serious/critical violations exist.
 * Allowlist parameter lets a spec opt out of specific rules (e.g., color-contrast
 * during development). Use sparingly; each opt-out should have a TODO with context.
 */
export async function checkA11y(page, { allowlist = [], tag = 'WCAG 2.1 AA' } = {}) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .disableRules(allowlist)
    .analyze()

  // Fail only on serious or critical impact. Minor/moderate log a warning
  // but don't block — they're intent-sensitive and warrant human review.
  const severe = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  )

  if (severe.length > 0) {
    const summary = severe
      .map(
        (v) =>
          `  ${v.impact.padEnd(8)} ${v.id}: ${v.description}\n    ${v.nodes.length} node(s) affected\n    -> ${v.helpUrl}`
      )
      .join('\n')
    throw new Error(`A11y violations detected (${tag}):\n${summary}`)
  }

  return results // caller can inspect warnings if useful
}
