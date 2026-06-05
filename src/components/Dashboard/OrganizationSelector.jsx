import React from 'react'
import { Spinner } from '../ui/Spinner'
import { Building2, ChevronDown, Check, Loader2 } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'

/**
 * OrganizationSelector - Premium dropdown for selecting organization
 */
export function OrganizationSelector({ orgs = [], selectedOrg, onSelectOrg, loading }) {
    const selectedOrgData = orgs?.find(o => o.login === selectedOrg)
    const [open, setOpen] = React.useState(false)

    const handleSelect = (value) => {
        onSelectOrg(value)
        setOpen(false)
    }

    return (
        <div className="relative z-20">
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger asChild>
                    <button
                        disabled={loading}
                        className="flex items-center gap-3 px-5 py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 ds-focus-ring transition-all duration-200 min-w-[260px] justify-between group"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {selectedOrgData ? (
                                <img
                                    src={selectedOrgData.avatar_url}
                                    alt={selectedOrg}
                                    loading="lazy"
                                    decoding="async"
                                    className="w-9 h-9 rounded-xl ring-2 ring-indigo-100 dark:ring-indigo-900/50 shadow-md"
                                />
                            ) : (
                                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                                    <Building2 size={20} strokeWidth={2.5} />
                                </div>
                            )}
                            <div className="flex flex-col items-start flex-1 min-w-0">
                                <span className="font-bold text-slate-800 dark:text-white text-sm truncate w-full">
                                    {selectedOrg || 'All Organizations'}
                                </span>
                                {selectedOrgData && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {selectedOrgData.public_repos || 0} repos
                                    </span>
                                )}
                            </div>
                        </div>
                        {loading ? (
                            <Spinner size="md" />
                        ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 group-hover:rotate-180 transition-all duration-300" />
                        )}
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        className="w-[300px] max-w-[calc(100vw-1rem)] p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-md animate-in fade-in zoom-in-95 duration-200 z-[var(--ds-z-popover)]"
                        sideOffset={12}
                    >
                        <div className="max-h-[340px] overflow-y-auto space-y-1.5 ds-scrollbar pr-1">
                            <button
                                onClick={() => handleSelect('')}
                                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${!selectedOrg
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                                    <Building2 size={18} strokeWidth={2.5} />
                                </div>
                                <span className="font-semibold flex-1 text-left">All Organizations</span>
                                {!selectedOrg && <Check size={18} className="text-indigo-500" strokeWidth={3} />}
                            </button>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                            {orgs?.map(org => (
                                <button
                                    key={org.login}
                                    onClick={() => handleSelect(org.login)}
                                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${selectedOrg === org.login
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                                        }`}
                                >
                                    <img
                                        src={org.avatar_url}
                                        alt={org.login}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-9 h-9 rounded-xl object-cover ring-2 ring-slate-100 dark:ring-slate-800 shadow-sm"
                                    />
                                    <div className="flex flex-col items-start flex-1 min-w-0">
                                        <span className="font-semibold text-left truncate w-full">{org.login}</span>
                                        {org.public_repos > 0 && (
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                {org.public_repos} repos
                                            </span>
                                        )}
                                    </div>
                                    {selectedOrg === org.login && <Check size={18} className="text-indigo-500 flex-shrink-0" strokeWidth={3} />}
                                </button>
                            ))}
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    )
}
