import React from 'react'
import { Building2, ChevronDown, Check, Loader2 } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'

/**
 * OrganizationSelector - Premium dropdown for selecting organization
 */
export function OrganizationSelector({ orgs = [], selectedOrg, onSelectOrg, loading }) {
    const selectedOrgData = orgs?.find(o => o.login === selectedOrg)

    return (
        <div className="relative z-20">
            <Popover.Root>
                <Popover.Trigger asChild>
                    <button
                        disabled={loading}
                        className="flex items-center gap-3 px-4 py-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-all min-w-[240px] justify-between group"
                    >
                        <div className="flex items-center gap-3">
                            {selectedOrgData ? (
                                <img
                                    src={selectedOrgData.avatar_url}
                                    alt={selectedOrg}
                                    className="w-8 h-8 rounded-lg ring-2 ring-white dark:ring-slate-700 shadow-sm"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <Building2 size={18} />
                                </div>
                            )}
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                                {selectedOrg || 'All Organizations'}
                            </span>
                        </div>
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                        )}
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        className="w-[280px] p-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 z-50"
                        sideOffset={8}
                    >
                        <div className="max-h-[300px] overflow-y-auto space-y-1 custom-scrollbar pr-1">
                            <button
                                onClick={() => onSelectOrg('')}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${!selectedOrg
                                        ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <Building2 size={16} />
                                </div>
                                <span className="font-medium flex-1 text-left">All Organizations</span>
                                {!selectedOrg && <Check size={16} className="text-indigo-500" />}
                            </button>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                            {orgs?.map(org => (
                                <button
                                    key={org.login}
                                    onClick={() => onSelectOrg(org.login)}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${selectedOrg === org.login
                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                        }`}
                                >
                                    <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg object-cover" />
                                    <span className="font-medium flex-1 text-left truncate">{org.login}</span>
                                    {selectedOrg === org.login && <Check size={16} className="text-indigo-500" />}
                                </button>
                            ))}
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    )
}
