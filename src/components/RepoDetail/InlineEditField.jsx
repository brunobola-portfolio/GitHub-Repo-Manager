import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Spinner } from '../ui/Spinner'

const INPUT_CLASSES = 'w-full px-2 py-1 -mx-2 -my-1 rounded-md bg-white dark:bg-slate-800 border border-indigo-400 dark:border-indigo-500 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors'

/**
 * Click-to-edit field used inline in the repo Overview. Hover shows a subtle
 * pencil hint; clicking enters edit mode. Enter / blur saves, Escape cancels.
 * `onSave(value)` should return a promise that rejects on failure — the field
 * stays in edit mode so the user can retry without losing their input.
 */
export function InlineEditField({
    value,
    placeholder,
    ariaLabel,
    type = 'text',
    onSave,
    renderValue,
    disabled = false,
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value || '')
    const [saving, setSaving] = useState(false)
    const inputRef = useRef(null)

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select?.()
        }
    }, [editing])

    const cancel = () => {
        setDraft(value || '')
        setEditing(false)
    }

    const commit = async () => {
        const trimmed = draft.trim()
        if (trimmed === (value || '').trim()) {
            setEditing(false)
            return
        }
        setSaving(true)
        try {
            await onSave(trimmed)
            setEditing(false)
        } catch {
            // keep in edit mode so user can retry
        } finally {
            setSaving(false)
        }
    }

    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            commit()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
        }
    }

    if (editing) {
        return (
            <div className="relative">
                <input
                    ref={inputRef}
                    type={type}
                    value={draft}
                    placeholder={placeholder}
                    disabled={saving}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={commit}
                    aria-label={ariaLabel}
                    className={INPUT_CLASSES}
                />
                {saving && (
                    <Spinner size="sm" tone="primary" className="absolute right-2 top-1/2 -translate-y-1/2" />
                )}
            </div>
        )
    }

    const hasValue = !!(value && String(value).trim())
    const display = hasValue
        ? (renderValue ? renderValue(value) : <span className="text-slate-700 dark:text-slate-300">{value}</span>)
        : <span className="text-slate-400 dark:text-slate-500 italic">{placeholder || 'Add value'}</span>

    const enterEdit = () => {
        if (disabled) return
        setDraft(value || '')
        setEditing(true)
    }
    const onWrapperKey = (e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            enterEdit()
        }
    }

    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onClick={enterEdit}
            onKeyDown={onWrapperKey}
            aria-label={ariaLabel ? `Edit ${ariaLabel}` : undefined}
            aria-disabled={disabled || undefined}
            className={`group w-full flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded-md transition-colors ${disabled ? 'cursor-default' : 'cursor-text hover:bg-slate-100 dark:hover:bg-slate-800/60'} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40`}
        >
            <span className="flex-1 min-w-0 truncate">{display}</span>
            {!disabled && (
                <Pencil className="w-3 h-3 shrink-0 text-slate-400 opacity-60 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100 transition-opacity" aria-hidden="true" />
            )}
        </div>
    )
}
