import { forwardRef, useEffect, useId, useRef } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Checkbox — premium checkbox primitive.
 *
 * Single source of truth for `<input type="checkbox">` (replaces the 30
 * bespoke checkboxes scattered across Settings/RepoDetail/MigrationWizard —
 * 20 of which rendered browser-default blue because `@tailwindcss/forms`
 * is not installed, so `text-*` on a checkbox is dead CSS). Colour comes
 * from `accent-*`, which the UA honours natively.
 *
 *   <Checkbox checked={draft} onChange={setDraft} label="Create as draft" />
 *
 *   <Checkbox
 *     checked={rules.requirePR}
 *     onChange={(checked) => setRules(r => ({ ...r, requirePR: checked }))}
 *     label="Require pull request reviews before merging"
 *   />
 */
const SIZE_CLS = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
}

export const Checkbox = forwardRef(function Checkbox(
    {
        label,
        description,
        size = 'md',
        indeterminate = false,
        disabled = false,
        className = '',
        id: idProp,
        ...rest
    },
    ref,
) {
    const reactId = useId()
    const id = idProp ?? reactId
    const innerRef = useRef(null)

    useEffect(() => {
        if (innerRef.current) innerRef.current.indeterminate = indeterminate
    }, [indeterminate])

    const setRefs = (node) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
    }

    const input = (
        <input
            ref={setRefs}
            type="checkbox"
            id={id}
            disabled={disabled}
            className={twMerge(
                SIZE_CLS[size] || SIZE_CLS.md,
                'rounded accent-brand-600 ds-focus-ring disabled:opacity-50 disabled:cursor-not-allowed',
                className,
            )}
            {...rest}
        />
    )

    if (!label && !description) return input

    return (
        <label
            htmlFor={id}
            className={`flex items-start gap-2 select-none ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
            {input}
            <span className="min-w-0 flex-1">
                {label && <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>}
                {description && (
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
                )}
            </span>
        </label>
    )
})
