/**
 * Heuristic branch-hygiene insights for the BranchesTab. Pure function over
 * the array shape GitHub's /branches endpoint already returns — no extra
 * round-trips. The intent is reviewer triage: surface "this list of N
 * branches is mostly noise" cues so the user knows what to clean up first.
 *
 * Detectors are conservative — false positives are worse than missed signals
 * because acting on these means deleting branches.
 *
 * Why it lives in src/utils/ and not in the component: the same numbers feed
 * the Attention Feed dashboard (future) and the per-repo summary tile.
 */

const SUSPICIOUS_NAME_PATTERNS = [
    /^(wip|tmp|temp|scratch|dummy|test|tests?)$/i,
    /^(delete[-_ ]?me|dont[-_ ]?merge|do[-_ ]?not[-_ ]?merge)$/i,
    /^(xxx|todo|fixme|hack|asdf|qwerty)$/i,
    /^(foo|bar|baz|test\d*|temp\d*|backup\d*)$/i,
    /^[a-z]$/i,        // single-letter
    /^\d+$/,           // pure-number
    /^(my|new)[-_ ]?branch$/i,
]

const SUSPICIOUS_TOKEN_PATTERNS = [
    /\b(test|wip|tmp|delete|backup|copy)[-_ ]?\d{1,3}$/i,  // "test-3", "wip2"
    /\b(fix|hot)?[-_ ]?typo[-_ ]?\d*$/i,                    // "fix-typo", "hot-typo-2"
    /^revert-merge-/i,                                       // accidental revert chains
]

function classify(name) {
    if (!name || typeof name !== 'string') return null
    for (const re of SUSPICIOUS_NAME_PATTERNS) {
        if (re.test(name)) return { reason: 'placeholder-name', detail: `"${name}" looks like a throwaway branch name.` }
    }
    for (const re of SUSPICIOUS_TOKEN_PATTERNS) {
        if (re.test(name)) return { reason: 'transient-pattern', detail: `"${name}" looks transient (test/typo/backup-style chain).` }
    }
    return null
}

/**
 * @param {Array<{ name: string, protected?: boolean, commit?: { sha: string } }>} branches
 * @param {object} [opts]
 * @param {string} [opts.defaultBranch='main']
 * @returns {{
 *   total: number,
 *   protected: number,
 *   protectedRatio: number,
 *   prefixes: Array<{ prefix: string, count: number, names: string[] }>,
 *   suspicious: Array<{ name: string, reason: string, detail: string }>,
 *   defaultBranch: string,
 *   hasDefaultBranch: boolean
 * }}
 */
export function computeBranchHygiene(branches, { defaultBranch = 'main' } = {}) {
    const list = Array.isArray(branches) ? branches : []
    const prefixCounts = new Map()
    const suspicious = []
    let protectedCount = 0
    let hasDefault = false

    for (const b of list) {
        if (!b?.name) continue
        if (b.name === defaultBranch) hasDefault = true
        if (b.protected) protectedCount += 1

        // Prefix grouping — split on the first '/' so "feat/login" → "feat".
        const slashIdx = b.name.indexOf('/')
        if (slashIdx > 0) {
            const prefix = b.name.slice(0, slashIdx)
            const entry = prefixCounts.get(prefix) ?? { count: 0, names: [] }
            entry.count += 1
            if (entry.names.length < 6) entry.names.push(b.name)
            prefixCounts.set(prefix, entry)
        }

        const flag = classify(b.name)
        if (flag && b.name !== defaultBranch) {
            suspicious.push({ name: b.name, ...flag })
        }
    }

    // Only show prefixes that actually cluster (≥3 branches under the same
    // prefix). Below that the signal isn't worth highlighting.
    const prefixes = [...prefixCounts.entries()]
        .filter(([, v]) => v.count >= 3)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([prefix, v]) => ({ prefix, count: v.count, names: v.names }))

    return {
        total: list.length,
        protected: protectedCount,
        protectedRatio: list.length > 0 ? protectedCount / list.length : 0,
        prefixes,
        suspicious,
        defaultBranch,
        hasDefaultBranch: hasDefault,
    }
}
