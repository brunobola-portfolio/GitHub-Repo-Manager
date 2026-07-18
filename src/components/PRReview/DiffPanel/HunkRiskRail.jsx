import { useMemo } from 'react'
import { normalizeRiskLevel, riskFillClass, RISK_LABEL } from '../../../utils/riskTokens'
import { buildHunkSegments, shouldShowHunkRail } from './hunkUtils'
import { useHunkScrollSync } from './useHunkScrollSync'

function hunkLabel(seg) {
  const [first, ...rest] = seg.hunkIndices
  if (rest.length === 0) return `hunk ${first + 1}`
  const last = rest[rest.length - 1]
  return `hunks ${first + 1}-${last + 1}`
}

/**
 * Vertical heat rail alongside the diff viewport: one segment per hunk
 * (merged/capped for very-hunky files — see hunkUtils.MAX_RAIL_SEGMENTS),
 * height proportional to the hunk's changed-line weight, colored from the
 * same ds-risk-* tokens the file-level RiskRail (FileTree/RiskRail.jsx)
 * uses — one risk-color vocabulary for the whole review surface. Clicking
 * a segment scrolls the diff to that hunk; scroll-sync (useHunkScrollSync)
 * highlights whichever hunk currently sits at the top of the viewport.
 *
 * Hidden below a size threshold (shouldShowHunkRail) — a 3-line diff
 * doesn't need a minimap. Purely supplementary navigation: plain
 * <button>s in normal tab order, so it never traps focus or interferes
 * with the review surface's j/k roving navigation.
 *
 * @param {string} filename
 * @param {string} [patch]
 * @param {import('react').RefObject<HTMLElement>} containerRef - the diff's scrollable container
 */
export function HunkRiskRail({ filename, patch, containerRef }) {
  const segments = useMemo(() => buildHunkSegments(patch, filename), [patch, filename])
  const visible = useMemo(() => shouldShowHunkRail(patch), [patch])

  const { scrollToHunk, activeHunkIndex } = useHunkScrollSync(containerRef, {
    hunkCount: segments.length,
    dep: `${filename ?? ''}:${patch?.length ?? 0}`,
  })

  if (!visible || segments.length === 0) return null

  return (
    <nav
      aria-label={`Hunk risk overview for ${filename}`}
      className="w-1.5 shrink-0 flex flex-col bg-slate-100 dark:bg-slate-800 overflow-hidden"
    >
      {segments.map((seg) => {
        const isActive = seg.hunkIndices.includes(activeHunkIndex)
        const level = normalizeRiskLevel(seg.level)
        const label = `Jump to ${hunkLabel(seg)} in ${filename} — ${RISK_LABEL[level]}`
        return (
          <button
            key={seg.firstHunkIndex}
            type="button"
            onClick={() => scrollToHunk(seg.firstHunkIndex)}
            title={label}
            aria-label={label}
            aria-current={isActive ? 'true' : undefined}
            style={{ flexGrow: seg.weight, flexBasis: 0 }}
            className={`w-full min-h-[3px] transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500 ${riskFillClass(level)} ${isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
          />
        )
      })}
    </nav>
  )
}
