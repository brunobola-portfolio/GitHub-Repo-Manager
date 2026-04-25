/**
 * Lightweight recents tracker for the command palette. Persists the last 5
 * actions of each kind in localStorage (keyed) so the palette can surface a
 * "Recent" group when the input is empty.
 *
 * Pure DOM-free helpers — the palette wires the side-effects.
 *
 * @typedef {object} RecentEntry
 * @property {'view' | 'repo'} kind
 * @property {string} id              — unique identifier (view name or repo full_name)
 * @property {string} label           — human-readable label
 * @property {number} ts              — Date.now() of the last bump
 */

const STORAGE_KEY = 'cmdk:recents:v1'
const MAX_PER_KIND = 5

function safeParse(raw) {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

/**
 * Read the current recents list. Newest first.
 * @returns {RecentEntry[]}
 */
export function readRecents() {
    if (typeof window === 'undefined' || !window.localStorage) return []
    try {
        return safeParse(window.localStorage.getItem(STORAGE_KEY))
    } catch {
        return []
    }
}

/**
 * Bump an entry to the top of the list. Caps each kind to MAX_PER_KIND.
 * @param {Omit<RecentEntry, 'ts'>} entry
 * @returns {RecentEntry[]} new list (newest first)
 */
export function bumpRecent(entry) {
    if (!entry || !entry.kind || !entry.id || !entry.label) return readRecents()
    const now = Date.now()
    const existing = readRecents().filter(e => !(e.kind === entry.kind && e.id === entry.id))
    const next = [{ ...entry, ts: now }, ...existing]

    // Trim per-kind so a noisy kind can't crowd out the others.
    const byKind = new Map()
    const trimmed = []
    for (const e of next) {
        const count = byKind.get(e.kind) || 0
        if (count >= MAX_PER_KIND) continue
        byKind.set(e.kind, count + 1)
        trimmed.push(e)
    }

    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
        } catch {
            // localStorage full or denied — recents stay best-effort
        }
    }
    return trimmed
}

/**
 * Clear all recents. Mostly for tests / settings.
 */
export function clearRecents() {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
        window.localStorage.removeItem(STORAGE_KEY)
    } catch {
        // ignore
    }
}

export const RECENTS_STORAGE_KEY = STORAGE_KEY
export const RECENTS_MAX_PER_KIND = MAX_PER_KIND
