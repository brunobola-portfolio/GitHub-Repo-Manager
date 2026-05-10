const PREFIX = 'dashboard_premium_v2_'

export function isEnabled(flag) {
    try { return localStorage.getItem(PREFIX + flag) === '1' }
    catch { return false }
}

export function setFlag(flag, on) {
    try {
        if (on) localStorage.setItem(PREFIX + flag, '1')
        else localStorage.removeItem(PREFIX + flag)
    } catch { /* no-op */ }
}
