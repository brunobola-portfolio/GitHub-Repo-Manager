// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'

/**
 * useDraftPersistence — Linear-grade textarea drafts that survive accidental
 * tab-closes / modal-dismissals. Persists to localStorage under a stable key
 * derived from the resource (e.g. PR or issue). Cleared explicitly via the
 * returned `clear()` (call after a successful submit).
 *
 * Defensive against quota errors (private mode, full storage) — silently
 * disables persistence rather than throwing into render.
 *
 * Retention: abandoned drafts used to live forever (typed text + closed tab =
 * a key nothing ever removed, creeping toward the ~5MB origin quota). Draft
 * values stay plain strings — timestamps live in ONE sibling index key
 * (`draft:_meta`, key → savedAt ms) so the stored format never changes. The
 * first hook mount per session sweeps entries older than DRAFT_TTL_MS and
 * adopts legacy pre-timestamp drafts into the index so they age out too.
 *
 * @param {string} key — localStorage key (caller responsibility to namespace)
 * @param {string} [initial=''] — initial body when nothing in storage
 *
 * Usage:
 *   const { value, setValue, clear } = useDraftPersistence(
 *     `draft:pr-comment:${repo}:${pr}`,
 *   )
 */

const META_KEY = 'draft:_meta'
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, matching pr-review-* TTL

function readMeta() {
    try {
        return JSON.parse(window.localStorage.getItem(META_KEY)) || {}
    } catch {
        return {}
    }
}

function writeMeta(meta) {
    try {
        window.localStorage.setItem(META_KEY, JSON.stringify(meta))
    } catch {
        // quota/private mode — retention degrades gracefully, drafts still work
    }
}

function touchMeta(key) {
    const meta = readMeta()
    meta[key] = Date.now()
    writeMeta(meta)
}

function dropMeta(key) {
    const meta = readMeta()
    if (key in meta) {
        delete meta[key]
        writeMeta(meta)
    }
}

let sweptThisSession = false
function sweepStaleDrafts() {
    if (sweptThisSession) return
    sweptThisSession = true
    try {
        const meta = readMeta()
        const now = Date.now()
        let changed = false
        for (const [k, savedAt] of Object.entries(meta)) {
            const stale = now - savedAt > DRAFT_TTL_MS
            const exists = window.localStorage.getItem(k) != null
            if (stale && exists) window.localStorage.removeItem(k)
            if (stale || !exists) {
                delete meta[k]
                changed = true
            }
        }
        // Drafts written before the meta index existed: adopt them now so they
        // age out from today instead of living forever. Enumerate via
        // length/key() with an Object.keys fallback (some DOM implementations —
        // happy-dom in tests — don't back the indexed accessor).
        let allKeys = []
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i)
            if (k != null) allKeys.push(k)
        }
        if (allKeys.length === 0) allKeys = Object.keys(window.localStorage)
        for (const k of allKeys) {
            if (k && k.startsWith('draft:') && k !== META_KEY && !(k in meta)) {
                meta[k] = now
                changed = true
            }
        }
        if (changed) writeMeta(meta)
    } catch {
        // private mode / storage disabled — nothing to sweep
    }
}

// Test seam: allows re-running the once-per-session sweep in unit tests.
export function __resetDraftSweepForTests() {
    sweptThisSession = false
}
export function useDraftPersistence(key, initial = '') {
    const [value, setValue] = useState(() => {
        if (!key || typeof window === 'undefined' || !window.localStorage) return initial
        try {
            const stored = window.localStorage.getItem(key)
            return stored ?? initial
        } catch {
            return initial
        }
    })

    const hadInitialKeyRef = useRef(key)

    // Once per session, age out abandoned drafts before we add new ones.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.localStorage) return
        sweepStaleDrafts()
    }, [])

    // Persist on every change — debounced via the natural React render
    // cadence; no need for an explicit timer for this small payload.
    useEffect(() => {
        if (!key || typeof window === 'undefined' || !window.localStorage) return
        try {
            if (value && value.length > 0) {
                window.localStorage.setItem(key, value)
                touchMeta(key)
            } else {
                window.localStorage.removeItem(key)
                dropMeta(key)
            }
        } catch {
            // QuotaExceededError or SecurityError in private mode — silent.
        }
    }, [key, value])

    // Reset value when the key changes (caller switched between PRs/issues)
    useEffect(() => {
        if (hadInitialKeyRef.current === key) return
        hadInitialKeyRef.current = key
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setValue(window.localStorage.getItem(key) ?? '')
        } catch {
             
            setValue('')
        }
    }, [key])

    const clear = () => {
        setValue('')
        try {
            if (key) {
                window.localStorage.removeItem(key)
                dropMeta(key)
            }
        } catch {
            // ignore
        }
    }

    return { value, setValue, clear }
}
