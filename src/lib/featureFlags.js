const PREFIX = 'dashboard_premium_v2_'

// Flags that default to ON unless the user explicitly opts out via the
// admin UI (Settings → Advanced) or `localStorage.setItem('dashboard_premium_v2_<flag>', '0')`.
// Once a feature has graduated from "behind a flag" to "shipped by default",
// list it here so users get it without flipping anything manually. Drop the
// flag (and the gate in the consumer) once it's been on by default for a release.
const DEFAULT_ON = new Set(['inbox'])

export function isEnabled(flag) {
    try {
        const raw = localStorage.getItem(PREFIX + flag)
        if (raw === '1') return true
        if (raw === '0') return false
        return DEFAULT_ON.has(flag)
    }
    catch { return DEFAULT_ON.has(flag) }
}

export function setFlag(flag, on) {
    try {
        if (on === null || on === undefined) {
            // Reset to default — drop the explicit override.
            localStorage.removeItem(PREFIX + flag)
        } else {
            localStorage.setItem(PREFIX + flag, on ? '1' : '0')
        }
    } catch { /* no-op */ }
}

/** Returns the default for a flag (used by Settings UI to show the "default" state). */
export function getDefault(flag) {
    return DEFAULT_ON.has(flag)
}
