import { useSyncExternalStore } from 'react'

function getSnapshot() {
    try {
        return [
            localStorage.getItem('ai-promo-dismissed') ?? '',
            localStorage.getItem('ai-assistant-opened-count') ?? '',
            localStorage.getItem('ai-insights-viewed') ?? '',
        ].join('|')
    } catch {
        return ''
    }
}

function subscribe(callback) {
    window.addEventListener('storage', callback)
    return () => window.removeEventListener('storage', callback)
}

export function useAIPromoVisibility({ reposCount }) {
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    if (reposCount === 0) return false

    try {
        if (localStorage.getItem('ai-promo-dismissed') === 'true') return false
        if (localStorage.getItem('ai-insights-viewed') === 'true') return false
        const count = parseInt(localStorage.getItem('ai-assistant-opened-count') ?? '0', 10)
        if (Number.isFinite(count) && count >= 3) return false
    } catch {
        return true
    }

    return true
}
