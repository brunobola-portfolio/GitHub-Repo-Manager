/*
 * GitHub Repo Manager
 * Shared helpers for composing and sanitizing GitHub repository descriptions.
 *
 * Used by:
 *   - server/routes/ai.js        (POST /api/ai/migration-description)
 *   - server/migration-engine.js (deterministic default for every import)
 *   - src/utils/migrationDescription.js (client-side mirror)
 */

export const REPO_DESCRIPTION_MAX = 350

const CODE_FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`+/g
// Covers the main emoji ranges: pictographs, symbols, transport, flags, misc.
// Uses Unicode property escapes (supported in Node 16+).
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const WHITESPACE_RE = /\s+/g

/**
 * Collapse, strip, and truncate a raw string into a GitHub-safe description.
 * Rules (in order):
 *   1. Remove fenced code blocks and inline backticks
 *   2. Strip emoji
 *   3. Collapse whitespace (incl. newlines/tabs) to single spaces
 *   4. Trim
 *   5. Truncate to 350 chars on a word boundary, append ellipsis if cut
 */
export function sanitizeRepoDescription(raw) {
    if (raw == null) return ''
    let out = String(raw)
    out = out.replace(CODE_FENCE_RE, ' ')
    out = out.replace(INLINE_CODE_RE, '')
    out = out.replace(EMOJI_RE, '')
    out = out.replace(WHITESPACE_RE, ' ').trim()
    if (out.length <= REPO_DESCRIPTION_MAX) return out
    // Word-boundary truncation with trailing ellipsis. Reserve 1 char for the ellipsis.
    const budget = REPO_DESCRIPTION_MAX - 1
    const slice = out.slice(0, budget)
    const lastSpace = slice.lastIndexOf(' ')
    const cut = lastSpace > budget * 0.6 ? slice.slice(0, lastSpace) : slice
    return `${cut.trimEnd()}…`
}

/**
 * Deterministic template used when AI is off, unavailable, or fails.
 * Accepts the same shape the wizard sends to the AI endpoint.
 */
export function defaultRepoDescription({ source, repoName } = {}) {
    const org = source?.org || ''
    const project = source?.project || ''
    const isTfvc = !!source?.isTfvc
    const tfvcPath = source?.tfvcPath || ''

    if (isTfvc) {
        // tfvcPath is typically "$/{project}/{folder}". Strip the "$/" prefix and
        // the leading project segment so only the folder path remains. If the path
        // is just the project root (no folder), emit the project alone.
        const folder = tfvcPath
            .replace(/^\$\//, '')
            .replace(new RegExp(`^${escapeForRegex(project)}/?`), '')
        const suffix = folder ? `/${folder}` : ''
        return sanitizeRepoDescription(`Migrated from Azure DevOps TFVC: ${project}${suffix}`)
    }

    const repo = repoName || ''
    const suffix = repo ? `/${repo}` : ''
    return sanitizeRepoDescription(`Migrated from Azure DevOps: ${org}/${project}${suffix}`)
}

function escapeForRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
