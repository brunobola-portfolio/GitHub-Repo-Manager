import { useCallback, useEffect, useState } from 'react'

const KEY = 'diffview:preferences'
const ALLOWED_TAB_WIDTHS = [1, 2, 4, 8]

export const DEFAULTS = Object.freeze({
    mode: 'unified', // 'unified' | 'split'
    wrap: false,
    tabWidth: 4,
})

function readStorage() {
    if (typeof window === 'undefined') return DEFAULTS
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return DEFAULTS
        const parsed = JSON.parse(raw)
        return {
            mode: parsed.mode === 'split' ? 'split' : 'unified',
            wrap: !!parsed.wrap,
            tabWidth: ALLOWED_TAB_WIDTHS.includes(parsed.tabWidth) ? parsed.tabWidth : DEFAULTS.tabWidth,
        }
    } catch { return DEFAULTS }
}

function writeStorage(prefs) {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* quota — silent */ }
}

export function useDiffPreferences() {
    const [prefs, setPrefs] = useState(readStorage)

    useEffect(() => { writeStorage(prefs) }, [prefs])

    const setMode = useCallback((mode) => {
        setPrefs(p => ({ ...p, mode: mode === 'split' ? 'split' : 'unified' }))
    }, [])

    const setWrap = useCallback((wrap) => {
        setPrefs(p => ({ ...p, wrap: !!wrap }))
    }, [])

    const setTabWidth = useCallback((tabWidth) => {
        if (!ALLOWED_TAB_WIDTHS.includes(tabWidth)) return
        setPrefs(p => ({ ...p, tabWidth }))
    }, [])

    return { prefs, setMode, setWrap, setTabWidth }
}
