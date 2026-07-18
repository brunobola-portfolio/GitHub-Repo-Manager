import { normalizeRiskLevel, scoreToLevel, riskFillClass } from '../../../utils/riskTokens'

/**
 * Small colored dot indicating file risk level.
 *
 * Color comes from the shared `ds-risk-*` token set (src/utils/riskTokens.js)
 * — the same palette the risk rail, AI summary panel, and PR-level risk
 * badges use, so risk reads consistently everywhere it shows up.
 *
 * @param {string}  [aiRisk]        - Named risk: 'low' | 'medium' | 'high' | 'critical'
 * @param {number}  [heuristicScore] - Numeric score 0–5 (used when aiRisk is absent)
 */
export function FileRiskBadge({ aiRisk, heuristicScore }) {
  let level
  let title

  const normalizedAiRisk = aiRisk ? normalizeRiskLevel(aiRisk) : 'neutral'
  if (normalizedAiRisk !== 'neutral') {
    level = normalizedAiRisk
    title = `AI risk: ${aiRisk}`
  } else if (typeof heuristicScore === 'number') {
    const idx = Math.max(0, Math.min(5, Math.round(heuristicScore)))
    level = scoreToLevel(heuristicScore)
    title = `Heuristic risk score: ${idx}/5`
  } else {
    // No risk data — render a neutral dot
    level = 'neutral'
    title = 'Risk unknown'
  }

  return (
    <span
      role="img"
      aria-label={title}
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${riskFillClass(level)}`}
      title={title}
    />
  )
}
