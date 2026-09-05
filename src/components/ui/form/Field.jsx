import { Children, cloneElement, isValidElement, useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { DURATION } from '../motion'

/**
 * Field — composition wrapper for form controls.
 *
 * Renders a label, helper text and error message in a consistent layout,
 * and automatically wires `id` / `aria-describedby` onto the wrapped
 * control. Drop an <Input />, <Textarea />, <Select /> or a native
 * element as the only child.
 *
 *   <Field label="Repository Name" required>
 *     <Input value={name} onChange={...} />
 *   </Field>
 *
 *   <Field label="Description" hint="Shown on the repo header" error={err}>
 *     <Textarea ... />
 *   </Field>
 */
export function Field({
    label,
    hint,
    error,
    success,
    required = false,
    optional = false,
    htmlFor,
    children,
    className = '',
}) {
    const generatedId = useId()
    const controlId = htmlFor ?? generatedId
    const descId = `${controlId}-desc`
    const errorId = `${controlId}-error`

    const showError = !!error
    const showHelper = !showError && (hint || success)

    // Inject id + aria-describedby onto the single child control so
    // consumers don't have to thread them manually.
    const child = isValidElement(Children.only(children))
        ? cloneElement(children, {
            id: children.props.id ?? controlId,
            'aria-describedby': showError
                ? errorId
                : showHelper
                    ? descId
                    : children.props['aria-describedby'],
            ...(showError ? { status: 'error' } : {}),
            ...(success && !showError && !children.props.status ? { status: 'success' } : {}),
        })
        : children

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label
                    htmlFor={controlId}
                    className="ds-text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
                >
                    <span>{label}</span>
                    {required && (
                        <span className="text-rose-500 dark:text-rose-400" aria-hidden="true">
                            *
                        </span>
                    )}
                    {optional && !required && (
                        <span className="ds-text-meta font-normal text-slate-500 dark:text-slate-400">
                            (optional)
                        </span>
                    )}
                </label>
            )}

            {child}

            <AnimatePresence initial={false} mode="wait">
                {showError && (
                    <motion.p
                        key="error"
                        id={errorId}
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: DURATION.fast }}
                        className="text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1.5"
                    >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{error}</span>
                    </motion.p>
                )}
                {showHelper && success && (
                    <motion.p
                        key="success"
                        id={descId}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: DURATION.fast }}
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-400"
                    >
                        {success}
                    </motion.p>
                )}
                {showHelper && !success && hint && (
                    <motion.p
                        key="hint"
                        id={descId}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: DURATION.fast }}
                        className="text-xs text-slate-500 dark:text-slate-400"
                    >
                        {hint}
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    )
}
