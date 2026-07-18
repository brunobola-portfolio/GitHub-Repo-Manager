import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HunkRiskRail } from '@/components/PRReview/DiffPanel/HunkRiskRail'
import { MIN_CHANGED_LINES_FOR_RAIL, MAX_RAIL_SEGMENTS } from '@/components/PRReview/DiffPanel/hunkUtils'

afterEach(() => cleanup())

function makeHunk(n, header) {
  const body = Array.from({ length: n }, (_, i) => `+line${i}`).join('\n')
  return `${header ?? `@@ -1,${n} +1,${n} @@`}\n${body}`
}

/**
 * Build a fake scrollable container with N fake `[data-state="hunk"]` rows,
 * each with a scripted getBoundingClientRect, mirroring what
 * @git-diff-view/react renders for hunk header lines (see useHunkScrollSync's
 * doc comment for the verified selector). Not attached to `document` — plain
 * DOM nodes with stubbed layout methods are enough since jsdom has no real
 * layout engine.
 */
function makeDiffContainer(hunkCount, { rowSpacing = 100 } = {}) {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => ({ top: 0 })
  container.scrollTop = 0
  container.scrollTo = vi.fn()
  for (let i = 0; i < hunkCount; i++) {
    const row = document.createElement('tr')
    row.setAttribute('data-state', 'hunk')
    row.getBoundingClientRect = () => ({ top: i * rowSpacing })
    container.appendChild(row)
  }
  return container
}

describe('HunkRiskRail — visibility thresholds', () => {
  it('renders nothing for a single-hunk patch (nothing to navigate between)', () => {
    const patch = makeHunk(100)
    const containerRef = { current: makeDiffContainer(1) }
    const { container } = render(
      <HunkRiskRail filename="src/x.js" patch={patch} containerRef={containerRef} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a tiny multi-hunk diff below the changed-lines threshold', () => {
    const patch = `${makeHunk(1)}\n${makeHunk(1)}`
    const containerRef = { current: makeDiffContainer(2) }
    const { container } = render(
      <HunkRiskRail filename="src/x.js" patch={patch} containerRef={containerRef} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a segment per hunk once both thresholds are cleared', () => {
    const patch = `${makeHunk(MIN_CHANGED_LINES_FOR_RAIL)}\n${makeHunk(2)}`
    const containerRef = { current: makeDiffContainer(2) }
    render(<HunkRiskRail filename="src/x.js" patch={patch} containerRef={containerRef} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})

describe('HunkRiskRail — accessible names', () => {
  it('labels each segment "Jump to hunk N in <file> — <risk> risk"', () => {
    const patch = `${makeHunk(MIN_CHANGED_LINES_FOR_RAIL)}\n${makeHunk(2)}`
    const containerRef = { current: makeDiffContainer(2) }
    render(<HunkRiskRail filename="src/example.js" patch={patch} containerRef={containerRef} />)
    expect(
      screen.getByRole('button', { name: /Jump to hunk 1 in src\/example\.js — .*risk/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Jump to hunk 2 in src\/example\.js — .*risk/i }),
    ).toBeInTheDocument()
  })

  it('labels a merged group with a hunk range', () => {
    const hunkCount = MAX_RAIL_SEGMENTS + 10
    const patch = Array.from({ length: hunkCount }, () => makeHunk(5)).join('\n')
    const containerRef = { current: makeDiffContainer(hunkCount) }
    render(<HunkRiskRail filename="src/big.js" patch={patch} containerRef={containerRef} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeLessThanOrEqual(MAX_RAIL_SEGMENTS)
    expect(buttons.some((b) => /hunks \d+-\d+/i.test(b.getAttribute('aria-label')))).toBe(true)
  })
})

describe('HunkRiskRail — click-to-scroll wiring', () => {
  it('scrolls the container to the clicked hunk element via scrollTo', async () => {
    const user = userEvent.setup()
    const patch = `${makeHunk(MIN_CHANGED_LINES_FOR_RAIL)}\n${makeHunk(2)}\n${makeHunk(2)}`
    const containerRef = { current: makeDiffContainer(3, { rowSpacing: 200 }) }
    render(<HunkRiskRail filename="src/x.js" patch={patch} containerRef={containerRef} />)

    await user.click(screen.getByRole('button', { name: /Jump to hunk 3/i }))

    expect(containerRef.current.scrollTo).toHaveBeenCalledTimes(1)
    const call = containerRef.current.scrollTo.mock.calls[0][0]
    // Third hunk row is stubbed at top:400 (index 2 * rowSpacing 200); the hook
    // subtracts a small fixed offset and requests smooth scrolling.
    expect(call.top).toBe(392)
    expect(call.behavior).toBe('smooth')
  })

  it('is a no-op when the container ref has no matching hunk rows (e.g. diff not yet rendered)', async () => {
    const user = userEvent.setup()
    const patch = `${makeHunk(MIN_CHANGED_LINES_FOR_RAIL)}\n${makeHunk(2)}`
    // Container exists but has zero rendered hunk rows (collapsed/compute-on-demand diff).
    const containerRef = { current: makeDiffContainer(0) }
    render(<HunkRiskRail filename="src/x.js" patch={patch} containerRef={containerRef} />)

    await user.click(screen.getAllByRole('button')[0])

    expect(containerRef.current.scrollTo).not.toHaveBeenCalled()
  })
})
