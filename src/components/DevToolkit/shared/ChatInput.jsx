import { useState, useCallback, useRef, useEffect } from 'react'
import { SendHorizontal } from 'lucide-react'

export function ChatInput({ placeholder = 'Refine...', onSubmit, disabled }) {
    const [value, setValue] = useState('')
    const textareaRef = useRef(null)

    const handleSubmit = useCallback(() => {
        const trimmed = value.trim()
        if (!trimmed || disabled) return
        onSubmit(trimmed)
        setValue('')
    }, [value, disabled, onSubmit])

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit])

    // Auto-resize textarea to content
    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }, [value])

    return (
        <div className="flex items-end gap-2">
            <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                aria-label="Message or refinement input"
                className="flex-1 px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl ds-focus-ring focus-visible:border-indigo-500 disabled:opacity-50 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all resize-none overflow-hidden"
            />
            <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className="p-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label="Send"
            >
                <SendHorizontal className="w-4 h-4" />
            </button>
        </div>
    )
}
