/**
 * Shared command-palette item builder for the per-entity action registries
 * (repo / pr / issue / branch).
 *
 * Each of the four `build*ActionCommands` functions was a copy of the same
 * loop — filter to `commandPalette` surface, gate on `isApplicable`, resolve
 * dynamic label/description, emit `{ id: 'actionId::key', label, description,
 * run }` — diverging only in: which registry, whether batch-safe actions are
 * skipped, the id key, and the label suffix. This collapses that into one
 * place; the per-entity files become thin wrappers.
 *
 * @template T
 * @param {Record<string, object>} registry  — the action registry (values iterated)
 * @param {T[]} items                          — targets (repos / prs / issues / branches)
 * @param {object} ctx                         — runner context, forwarded to run()/isApplicable()
 * @param {object} opts
 * @param {(item: T) => string|number} opts.keyOf   — unique id suffix per item
 * @param {(item: T) => string} opts.labelOf        — human label suffix per item
 * @param {boolean} [opts.skipBatchSafe=false]      — skip selection-only batch actions
 * @returns {Array<{ id: string, label: string, description: string, run: () => unknown }>}
 */
export function buildActionCommands(registry, items, ctx, { keyOf, labelOf, skipBatchSafe = false }) {
    const out = []
    for (const action of Object.values(registry)) {
        if (!action.surfaces.includes('commandPalette')) continue
        if (skipBatchSafe && action.isBatchSafe) continue
        for (const item of items) {
            // ctx is forwarded for registries whose isApplicable needs it (branch
            // url-shaped actions); the others ignore the extra argument.
            if (action.isApplicable && !action.isApplicable(item, ctx)) continue
            const resolveDyn = (val) => (typeof val === 'function' ? val(item) : val)
            out.push({
                id: `${action.id}::${keyOf(item)}`,
                label: `${resolveDyn(action.label)} — ${labelOf(item)}`,
                description: resolveDyn(action.description),
                run: () => action.run(item, ctx),
            })
        }
    }
    return out
}
