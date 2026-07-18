/**
 * Canonical risk-color vocabulary for the PR review surface.
 *
 * Before this module, three independent visual languages colored risk on
 * the same screen: `AISummaryPanel`'s RISK_TEXT/RISK_BG/RISK_HEADER_BG maps,
 * `FileRiskBadge`'s 6-step HEURISTIC_COLORS gradient, and `PRRiskBadges`'
 * danger/warning/info/neutral tone vocabulary. All three (plus any new
 * risk-colored UI, e.g. the file-level risk rail) now read from the same
 * `--ds-risk-*` custom properties in `design-system.css` via the `ds-risk-*`
 * utility classes below — one tweak point, one palette. Dark mode is
 * handled by the token override, so call sites never need a `dark:` variant.
 */

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']

export const RISK_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
  neutral: 'Risk unknown',
}

/** Canonicalize any risk-ish string to one of low|medium|high|critical|neutral. */
export function normalizeRiskLevel(level) {
  const key = typeof level === 'string' ? level.toLowerCase() : level
  return RISK_LEVELS.includes(key) ? key : 'neutral'
}

/**
 * Map a 0–5 heuristicRisk() score onto the same 4-level scale AI risk uses,
 * so a file-tree dot / risk-rail segment reads from one palette regardless
 * of whether the level came from AI or the heuristic fallback.
 */
export function scoreToLevel(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'neutral'
  const clamped = Math.max(0, Math.min(5, Math.round(score)))
  if (clamped <= 1) return 'low'
  if (clamped === 2) return 'medium'
  if (clamped === 3) return 'high'
  return 'critical'
}

/** Map PRRiskBadges' danger/warning/info/neutral tone vocabulary onto the same scale. */
export function toneToLevel(tone) {
  switch (tone) {
    case 'danger': return 'critical'
    case 'warning': return 'high'
    case 'info': return 'medium'
    default: return 'neutral'
  }
}

export const riskFillClass = (level) => `ds-risk-fill-${normalizeRiskLevel(level)}`
export const riskTextClass = (level) => `ds-risk-text-${normalizeRiskLevel(level)}`
export const riskTintClass = (level) => `ds-risk-tint-${normalizeRiskLevel(level)}`
export const riskRingClass = (level) => `ds-risk-ring-${normalizeRiskLevel(level)}`
