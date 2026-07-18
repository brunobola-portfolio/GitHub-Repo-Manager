import { scoreToLevel } from '../../../utils/riskTokens'

/**
 * Hunk-parsing + hunk-risk-scoring helpers shared by DiffRenderer (which
 * synthesizes minimal file headers per hunk to feed @git-diff-view/core)
 * and HunkRiskRail (which needs raw hunk text for risk scoring + line
 * counting). `splitPatchIntoHunks` is the single source of truth for hunk
 * boundaries — don't reimplement the split elsewhere.
 */

/**
 * Split a unified diff patch string into raw hunk strings, each starting
 * with its "@@ -a,b +c,d @@" header line.
 *
 * GitHub API patches start directly with "@@" (no --- / +++ file header).
 *
 * @param {string} [patch]
 * @returns {string[]}
 */
export function splitPatchIntoHunks(patch) {
  if (!patch) return []
  const parts = patch.split(/(?=^@@)/m)
  return parts.map((p) => p.trim()).filter((p) => p.startsWith('@@'))
}

/**
 * Count added/removed lines within a raw hunk string (header line excluded).
 *
 * @param {string} hunkText
 * @returns {{ additions: number, deletions: number }}
 */
export function countHunkChangedLines(hunkText) {
  if (!hunkText) return { additions: 0, deletions: 0 }
  const lines = hunkText.split('\n').slice(1) // drop the "@@ ... @@" header
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

const SENSITIVE_RE = /auth|secret|token|crypt|password|session|middleware/i
const MIGRATION_RE = /migrat|schema|\.sql\b/i

/**
 * Cheap 0-5 heuristic risk score for a single hunk — the same keyword/size
 * signals `heuristicRisk()` (PRReview/hooks/useReviewAI.js) uses for whole
 * files, scoped down to one hunk's text instead of the filename alone.
 *
 * @param {string} hunkText
 * @param {string} [filename]
 * @returns {number} 0-5
 */
export function heuristicHunkRisk(hunkText, filename = '') {
  if (!hunkText) return 0
  let score = 0
  if (SENSITIVE_RE.test(filename) || SENSITIVE_RE.test(hunkText)) score += 3
  if (MIGRATION_RE.test(filename) || MIGRATION_RE.test(hunkText)) score += 2
  const { additions, deletions } = countHunkChangedLines(hunkText)
  const changed = additions + deletions
  if (changed > 40) score += 2
  else if (changed > 15) score += 1
  return Math.max(0, Math.min(5, score))
}

/** Rail shows at most this many segments — beyond it, adjacent hunks are merged. */
export const MAX_RAIL_SEGMENTS = 24
/** Below this many hunks there's nothing meaningful to jump between. */
export const MIN_HUNKS_FOR_RAIL = 2
/** Below this many total changed lines, the rail is more clutter than signal. */
export const MIN_CHANGED_LINES_FOR_RAIL = 20

const RISK_ORDER = ['neutral', 'low', 'medium', 'high', 'critical']

function higherLevel(a, b) {
  return RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a
}

/**
 * Build heat-rail segments for a file's patch — one per hunk, merged into
 * at most `MAX_RAIL_SEGMENTS` evenly-bucketed groups when there are more
 * hunks than that. Each segment carries the original (pre-merge) hunk
 * indices, in the same order @git-diff-view renders `[data-state="hunk"]`
 * rows, so callers can map a segment back to a DOM/scroll position.
 *
 * @param {string} patch
 * @param {string} [filename]
 * @returns {Array<{ hunkIndices: number[], firstHunkIndex: number, weight: number, level: string }>}
 */
export function buildHunkSegments(patch, filename) {
  const rawHunks = splitPatchIntoHunks(patch)
  if (rawHunks.length === 0) return []

  const hunkInfo = rawHunks.map((text, index) => {
    const { additions, deletions } = countHunkChangedLines(text)
    const weight = Math.max(additions + deletions, 1)
    const level = scoreToLevel(heuristicHunkRisk(text, filename))
    return { index, weight, level }
  })

  const groupCount = Math.min(hunkInfo.length, MAX_RAIL_SEGMENTS)
  const groups = Array.from({ length: groupCount }, () => [])
  hunkInfo.forEach((info, i) => {
    const bucket = Math.min(Math.floor((i * groupCount) / hunkInfo.length), groupCount - 1)
    groups[bucket].push(info)
  })

  return groups
    .filter((g) => g.length > 0)
    .map((group) => ({
      hunkIndices: group.map((g) => g.index),
      firstHunkIndex: group[0].index,
      weight: group.reduce((sum, g) => sum + g.weight, 0),
      level: group.reduce((max, g) => higherLevel(max, g.level), 'neutral'),
    }))
}

/**
 * Whether the hunk risk rail is worth showing for this patch — hidden for
 * single-hunk or very small diffs (see MIN_HUNKS_FOR_RAIL / MIN_CHANGED_LINES_FOR_RAIL).
 *
 * @param {string} patch
 * @returns {boolean}
 */
export function shouldShowHunkRail(patch) {
  const rawHunks = splitPatchIntoHunks(patch)
  if (rawHunks.length < MIN_HUNKS_FOR_RAIL) return false
  const totalChanged = rawHunks.reduce((sum, h) => {
    const { additions, deletions } = countHunkChangedLines(h)
    return sum + additions + deletions
  }, 0)
  return totalChanged >= MIN_CHANGED_LINES_FOR_RAIL
}
