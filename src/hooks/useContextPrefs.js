import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ai-context-prefs-v1'

export const DEFAULT_SIGNALS = Object.freeze({
    readme: true,
    manifest: true,
    entrypoints: false,
    folderStructure: false,
    topics: true,
    language: true,
})

const DEFAULT_PREFS = Object.freeze({ signals: DEFAULT_SIGNALS })

function readFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return DEFAULT_PREFS
        const parsed = JSON.parse(raw)
        const signals = { ...DEFAULT_SIGNALS, ...(parsed?.signals || {}) }
        return { signals }
    } catch {
        return DEFAULT_PREFS
    }
}

function writeToStorage(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
        // ignore quota / disabled-storage errors
    }
}

export function useContextPrefs() {
    const [prefs, setPrefs] = useState(() => readFromStorage())

    useEffect(() => {
        writeToStorage(prefs)
    }, [prefs])

    const setSignal = useCallback((kind, value) => {
        setPrefs((prev) => ({ ...prev, signals: { ...prev.signals, [kind]: !!value } }))
    }, [])

    const reset = useCallback(() => setPrefs({ signals: DEFAULT_SIGNALS }), [])

    return { prefs, setSignal, reset }
}
