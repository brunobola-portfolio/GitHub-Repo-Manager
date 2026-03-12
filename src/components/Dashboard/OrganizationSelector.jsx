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
                        className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-br from-white/90 to-slate-50/90 dark:from-slate-800/90 dark:to-slate-900/90 backdrop-blur-xl border-2 border-slate-200/60 dark:border-slate-700/60 rounded-2xl shadow-lg hover:shadow-xl hover:border-indigo-300/70 dark:hover:border-indigo-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset focus-visible:border-indigo-400 transition-all duration-300 min-w-[260px] justify-between group"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {selectedOrgData ? (
                                <img
                                    src={selectedOrgData.avatar_url}
                                    alt={selectedOrg}
                                    className="w-9 h-9 rounded-xl ring-2 ring-indigo-100 dark:ring-indigo-900/50 shadow-md"
                                />
                            ) : (
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
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
                            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                        ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 group-hover:rotate-180 transition-all duration-300" />
                        )}
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        className="w-[300px] p-3 bg-gradient-to-br from-white/95 to-slate-50/95 dark:from-slate-900/95 dark:to-slate-800/95 backdrop-blur-2xl border-2 border-slate-200/60 dark:border-slate-700/60 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 z-50"
                        sideOffset={12}
                    >
                        <div className="max-h-[340px] overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                            <button
                                onClick={() => onSelectOrg('')}
                                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${!selectedOrg
                                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300 shadow-sm'
                                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
                                    <Building2 size={18} strokeWidth={2.5} />
                                </div>
                                <span className="font-semibold flex-1 text-left">All Organizations</span>
                                {!selectedOrg && <Check size={18} className="text-indigo-500" strokeWidth={3} />}
                            </button>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                            {orgs?.map(org => (
                                <button
                                    key={org.login}
                                    onClick={() => onSelectOrg(org.login)}
                                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${selectedOrg === org.login
                                            ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300 shadow-sm'
                                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                                        }`}
                                >
                                    <img
                                        src={org.avatar_url}
                                        alt={org.login}
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
