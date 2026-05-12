import { useState } from 'react'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { ModelRow } from './ModelRow'
import { ModelSectionHeader } from './ModelSectionHeader'
import { TierFilterChips } from './TierFilterChips'
import { useFilteredModels } from '../../../hooks/useFilteredModels'

/**
 * The full open dropdown panel for the model picker. Owns:
 *   - the active tier chip filter
 *   - the show-legacy toggle (local state — resets on close)
 *   - section rendering
 *   - the empty / catalogue-link footer
 *
 * `onPick` is `{ select(id), hover(idx) }`. The parent owns keyboard nav and
 * passes `highlight` (the current highlighted index in `itemsInOrder`).
 */
export function ModelDropdown({
    options,
    value,
    onPick,
    listboxId,
    listRef,
    query,
    highlight,
    catalogueHref,
    catalogueLabel,
}) {
    const [activeTier, setActiveTier] = useState(null)
    const [showLegacy, setShowLegacy] = useState(false)

    const { sections, itemsInOrder, totalCount, availableTiers } = useFilteredModels(
        options,
        { query, tier: activeTier, showLegacy },
    )

    const legacyCount = options.filter((o) => o.legacy).length

    // Map option.id → index in itemsInOrder so each row knows its keyboard idx.
    const idxById = new Map(itemsInOrder.map((o, i) => [o.id, i]))

    return (
        <div
            id={listboxId}
            role="listbox"
            ref={listRef}
            className="absolute z-[var(--ds-z-floating)] mt-1 left-0 right-0 max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 ds-scrollbar"
        >
            <TierFilterChips
                availableTiers={availableTiers}
                activeTier={activeTier}
                onChange={setActiveTier}
                totalCount={totalCount}
            />

            {sections.length === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-500 dark:text-slate-400">
                    {activeTier
                        ? <>No models in this tier. <button type="button" onClick={() => setActiveTier(null)} className="text-indigo-600 dark:text-indigo-300 hover:underline">Clear filter</button>.</>
                        : <>No match. Press <span className="text-slate-700 dark:text-slate-200 font-medium">Enter</span> to use custom id.</>}
                </div>
            ) : (
                sections.map((section, sIdx) => (
                    <div key={section.tier}>
                        <ModelSectionHeader tier={section.tier} isFirst={sIdx === 0} />
                        {section.items.map((opt) => {
                            const idx = idxById.get(opt.id) ?? -1
                            return (
                                <ModelRow
                                    key={opt.id}
                                    option={opt}
                                    selected={value === opt.id}
                                    highlighted={highlight === idx}
                                    dataIdx={idx}
                                    hideTierBadge
                                    onPick={{
                                        select: () => onPick.select(opt.id),
                                        hover: () => onPick.hover(idx),
                                    }}
                                />
                            )
                        })}
                    </div>
                ))
            )}

            {legacyCount > 0 && !showLegacy && (
                <button
                    type="button"
                    onClick={() => setShowLegacy(true)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/70 border-t border-slate-100 dark:border-slate-800"
                >
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    Show {legacyCount} legacy model{legacyCount === 1 ? '' : 's'}
                </button>
            )}

            {catalogueHref && (
                <a
                    href={catalogueHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sticky bottom-0 bg-slate-50 dark:bg-slate-900/90 backdrop-blur border-t border-slate-200 dark:border-slate-700 px-3 py-2 text-xs flex items-center justify-between text-indigo-600 dark:text-indigo-300 hover:underline"
                >
                    <span>{catalogueLabel || 'Browse full catalogue'}</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
            )}
        </div>
    )
}
