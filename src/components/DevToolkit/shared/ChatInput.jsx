import { useState, useCallback } from 'react'
import { SendHorizontal } from 'lucide-react'

export function ChatInput({ placeholder = 'Refine...', onSubmit, disabled }) {
    const [value, setValue] = useState('')

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

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className="flex-1 px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:opacity-50 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
            />
            <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className="p-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Send"
            >
                <SendHorizontal className="w-4 h-4" />
            </button>
        </div>
    )
}
