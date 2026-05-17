import { useState } from 'react'
import { X, Plus, User } from 'lucide-react'
import { Input } from '../../ui/form'

export function ReviewerPills({ reviewers = [], onRemove, onAdd }) {
    const [adding, setAdding] = useState(false)
    const [input, setInput] = useState('')

    const handleAdd = () => {
        const name = input.trim().replace(/^@/, '')
        if (name && !reviewers.includes(name)) {
            onAdd(name)
            setInput('')
            setAdding(false)
        }
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center">
            {reviewers.map(r => (
                <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs border border-slate-200 dark:border-slate-700">
                    <User className="w-2.5 h-2.5" />
                    @{r}
                    <button type="button" onClick={() => onRemove(r)} className="hover:text-red-500 transition-colors" aria-label={`Remove ${r}`}>
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
                    placeholder="@username..."
                    aria-label="Add reviewer username"
                    autoFocus
                    className="w-28 h-6 text-xs rounded-full px-2 bg-transparent"
                />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-slate-400 hover:text-indigo-500 border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition-colors">
                    <Plus className="w-2.5 h-2.5" /> Add
                </button>
            )}
        </div>
    )
}
