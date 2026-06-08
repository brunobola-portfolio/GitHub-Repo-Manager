import { useEffect, useMemo, useRef, useState, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { ModelDropdown } from './ModelDropdown'
import { useFilteredModels } from '../../../hooks/useFilteredModels'
import { INPUT_CLS } from './constants'

/**
 * Typeable input + curated model picker.
 *
 * Owns: input value, open/close, keyboard nav highlight. Delegates listbox UI
 * (chip filter, section headers, row cards, legacy toggle) to ModelDropdown.
 *
 * Keyboard nav uses the dropdown's `itemsInOrder` so ArrowDown/Up skip section
 * headers and respect the active tier filter — this is re-derived here via a
 * lightweight call to useFilteredModels with the same defaults the dropdown
 * initialises with (no chip filter, no legacy). The dropdown's own state is
 * the source of truth once the user interacts; for keyboard nav from the
 * input we only need an order that matches the *initial* render.
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

    // Mirror the dropdown's default filter (no chip, no legacy) so keyboard nav
    // operates on the same ordered set the user sees on open.
    const { itemsInOrder } = useFilteredModels(options, { query: value, tier: null, showLegacy: false })

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
        const opt = itemsInOrder[idx]
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
            setHighlight((h) => Math.min(itemsInOrder.length - 1, (h < 0 ? 0 : h + 1)))
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

    const exactMatch = useMemo(
        () => options.some((o) => o.id === value),
        [value, options],
    )

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
                    aria-activedescendant={open && highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
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
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700/50 transition-colors"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
            </div>

            {open && (
                <ModelDropdown
                    options={options}
                    value={value}
                    onPick={{
                        select: (modelId) => {
                            onChange(modelId)
                            setOpen(false)
                            setHighlight(-1)
                            inputRef.current?.focus()
                        },
                        hover: (idx) => setHighlight(idx),
                    }}
                    listboxId={listboxId}
                    listRef={listRef}
                    query={value || ''}
                    highlight={highlight}
                    catalogueHref={catalogueHref}
                    catalogueLabel={catalogueLabel}
                />
            )}

            {value && !exactMatch && (
                <p className="mt-1 ds-text-meta text-slate-500 dark:text-slate-400">
                    Using custom model id — not in suggested list.
                </p>
            )}
        </div>
    )
}
