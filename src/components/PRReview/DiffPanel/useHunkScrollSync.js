import { useState, useEffect, useRef, useCallback } from 'react'

const HUNK_ROW_SELECTOR = '[data-state="hunk"]'

/**
 * Scroll-sync between the hunk risk rail and the rendered diff.
 *
 * @git-diff-view/react renders one row with `data-state="hunk"` per hunk
 * header, in both split and unified mode (verified against the vendored
 * package source — node_modules/@git-diff-view/react/dist/esm/index.mjs,
 * InternalDiffSplitHunkLineGitHub / InternalDiffUnifiedHunkLine). We
 * piggyback on that existing DOM marker instead of reimplementing hunk
 * boundary tracking or patching the third-party renderer: querying it in
 * document order matches the patch's hunk order 1:1 (see
 * hunkUtils.splitPatchIntoHunks), so element index === hunk index.
 *
 * Returns `{ scrollToHunk, activeHunkIndex }`. Both are safe no-ops before
 * the diff has rendered any hunk rows (e.g. still behind
 * DiffComputeOnDemand/DiffCollapser, or the diff library hasn't mounted yet).
 *
 * @param {import('react').RefObject<HTMLElement>} containerRef - the diff's scrollable container
 * @param {object} [options]
 * @param {number} [options.hunkCount] - total hunks expected, used to skip work when 0
 * @param {*}      [options.dep]       - extra value that should force a re-measure
 *                                       (e.g. filename+patch length) when the container
 *                                       itself doesn't change but its content does
 */
export function useHunkScrollSync(containerRef, { hunkCount = 0, dep } = {}) {
  const [activeHunkIndex, setActiveHunkIndex] = useState(0)
  const rafRef = useRef(null)

  const getHunkElements = useCallback(() => {
    const container = containerRef.current
    if (!container) return []
    return Array.from(container.querySelectorAll(HUNK_ROW_SELECTOR))
  }, [containerRef])

  const scrollToHunk = useCallback((hunkIndex) => {
    const container = containerRef.current
    const target = getHunkElements()[hunkIndex]
    if (!container || !target) return
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(offset - 8, 0), behavior: 'smooth' })
  }, [containerRef, getHunkElements])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !hunkCount) {
      setActiveHunkIndex(0)
      return undefined
    }

    const updateActive = () => {
      rafRef.current = null
      const elements = getHunkElements()
      if (!elements.length) return
      const containerTop = container.getBoundingClientRect().top
      let current = 0
      for (let i = 0; i < elements.length; i++) {
        const top = elements[i].getBoundingClientRect().top - containerTop
        // A hunk header at or slightly above the top edge counts as "current".
        if (top <= 24) current = i
        else break
      }
      setActiveHunkIndex(current)
    }

    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(updateActive)
    }

    updateActive()
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // `dep` intentionally forces a resubscribe/remeasure when content changes
    // under a stable container (e.g. filename/patch changes without the
    // scroll container itself remounting).
  }, [containerRef, hunkCount, dep, getHunkElements])

  return { scrollToHunk, activeHunkIndex }
}
