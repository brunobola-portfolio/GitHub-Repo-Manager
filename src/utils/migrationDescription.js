/*
 * GitHub Repo Manager
 * Client-side mirror of server/lib/repo-description.js.
 *
 * Kept in sync so the wizard can produce the same template instantly when
 * AI is off, unavailable, or errors out — no network round-trip needed.
 */

export const REPO_DESCRIPTION_MAX = 350

const CODE_FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`+/g
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const WHITESPACE_RE = /\s+/g

export function sanitizeRepoDescription(raw) {
    if (raw == null) return ''
    let out = String(raw)
    out = out.replace(CODE_FENCE_RE, ' ')
    out = out.replace(INLINE_CODE_RE, '')
    out = out.replace(EMOJI_RE, '')
    out = out.replace(WHITESPACE_RE, ' ').trim()
    if (out.length <= REPO_DESCRIPTION_MAX) return out
    const budget = REPO_DESCRIPTION_MAX - 1
    const slice = out.slice(0, budget)
    const lastSpace = slice.lastIndexOf(' ')
    const cut = lastSpace > budget * 0.6 ? slice.slice(0, lastSpace) : slice
    return `${cut.trimEnd()}…`
}

export function defaultRepoDescription({ source, repoName } = {}) {
    const org = source?.org || ''
    const project = source?.project || ''
    const isTfvc = !!source?.isTfvc
    const tfvcPath = source?.tfvcPath || ''

    if (isTfvc) {
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
