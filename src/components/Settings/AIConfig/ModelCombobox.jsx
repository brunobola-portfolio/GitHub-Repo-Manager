import { useEffect, useMemo, useRef, useState, useId } from 'react'
import { ChevronDown, Check, ExternalLink } from 'lucide-react'
import { TIER_LABELS, TIER_STYLES } from '../../../utils/providerModels'
import { getPricingForModel, formatPricing } from '../../../utils/providerPricing'
import { INPUT_CLS } from './constants'

/**
 * ModelCombobox — typeable input with a curated model picker.
 *
 * - Free-type: users can enter any model id (critical for OpenRouter / Local).
 * - Curated list: clicking the chevron (or ArrowDown when focused) opens a
 *   dropdown of recommended models with tier badge, context window and
 *   per-model pricing hint.
 * - Filter: typing narrows the visible list; an "Use custom: X" hint
 *   appears when the typed value doesn't match any catalogue entry.
 * - Keyboard: ArrowUp/Down navigates, Enter selects, Esc closes.
 *
 * If `options` is empty (e.g. Local provider), the component degrades to a
 * plain text input with no dropdown — no empty state.
 */
export function ModelCombobox({
    id,
    value,
    onChange,
    options = [],
    placeholder,
    catalogueHref,
    catalogueLabel,
    'aria-describedby': ariaDescribedBy,
}) {
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(-1)
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    const listRef = useRef(null)
    const listboxId = useId()

    const hasOptions = options.length > 0

    const filtered = useMemo(() => {
        const q = (value || '').trim().toLowerCase()
        if (!q) return options
        return options.filter((o) =>
            o.id.toLowerCase().includes(q) ||
            (o.label || '').toLowerCase().includes(q) ||
            (o.description || '').toLowerCase().includes(q),
        )
    }, [value, options])

    const exactMatch = useMemo(
        () => options.some((o) => o.id === value),
        [value, options],
    )

    useEffect(() => {
        if (!open) return
        const onDown = (ev) => {
            if (!rootRef.current?.contains(ev.target)) setOpen(false)
        }
        window.addEventListener('mousedown', onDown)
        return () => window.removeEventListener('mousedown', onDown)
    }, [open])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset highlight when the dropdown closes
        if (!open) setHighlight(-1)
    }, [open])

    useEffect(() => {
        if (highlight < 0) return
        const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`)
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' })
        }
    }, [highlight])

    const pickIndex = (idx) => {
        const opt = filtered[idx]
        if (!opt) return
        onChange(opt.id)
        setOpen(false)
        setHighlight(-1)
        inputRef.current?.focus()
    }

    const onKeyDown = (e) => {
        if (!hasOptions) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(filtered.length - 1, (h < 0 ? 0 : h + 1)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.max(0, (h < 0 ? 0 : h - 1)))
        } else if (e.key === 'Enter') {
            if (open && highlight >= 0) {
                e.preventDefault()
                pickIndex(highlight)
            }
        } else if (e.key === 'Escape') {
            if (open) {
                e.preventDefault()
                setOpen(false)
                setHighlight(-1)
            }
        } else if (e.key === 'Tab') {
            setOpen(false)
        }
    }

    if (!hasOptions) {
        return (
            <input
                id={id}
                ref={inputRef}
                type="text"
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={INPUT_CLS}
                aria-describedby={ariaDescribedBy}
            />
        )
    }

    return (
        <div ref={rootRef} className="relative">
            <div className="relative">
                <input
                    id={id}
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    value={value ?? ''}
                    onChange={(e) => {
                        onChange(e.target.value)
                        setOpen(true)
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    className={`${INPUT_CLS} pr-9`}
                    aria-describedby={ariaDescribedBy}
                    autoComplete="off"
                />
                <button
                    type="button"
                    onClick={() => {
                        setOpen((v) => !v)
                        inputRef.current?.focus()
                    }}
                    aria-label={open ? 'Close model list' : 'Open model list'}
                    tabIndex={-1}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
            </div>

            {open && (
                <div
                    id={listboxId}
                    role="listbox"
                    ref={listRef}
                    className="absolute z-20 mt-1 left-0 right-0 max-h-80 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 custom-scrollbar"
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                            No match. <span className="text-slate-700 dark:text-slate-200 font-medium">Enter</span> to use custom id.
                        </div>
                    ) : (
                        filtered.map((opt, idx) => {
                            const selected = value === opt.id
                            const tierStyle = TIER_STYLES[opt.tier] || TIER_STYLES.balanced
                            const pricing = getPricingForModel(opt.id)
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    data-idx={idx}
                                    onMouseEnter={() => setHighlight(idx)}
                                    onClick={() => pickIndex(idx)}
                                    className={`w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
                                        highlight === idx
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{opt.label}</span>
                                            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full ring-1 ring-inset ${tierStyle}`}>
                                                {TIER_LABELS[opt.tier] || opt.tier}
                                            </span>
                                            {opt.context && (
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700">
                                                    {opt.context}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                                            {opt.description}
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                                            <span className="truncate">{opt.id}</span>
                                            {pricing && (
                                                <span className="text-slate-500 dark:text-slate-400">· {formatPricing(pricing)}</span>
                                            )}
                                        </div>
                                    </div>
                                    {selected && <Check className="w-4 h-4 text-indigo-500 mt-1 shrink-0" aria-hidden="true" />}
                                </button>
                            )
                        })
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
            )}

            {value && !exactMatch && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Using custom model id — not in suggested list.
                </p>
            )}
        </div>
    )
}
