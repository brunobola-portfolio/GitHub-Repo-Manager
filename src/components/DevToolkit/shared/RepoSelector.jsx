import { useMemo } from 'react'
import { Select } from '../../ui/Select'

/**
 * Repository picker for the DevToolkit. Now built on the shared premium
 * ui/Select so it inherits searchable filtering, ARIA combobox semantics,
 * keyboard navigation (Arrow/Home/End/Enter/Escape) and outside-click/Escape
 * dismissal instead of re-implementing a bespoke dropdown.
 *
 * The public API is unchanged: `selected` is a repo object and `onSelect`
 * receives the picked repo object.
 */
export function RepoSelector({ repos = [], selected, onSelect }) {
    // Map repos → Select options. Prefer the numeric id as the value, falling
    // back to full_name when an id is absent (mirrors the old key strategy).
    const options = useMemo(
        () => repos.map((r) => ({ value: String(r.id ?? r.full_name), label: r.full_name })),
        [repos],
    )

    const selectedValue = selected ? String(selected.id ?? selected.full_name) : ''

    const handleChange = (value) => {
        const repo = repos.find((r) => String(r.id ?? r.full_name) === value)
        if (repo) onSelect(repo)
    }

    return (
        <Select
            options={options}
            value={selectedValue}
            onChange={handleChange}
            searchable
            label="Repository"
            placeholder="Select repository..."
            emptyState={
                <div className="px-3 py-4 text-center text-xs text-slate-400">No repos found</div>
            }
        />
    )
}
