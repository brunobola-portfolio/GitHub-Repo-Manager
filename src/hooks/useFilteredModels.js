import { useMemo } from 'react'
import { TIER_ORDER } from '../utils/providerModels'

/**
 * Group + filter options by tier and free-text query.
 *
 * Returns:
 *   sections        — [{ tier, items }] in TIER_ORDER (only non-empty sections)
 *   itemsInOrder    — flat array matching rendered order, for keyboard nav
 *   totalCount      — items.length across all sections after filtering
 *   availableTiers  — tiers present in the unfiltered (legacy-excluded) data,
 *                     used by the chip bar so it doesn't offer empty tiers
 */
export function useFilteredModels(options, { query, tier, showLegacy }) {
    return useMemo(() => {
        const safeOpts = Array.isArray(options) ? options : []

        // 1. Apply legacy gate first — chip availability is based on this set.
        const visiblePool = safeOpts.filter((o) => showLegacy || !o.legacy)

        // 2. Compute available (non-legacy) tiers for chip bar.
        const availableTiers = TIER_ORDER.filter((t) => t !== 'legacy' && safeOpts.some((o) => !o.legacy && o.tier === t))

        // 3. Filter by tier chip + query.
        const q = (query || '').trim().toLowerCase()
        const matchesQuery = (o) => {
            if (!q) return true
            return (
                (o.id || '').toLowerCase().includes(q)
                || (o.label || '').toLowerCase().includes(q)
                || (o.description || '').toLowerCase().includes(q)
            )
        }
        const filtered = visiblePool.filter((o) => (tier ? o.tier === tier : true)).filter(matchesQuery)

        // 4. Group into sections in canonical order. Items with a tier value
        //    not in TIER_ORDER are skipped — in DEV they log a warning so we
        //    can spot bad data; in production they fail silently rather than
        //    misclassify into a generic bucket.
        const buckets = new Map()
        for (const t of TIER_ORDER) buckets.set(t, [])
        for (const o of filtered) {
            const bucket = buckets.get(o.tier)
            if (!bucket) {
                if (import.meta.env?.DEV) {
                     
                    console.warn(`useFilteredModels: unknown tier "${o.tier}" on model "${o.id}" — skipped`)
                }
                continue
            }
            bucket.push(o)
        }
        const sections = []
        const itemsInOrder = []
        for (const t of TIER_ORDER) {
            const items = buckets.get(t)
            if (items && items.length > 0) {
                sections.push({ tier: t, items })
                for (const o of items) itemsInOrder.push(o)
            }
        }

        return {
            sections,
            itemsInOrder,
            totalCount: itemsInOrder.length,
            availableTiers,
        }
    }, [options, query, tier, showLegacy])
}
