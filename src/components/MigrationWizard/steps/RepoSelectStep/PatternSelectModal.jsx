import { useState, useMemo } from 'react'
import { Filter } from 'lucide-react'
import { Modal, ModalFooter } from '../../../ui/Modal'
import { Button } from '../../../ui/Button'
import { Field, Input } from '../../../ui/form'

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
            size="lg"
            closeOnBackdrop={false}
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
            <Field htmlFor="pattern-select-input" error={error || undefined}>
                <Input
                    id="pattern-select-input"
                    type="text"
                    autoFocus
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="^web-.*|.*-legacy$"
                    aria-label="Regular expression pattern"
                />
            </Field>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums" aria-live="polite">
                {matches.length} of {repos.length} match
            </p>
        </Modal>
    )
}
