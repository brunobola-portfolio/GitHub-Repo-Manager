import { useState, useMemo } from 'react'
import { Filter } from 'lucide-react'
import { Modal, ModalFooter } from '../../../ui/Modal'
import { Button } from '../../../ui/Button'

export function PatternSelectModal({ repos, onConfirm, onClose }) {
    const [pattern, setPattern] = useState('')

    const { matches, error } = useMemo(() => {
        if (!pattern.trim()) return { matches: [], error: '' }
        if (pattern.length > 100) return { matches: [], error: 'Pattern too long (max 100 chars)' }
        try {
            const re = new RegExp(pattern, 'i')
            return { matches: repos.filter((r) => re.test(r.name)), error: '' }
        } catch (e) {
            return { matches: [], error: e.message }
        }
    }, [pattern, repos])

    return (
        <Modal
            isOpen
            onClose={onClose}
            title="Select by pattern"
            icon={Filter}
            iconGradient="primary"
            size="md"
            footer={
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        disabled={!matches.length}
                        onClick={() => onConfirm(matches.map((r) => r.id))}
                    >
                        Select {matches.length} match{matches.length === 1 ? '' : 'es'}
                    </Button>
                </ModalFooter>
            }
        >
            <p className="text-xs text-slate-500 mb-2">Enter a regular expression. Case-insensitive match on repo name.</p>
            <label htmlFor="pattern-select-input" className="sr-only">Regular expression pattern</label>
            <input
                id="pattern-select-input"
                type="text"
                autoFocus
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="^web-.*|.*-legacy$"
                aria-invalid={!!error}
                aria-describedby={error ? 'pattern-error' : undefined}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p id="pattern-error" className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums" aria-live="polite">
                {matches.length} of {repos.length} match
            </p>
        </Modal>
    )
}
