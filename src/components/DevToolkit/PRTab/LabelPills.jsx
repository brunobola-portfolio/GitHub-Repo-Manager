import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Input } from '../../ui/form'

export function LabelPills({ labels = [], onRemove, onAdd }) {
    const [adding, setAdding] = useState(false)
    const [input, setInput] = useState('')

    const handleAdd = () => {
        if (input.trim() && !labels.includes(input.trim())) {
            onAdd(input.trim())
            setInput('')
            setAdding(false)
        }
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center">
            {labels.map(label => (
                <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs border border-indigo-200 dark:border-indigo-800">
                    {label}
                    <button type="button" onClick={() => onRemove(label)} className="hover:text-red-500 transition-colors" aria-label={`Remove ${label}`}>
                        <X className="w-2.5 h-2.5" />
                    </button>
                </span>
            ))}
            {adding ? (
                <Input
                    size="sm"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                    onBlur={() => { if (!input) setAdding(false) }}
                    placeholder="label..."
                    aria-label="Add label"
                    autoFocus
                    className="w-24 h-6 text-xs rounded-full px-2 bg-transparent border-indigo-300 dark:border-indigo-700"
                />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-slate-400 hover:text-indigo-500 border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition-colors">
                    <Plus className="w-2.5 h-2.5" /> Add
                </button>
            )}
        </div>
    )
}
