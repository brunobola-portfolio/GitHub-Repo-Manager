import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { Select } from '../../ui/Select'

/**
 * Branch picker for the DevToolkit. Built on the shared premium ui/Select so it
 * inherits searchable filtering, ARIA combobox semantics, keyboard navigation
 * and outside-click/Escape dismissal instead of a bespoke dropdown.
 *
 * `branches` may be an array of strings or of `{ name }` objects. The default
 * branch (or `main`/`master`) is flagged with a "default" badge — Select renders
 * it on both the row and the collapsed trigger. `onSelect` receives the branch
 * name string, matching the previous contract.
 */
export function BranchSelector({ branches = [], selected, onSelect, label, defaultBranch }) {
    const isDefault = (name) => name === defaultBranch || name === 'main' || name === 'master'

    const options = useMemo(
        () =>
            (branches || []).map((b) => {
                const name = b.name || b
                return {
                    value: name,
                    label: name,
                    icon: GitBranch,
                    ...(isDefault(name)
                        ? {
                              badge: 'default',
                              badgeColor:
                                  'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 font-semibold',
                          }
                        : {}),
                }
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultBranch feeds isDefault
        [branches, defaultBranch],
    )

    return (
        <div className="flex-1">
            {label && (
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                    {label}
                </label>
            )}
            <Select
                options={options}
                value={selected || ''}
                onChange={(name) => onSelect(name)}
                searchable={(branches?.length ?? 0) > 5}
                label={label || 'Branch'}
                placeholder="Select branch..."
            />
        </div>
    )
}
