import { useState, useCallback, useRef, useEffect } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Textarea } from '../../ui/form'

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
            <div className="flex-1">
                <Textarea
                    ref={textareaRef}
                    rows={1}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    aria-label="Message or refinement input"
                    className="overflow-hidden py-2"
                />
            </div>
            <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className="p-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label="Send"
            >
                <SendHorizontal className="w-4 h-4" />
            </button>
        </div>
    )
}
