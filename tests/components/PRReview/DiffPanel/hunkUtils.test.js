import { describe, it, expect } from 'vitest'
import {
  splitPatchIntoHunks,
  countHunkChangedLines,
  heuristicHunkRisk,
  buildHunkSegments,
  shouldShowHunkRail,
  MAX_RAIL_SEGMENTS,
  MIN_HUNKS_FOR_RAIL,
  MIN_CHANGED_LINES_FOR_RAIL,
} from '@/components/PRReview/DiffPanel/hunkUtils'

/** Build a raw hunk string with `n` added lines (no removals). */
function makeHunk(n, { header = `@@ -1,${n} +1,${n} @@`, lineText = 'line' } = {}) {
  const body = Array.from({ length: n }, (_, i) => `+${lineText}${i}`).join('\n')
  return `${header}\n${body}`
}

describe('splitPatchIntoHunks', () => {
  it('splits a multi-hunk patch into raw hunk strings, each starting with @@', () => {
    const patch = `${makeHunk(2)}\n${makeHunk(3)}\n${makeHunk(1)}`
    const hunks = splitPatchIntoHunks(patch)
    expect(hunks).toHaveLength(3)
    hunks.forEach((h) => expect(h.startsWith('@@')).toBe(true))
  })

  it('returns an empty array for falsy/empty input', () => {
    expect(splitPatchIntoHunks('')).toEqual([])
    expect(splitPatchIntoHunks(undefined)).toEqual([])
  })

  it('returns a single-element array for a one-hunk patch', () => {
    expect(splitPatchIntoHunks(makeHunk(4))).toHaveLength(1)
  })
})

describe('countHunkChangedLines', () => {
  it('counts + and - lines, excluding the header', () => {
    const hunk = '@@ -1,2 +1,3 @@\n context\n-removed\n+added1\n+added2'
    expect(countHunkChangedLines(hunk)).toEqual({ additions: 2, deletions: 1 })
  })

  it('returns zeros for empty input', () => {
    expect(countHunkChangedLines('')).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('heuristicHunkRisk', () => {
  it('scores 0 for a small, keyword-free hunk', () => {
    expect(heuristicHunkRisk(makeHunk(2), 'src/utils/format.js')).toBe(0)
  })

  it('scores higher when the filename matches a sensitive-keyword pattern', () => {
    const score = heuristicHunkRisk(makeHunk(2), 'server/middleware/auth.js')
    expect(score).toBeGreaterThanOrEqual(3)
  })

  it('scores higher when the hunk body itself contains a sensitive keyword', () => {
    const hunk = '@@ -1,1 +1,2 @@\n+const password = process.env.SECRET'
    expect(heuristicHunkRisk(hunk, 'src/x.js')).toBeGreaterThanOrEqual(3)
  })

  it('scores higher for a migration/schema filename', () => {
    expect(heuristicHunkRisk(makeHunk(2), 'db/migrations/001_init.sql')).toBeGreaterThanOrEqual(2)
  })

  it('adds size-based score for larger hunks', () => {
    const small = heuristicHunkRisk(makeHunk(5), 'src/x.js')
    const medium = heuristicHunkRisk(makeHunk(20), 'src/x.js')
    const large = heuristicHunkRisk(makeHunk(50), 'src/x.js')
    expect(medium).toBeGreaterThan(small)
    expect(large).toBeGreaterThan(medium)
  })

  it('clamps the score to the 0-5 range', () => {
    const hunk = '@@ -1,1 +1,60 @@\n' + Array.from({ length: 60 }, (_, i) => `+password${i}`).join('\n')
    expect(heuristicHunkRisk(hunk, 'server/middleware/auth-migration.sql')).toBeLessThanOrEqual(5)
  })
})

describe('buildHunkSegments — proportional positioning', () => {
  it('returns one segment per hunk when under the cap', () => {
    const patch = `${makeHunk(2)}\n${makeHunk(10)}\n${makeHunk(1)}`
    const segments = buildHunkSegments(patch, 'src/x.js')
    expect(segments).toHaveLength(3)
    expect(segments.map((s) => s.firstHunkIndex)).toEqual([0, 1, 2])
    expect(segments.map((s) => s.hunkIndices)).toEqual([[0], [1], [2]])
  })

  it('weights each segment by its changed-line count (bigger hunk = bigger weight)', () => {
    const patch = `${makeHunk(2)}\n${makeHunk(20)}`
    const [small, big] = buildHunkSegments(patch, 'src/x.js')
    expect(big.weight).toBeGreaterThan(small.weight)
    expect(small.weight).toBe(2)
    expect(big.weight).toBe(20)
  })

  it('floors segment weight at 1 for a hunk with only context/header (defensive)', () => {
    const patch = '@@ -1,1 +1,1 @@\n context-only-no-changes'
    const [seg] = buildHunkSegments(patch, 'src/x.js')
    expect(seg.weight).toBe(1)
  })

  it('assigns risk level from the highest-severity signal in the hunk', () => {
    const patch = makeHunk(2)
    const [seg] = buildHunkSegments(patch, 'server/middleware/auth.js')
    expect(seg.level).toBe('high')
  })

  it('returns an empty array for a patch with no hunks', () => {
    expect(buildHunkSegments('', 'src/x.js')).toEqual([])
    expect(buildHunkSegments(undefined, 'src/x.js')).toEqual([])
  })
})

describe('buildHunkSegments — cap/merge behavior for many hunks', () => {
  it('caps segment count at MAX_RAIL_SEGMENTS when there are more hunks than that', () => {
    const hunkCount = MAX_RAIL_SEGMENTS + 10
    const patch = Array.from({ length: hunkCount }, () => makeHunk(2)).join('\n')
    const segments = buildHunkSegments(patch, 'src/x.js')
    expect(segments.length).toBeLessThanOrEqual(MAX_RAIL_SEGMENTS)
    expect(segments.length).toBeGreaterThan(0)
  })

  it('covers every original hunk index exactly once across merged groups, in order', () => {
    const hunkCount = MAX_RAIL_SEGMENTS + 10
    const patch = Array.from({ length: hunkCount }, () => makeHunk(2)).join('\n')
    const segments = buildHunkSegments(patch, 'src/x.js')
    const allIndices = segments.flatMap((s) => s.hunkIndices)
    expect(allIndices).toEqual(Array.from({ length: hunkCount }, (_, i) => i))
  })

  it('merges a high-risk hunk into a group and the group inherits the higher severity', () => {
    // Push well past the cap so merging happens, and make exactly one hunk both
    // token-flavored AND large enough to clear the size-score threshold too
    // (sensitive-keyword +3, size >40 changed lines +2 => 5 => 'critical'),
    // then check the merged group that contains it inherits 'critical'.
    const hunkCount = MAX_RAIL_SEGMENTS + 5
    const bigTokenHunk = `@@ -1,1 +1,46 @@\n+const token = "x"\n${Array.from({ length: 45 }, (_, i) => `+line${i}`).join('\n')}`
    const hunks = Array.from({ length: hunkCount }, (_, i) => (i === 2 ? bigTokenHunk : makeHunk(2)))
    const patch = hunks.join('\n')
    expect(heuristicHunkRisk(bigTokenHunk, 'src/plain.js')).toBe(5)
    const segments = buildHunkSegments(patch, 'src/plain.js')
    expect(segments.some((s) => s.level === 'critical')).toBe(true)
  })

  it('does not merge when hunk count is exactly at the cap', () => {
    const patch = Array.from({ length: MAX_RAIL_SEGMENTS }, () => makeHunk(2)).join('\n')
    const segments = buildHunkSegments(patch, 'src/x.js')
    expect(segments).toHaveLength(MAX_RAIL_SEGMENTS)
    segments.forEach((s) => expect(s.hunkIndices).toHaveLength(1))
  })
})

describe('shouldShowHunkRail — edge cases', () => {
  it('hides the rail for a single-hunk patch regardless of size', () => {
    const patch = makeHunk(100)
    expect(splitPatchIntoHunks(patch)).toHaveLength(1)
    expect(shouldShowHunkRail(patch)).toBe(false)
  })

  it('hides the rail for a tiny multi-hunk diff below the changed-lines threshold', () => {
    const patch = `${makeHunk(1)}\n${makeHunk(1)}`
    const total = countHunkChangedLines(splitPatchIntoHunks(patch)[0]).additions
      + countHunkChangedLines(splitPatchIntoHunks(patch)[1]).additions
    expect(total).toBeLessThan(MIN_CHANGED_LINES_FOR_RAIL)
    expect(shouldShowHunkRail(patch)).toBe(false)
  })

  it('shows the rail once both the hunk-count and changed-lines thresholds are cleared', () => {
    const patch = `${makeHunk(MIN_CHANGED_LINES_FOR_RAIL)}\n${makeHunk(2)}`
    expect(splitPatchIntoHunks(patch).length).toBeGreaterThanOrEqual(MIN_HUNKS_FOR_RAIL)
    expect(shouldShowHunkRail(patch)).toBe(true)
  })

  it('hides the rail for an empty patch', () => {
    expect(shouldShowHunkRail('')).toBe(false)
    expect(shouldShowHunkRail(undefined)).toBe(false)
  })
})
