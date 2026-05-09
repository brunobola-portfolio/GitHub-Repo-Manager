// Thresholds for picking how a single file's diff is rendered.
//
// FOLD_THRESHOLD: above this, the diff is folded by default and the user
// must opt in to expand. Mirrors GitHub's 2025 default and is the single
// most important mobile-correctness rule (an iOS Safari tab can be killed
// if a user lands on a 5k-line diff cold).
//
// COMPUTE_THRESHOLD: above this, even the folded preview is too expensive
// because the lib still parses the whole patch. We replace the diff with
// a placeholder card and only mount the renderer if the user clicks. This
// mirrors Monaco's `maxFileSize` pattern.
export const FOLD_THRESHOLD = 500
export const COMPUTE_THRESHOLD = 50_000

/**
 * Decide which of three render strategies to use for a single file's diff.
 *
 * @param {{ additions?: number, deletions?: number } | null | undefined} file
 * @returns {'pass' | 'collapse' | 'compute'}
 */
export function pickRenderStrategy(file) {
    const total = (file?.additions ?? 0) + (file?.deletions ?? 0)
    if (total > COMPUTE_THRESHOLD) return 'compute'
    if (total > FOLD_THRESHOLD) return 'collapse'
    return 'pass'
}
