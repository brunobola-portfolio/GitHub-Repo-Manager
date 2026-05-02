/**
 * Clipboard helper — single source for the navigator.clipboard.writeText
 * pattern that was previously inlined in 4 action registries (repoActions,
 * prActions, branchActions, issueActions). Tolerates older browsers + the
 * SSR/test environments where `navigator.clipboard` is undefined: returns
 * a Promise that resolves to false in those cases instead of throwing.
 *
 * @param {string} text
 * @returns {Promise<boolean>} true on success, false when clipboard isn't available
 */
export async function copyToClipboard(text) {
    if (typeof text !== 'string') return false
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return false
    }
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // Permission denied / clipboard locked / iframe origin mismatch —
        // surface false so callers can fall back to a "manual copy" hint.
        return false
    }
}
