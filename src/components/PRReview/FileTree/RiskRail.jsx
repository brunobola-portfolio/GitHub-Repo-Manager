import { useMemo } from 'react'
import { normalizeRiskLevel, scoreToLevel, riskFillClass, RISK_LABEL } from '../../../utils/riskTokens'

/**
 * Thin risk-colored heat rail along the file tree's edge — one segment per
 * file (same order the tree renders them), sized proportionally to
 * additions+deletions and colored from the same risk data FileTree's dots
 * use (AI risk when available, else the heuristic score). Lets a reviewer
 * see "where's the risk in this PR" in one glance instead of scrolling the
 * list and eyeballing dots row by row — an IDE-minimap for risk.
 *
 * Purely a proportional visual map (not scroll-synced to the virtualized
 * list) — clicking a segment jumps to that file via the same onFileSelect
 * callback the tree rows use.
 *
 * @param {Array}    files        - Files in the SAME order the tree renders them
 * @param {object}   [aiRiskMap]    - { filename: level } — AI risk when available
 * @param {object}   [heuristicMap] - { filename: score } — 0–5 heuristic fallback
 * @param {string}   [activeFile]
 * @param {Function} onFileSelect - Called with filename when a segment is clicked
 */
export function RiskRail({ files = [], aiRiskMap = {}, heuristicMap = {}, activeFile, onFileSelect }) {
  const segments = useMemo(() => files.map((file) => {
    const weight = Math.max((file.additions ?? 0) + (file.deletions ?? 0), 1)
    const aiLevel = normalizeRiskLevel(aiRiskMap[file.filename])
    const level = aiLevel !== 'neutral' ? aiLevel : scoreToLevel(heuristicMap[file.filename])
    return { filename: file.filename, weight, level }
  }), [files, aiRiskMap, heuristicMap])

  if (!segments.length) return null

  return (
    <nav
      aria-label="File risk overview"
      className="w-1.5 shrink-0 flex flex-col bg-slate-100 dark:bg-slate-800 overflow-hidden"
    >
      {segments.map((seg) => {
        const isActive = seg.filename === activeFile
        return (
          <button
            key={seg.filename}
            type="button"
            onClick={() => onFileSelect?.(seg.filename)}
            title={`${seg.filename} — ${RISK_LABEL[seg.level]}`}
            aria-label={`Jump to ${seg.filename} (${RISK_LABEL[seg.level]})`}
            aria-current={isActive ? 'true' : undefined}
            style={{ flexGrow: seg.weight, flexBasis: 0 }}
            className={`w-full min-h-[3px] transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500 ${riskFillClass(seg.level)} ${isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
          />
        )
      })}
    </nav>
  )
}
