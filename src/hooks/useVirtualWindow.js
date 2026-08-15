/*
 * GitHub Repo Manager
 * Dependency-free fixed-row-height virtualization for page-scrolled lists.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { useState, useLayoutEffect, useRef, useCallback } from 'react'

/**
 * Pure range math — exported separately so it can be unit tested without
 * touching the DOM. Given how far the list's top edge has scrolled past the
 * viewport top (`scrollOffset`) and the viewport height, returns the
 * `[start, end)` slice of `count` fixed-height rows that should be mounted,
 * padded by `overscan` rows on each side so fast scrolling and keyboard
 * navigation don't outrun the mounted window.
 *
 * @param {object} args
 * @param {number} args.scrollOffset - px the list's top edge has scrolled above the viewport top (>= 0)
 * @param {number} args.viewportHeight - px of visible viewport
 * @param {number} args.itemHeight - fixed px height of each row (including any inter-row gap)
 * @param {number} args.count - total number of rows
 * @param {number} [args.overscan] - extra rows to keep mounted beyond each edge
 * @returns {{start: number, end: number}} half-open row index range
 */
export function computeVirtualRange({ scrollOffset, viewportHeight, itemHeight, count, overscan = 6 }) {
    if (!count || count <= 0 || !itemHeight || itemHeight <= 0) return { start: 0, end: 0 }
    const safeOffset = Math.max(0, scrollOffset || 0)
    const safeViewport = Math.max(0, viewportHeight || 0)

    const rawStart = Math.floor(safeOffset / itemHeight)
    const rawEnd = Math.ceil((safeOffset + safeViewport) / itemHeight)

    const start = Math.max(0, rawStart - overscan)
    const end = Math.min(count, Math.max(rawStart, rawEnd) + overscan)

    return { start, end: Math.max(start, end) }
}

/**
 * Windows a fixed-height, single-column list that scrolls with the page
 * (no inner `overflow-y: auto` pane) rather than a bounded scroll container
 * — matches how RepoGrid's list view sits directly in the page flow.
 *
 * Usage: attach `containerRef` to the list's outer wrapper, size an inner
 * spacer to `totalHeight`, and translate the mounted slice down by
 * `offsetTop`. Only rows in `[start, end)` should be rendered.
 *
 * Recalculates on scroll (rAF-throttled), window resize, and whenever
 * `count` changes (e.g. a filter narrows the result set).
 *
 * @param {object} args
 * @param {number} args.count
 * @param {number} args.itemHeight - fixed px row height, gap included
 * @param {number} [args.overscan]
 * @param {boolean} [args.enabled] - when false, the hook is a no-op that reports the full range (used to skip virtualization below a row-count threshold)
 */
export function useVirtualWindow({ count, itemHeight, overscan = 6, enabled = true }) {
    const containerRef = useRef(null)
    const [range, setRange] = useState({ start: 0, end: 0 })

    const recalc = useCallback(() => {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
        // Rows above the viewport top count toward the scrolled-past offset;
        // a list whose top hasn't reached the viewport top yet clamps to 0.
        const scrollOffset = Math.max(0, -rect.top)
        const next = computeVirtualRange({ scrollOffset, viewportHeight, itemHeight, count, overscan })
        setRange(prev => (prev.start === next.start && prev.end === next.end) ? prev : next)
    }, [count, itemHeight, overscan])

    // useLayoutEffect (not useEffect): the initial range starts at {0,0}, and
    // running the first measurement synchronously before paint avoids a
    // one-frame flash of an empty list when a filter first crosses the
    // virtualization threshold. `recalc`'s own deps (count/itemHeight/overscan)
    // re-run this effect whenever they change, so a narrowed filter or a
    // resized row re-measures without needing those listed here directly.
    useLayoutEffect(() => {
        if (!enabled) return undefined
        recalc()
        let raf = null
        const onScrollOrResize = () => {
            if (raf) return
            raf = requestAnimationFrame(() => { raf = null; recalc() })
        }
        window.addEventListener('scroll', onScrollOrResize, { passive: true })
        window.addEventListener('resize', onScrollOrResize)
        return () => {
            window.removeEventListener('scroll', onScrollOrResize)
            window.removeEventListener('resize', onScrollOrResize)
            if (raf) cancelAnimationFrame(raf)
        }
    }, [enabled, recalc])

    // Disabled means "render everything" — used below the virtualization
    // threshold, where the caller wants the plain, unwindowed render path.
    const effectiveRange = enabled ? range : { start: 0, end: count }

    return {
        containerRef,
        start: effectiveRange.start,
        end: effectiveRange.end,
        totalHeight: count * itemHeight,
        offsetTop: effectiveRange.start * itemHeight,
    }
}
