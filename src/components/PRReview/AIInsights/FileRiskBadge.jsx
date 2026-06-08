const RISK_COLORS = {
  critical: 'bg-red-500 dark:bg-red-400',
  high: 'bg-red-400 dark:bg-red-500',
  medium: 'bg-yellow-400 dark:bg-yellow-500',
  low: 'bg-green-400 dark:bg-green-500',
}

const HEURISTIC_COLORS = [
  'bg-green-400 dark:bg-green-500',   // 0
  'bg-green-400 dark:bg-green-500',   // 1
  'bg-yellow-400 dark:bg-yellow-500', // 2
  'bg-orange-400 dark:bg-orange-500', // 3
  'bg-red-400 dark:bg-red-500',       // 4
  'bg-red-500 dark:bg-red-400',       // 5
]

/**
 * Small colored dot indicating file risk level.
 *
 * @param {string}  [aiRisk]        - Named risk: 'low' | 'medium' | 'high' | 'critical'
 * @param {number}  [heuristicScore] - Numeric score 0–5 (used when aiRisk is absent)
 */
export function FileRiskBadge({ aiRisk, heuristicScore }) {
  let colorClass
  let title

  if (aiRisk && RISK_COLORS[aiRisk]) {
    colorClass = RISK_COLORS[aiRisk]
    title = `AI risk: ${aiRisk}`
  } else if (typeof heuristicScore === 'number') {
    const idx = Math.max(0, Math.min(5, Math.round(heuristicScore)))
    colorClass = HEURISTIC_COLORS[idx]
    title = `Heuristic risk score: ${idx}/5`
  } else {
    // No risk data — render a neutral dot
    colorClass = 'bg-slate-300 dark:bg-slate-600'
    title = 'Risk unknown'
  }

  return (
    <span
      role="img"
      aria-label={title}
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colorClass}`}
      title={title}
    />
  )
}
