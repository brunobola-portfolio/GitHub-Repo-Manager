/*
 * GitHub Repo Manager
 * Post-migration AI Polish hook — batch description suggestions + apply
 *
 * Phase A scope: description-only. Topics + README columns ship in a
 * follow-up. See docs/specs/2026-05-08-post-migration-ai-polish.md.
 *
 * Per-row state machine:
 *   idle → loading → ready ↔ editing → applying → done
 *                                              ↘ error → ready (retry)
 *
 * Concurrency is capped to keep the AI quota humane and to give the UI a
 * staggered "row arriving" feel rather than a thundering herd.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiApi } from '../api/ai'
import { reposApi } from '../api/repos'
import { apiCall } from '../utils/api'

const CONCURRENCY = 3

/**
 * @typedef {Object} PolishRow
 * @property {string} fullName       owner/repo
 * @property {number|null} repoId    GitHub numeric id (resolved before suggestion)
 * @property {string} owner
 * @property {string} repo
 * @property {string} currentDescription
 * @property {string} proposedDescription
 * @property {boolean} include       row participates in apply (default true)
 * @property {boolean} edited        user has edited the proposal manually
 * @property {'idle'|'resolving'|'loading'|'ready'|'applying'|'done'|'error'|'quota'} status
 * @property {string|null} error
 * @property {'high'|'medium'|'low'|null} confidence  AI confidence from the suggestion response
 */

function makeInitialRow(fullName) {
    const [owner, repo] = fullName.split('/')
    return {
        fullName,
        repoId: null,
        owner: owner || '',
        repo: repo || '',
        currentDescription: '',
        proposedDescription: '',
        include: true,
        edited: false,
        status: 'idle',
        error: null,
        confidence: null,
    }
}

/**
 * Run an array of async tasks with bounded concurrency.
 * Resolves once every task settles. Each task receives the full results
 * map by reference so the caller can stream UI updates as they arrive.
 */
async function runWithLimit(items, limit, worker) {
    let cursor = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const idx = cursor++
            await worker(items[idx], idx)
        }
    })
    await Promise.all(runners)
}

/**
 * @param {string[]} repoFullNames
 * @param {Object|null} contextOptions  Optional context payload forwarded to the AI
 *                                      endpoint (signals, customFiles, etc.).
 */
export function useAIPolish(repoFullNames, contextOptions = null) {
    const [rows, setRows] = useState(() =>
        (Array.isArray(repoFullNames) ? repoFullNames : []).map(makeInitialRow),
    )
    const [phase, setPhase] = useState('idle') // 'idle' | 'loading' | 'ready' | 'applying' | 'done'
    const [quotaHit, setQuotaHit] = useState(false)
    const startedRef = useRef(false)
    // Mirror of quotaHit so the concurrent batch runner can short-circuit
    // immediately when any row trips a 429 — closure-captured `quotaHit`
    // would be stale until the next render.
    const quotaHitRef = useRef(false)
    // Stabilize contextOptions so fetchSuggestion's identity doesn't change
    // when the caller re-renders with a new object literal. Each row's API
    // call reads .current at call time, so it always uses the latest prefs
    // without causing the useEffect to re-run and abort in-flight rows.
    const contextOptionsRef = useRef(contextOptions)
    useEffect(() => {
        contextOptionsRef.current = contextOptions
    }, [contextOptions])

    const updateRow = useCallback((fullName, patch) => {
        setRows(prev => prev.map(r =>
            r.fullName === fullName ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r,
        ))
    }, [])

    /**
     * Resolves repo id + current description for a row, then asks AI for a
     * description suggestion. Stops issuing further suggestions once any row
     * hits 429 — the remaining rows fall to 'quota' state without burning
     * additional quota. Per-row failures don't poison sibling rows.
     */
    const fetchSuggestion = useCallback(async (row, abortSignal) => {
        if (abortSignal?.aborted) return
        updateRow(row.fullName, { status: 'resolving' })
        try {
            const repoMeta = await apiCall(`/api/repos/${row.owner}/${row.repo}`)
            if (abortSignal?.aborted) return
            updateRow(row.fullName, {
                repoId: repoMeta?.id ?? null,
                currentDescription: repoMeta?.description || '',
                status: 'loading',
            })
        } catch (e) {
            updateRow(row.fullName, { status: 'error', error: e?.message || 'Failed to load repo' })
            return
        }

        // Re-read the latest row to get repoId
        const latest = await new Promise(resolve => {
            setRows(prev => {
                resolve(prev.find(r => r.fullName === row.fullName))
                return prev
            })
        })
        if (!latest?.repoId) {
            updateRow(row.fullName, { status: 'error', error: 'Could not resolve repo id' })
            return
        }

        try {
            const ctxOpts = contextOptionsRef.current
            const suggestion = await aiApi.polish.getDescription(
                latest.repoId,
                ctxOpts ? { context: ctxOpts } : {},
            )
            if (abortSignal?.aborted) return
            const proposed = suggestion?.proposed?.description ?? suggestion?.description ?? ''
            updateRow(row.fullName, {
                proposedDescription: proposed,
                status: 'ready',
                confidence: suggestion?.confidence ?? null,
            })
        } catch (e) {
            if (e?.status === 429 || e?.tierError) {
                quotaHitRef.current = true
                setQuotaHit(true)
                updateRow(row.fullName, { status: 'quota', error: 'AI quota exceeded' })
                return
            }
            updateRow(row.fullName, { status: 'error', error: e?.friendlyMessage || e?.message || 'AI suggestion failed' })
        }
    }, [updateRow])

    // Kick off batch generation on mount. We key on the joined full-name list
    // so a parent passing a fresh array every render doesn't restart the batch
    // — only an actual list change does.
    const fullNameKey = useMemo(() => (repoFullNames || []).join(','), [repoFullNames])
    useEffect(() => {
        if (startedRef.current) return
        if (!fullNameKey) return
        startedRef.current = true
        const controller = new AbortController()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase('loading')

        ;(async () => {
            const initial = fullNameKey.split(',').filter(Boolean).map(makeInitialRow)
            await runWithLimit(initial, CONCURRENCY, async (row) => {
                if (controller.signal.aborted) return
                if (quotaHitRef.current) {
                    updateRow(row.fullName, { status: 'quota' })
                    return
                }
                await fetchSuggestion(row, controller.signal)
            })
            if (!controller.signal.aborted) setPhase('ready')
        })()

        return () => controller.abort()
    }, [fullNameKey, fetchSuggestion, updateRow])

    const setProposedDescription = useCallback((fullName, value) => {
        updateRow(fullName, { proposedDescription: value, edited: true })
    }, [updateRow])

    const toggleInclude = useCallback((fullName) => {
        updateRow(fullName, prev => ({ include: !prev.include }))
    }, [updateRow])

    const retryRow = useCallback((fullName) => {
        const row = rows.find(r => r.fullName === fullName)
        if (!row) return
        // Reset error and retry
        updateRow(fullName, { status: 'idle', error: null })
        fetchSuggestion(row).catch(() => { /* per-row error already captured */ })
    }, [rows, fetchSuggestion, updateRow])

    /**
     * Apply the proposed descriptions for rows that are `ready`/`editing`,
     * `include === true`, and have a non-empty proposal that differs from
     * the current value.
     */
    const apply = useCallback(async (onPatched) => {
        const targets = rows.filter(r =>
            r.include
            && (r.status === 'ready')
            && r.proposedDescription
            && r.proposedDescription !== r.currentDescription,
        )
        if (targets.length === 0) return { applied: 0, failed: 0 }

        setPhase('applying')
        let applied = 0
        let failed = 0
        await runWithLimit(targets, CONCURRENCY, async (row) => {
            updateRow(row.fullName, { status: 'applying' })
            try {
                const result = await reposApi.updateRepo(row.owner, row.repo, { description: row.proposedDescription })
                const updated = result?.data || result || { description: row.proposedDescription }
                updateRow(row.fullName, { status: 'done', currentDescription: row.proposedDescription, error: null })
                applied += 1
                if (typeof onPatched === 'function') {
                    onPatched({ full_name: row.fullName, ...updated })
                }
            } catch (e) {
                updateRow(row.fullName, { status: 'error', error: e?.friendlyMessage || e?.message || 'Apply failed' })
                failed += 1
            }
        })
        setPhase('done')
        return { applied, failed }
    }, [rows, updateRow])

    const stats = useMemo(() => ({
        total: rows.length,
        ready: rows.filter(r => r.status === 'ready').length,
        loading: rows.filter(r => r.status === 'loading' || r.status === 'resolving').length,
        applying: rows.filter(r => r.status === 'applying').length,
        done: rows.filter(r => r.status === 'done').length,
        error: rows.filter(r => r.status === 'error').length,
        quota: rows.filter(r => r.status === 'quota').length,
        includedReady: rows.filter(r =>
            r.include
            && r.status === 'ready'
            && r.proposedDescription
            && r.proposedDescription !== r.currentDescription,
        ).length,
    }), [rows])

    return {
        rows,
        phase,
        stats,
        quotaHit,
        setProposedDescription,
        toggleInclude,
        retryRow,
        apply,
    }
}
