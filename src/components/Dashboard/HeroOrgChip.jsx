import { useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Building2, Check } from 'lucide-react'
import { HeroChip } from './HeroChip'
import { Drawer } from '../ui/Drawer'

// TODO: consolidate with src/hooks/useMobileBreakpoint.jsx — that hook uses
// (max-width: 767px) for md; this chip needs sm (639px). Should grow into a
// shared `useBreakpoint(name)` rather than two near-duplicate hooks.
function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.matchMedia('(max-width: 639px)').matches
    })
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 639px)')
        const handler = (e) => setIsMobile(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])
    return isMobile
}

function OrgList({ orgs, selectedOrg, onSelect }) {
    return (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            <button
                type="button"
                onClick={() => onSelect('')}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                    !selectedOrg
                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                }`}
            >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Building2 size={16} strokeWidth={2.5} />
                </div>
                <span className="font-semibold flex-1">All Organizations</span>
                {!selectedOrg && <Check size={16} className="text-indigo-500" strokeWidth={3} />}
            </button>

            {orgs.map(org => (
                <button
                    key={org.login}
                    type="button"
                    onClick={() => onSelect(org.login)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                        selectedOrg === org.login
                            ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <img src={org.avatar_url} alt={org.login} loading="lazy" decoding="async" className="w-8 h-8 rounded-lg" />
                    <span className="font-semibold flex-1 truncate">{org.login}</span>
                    {selectedOrg === org.login && <Check size={16} className="text-indigo-500" strokeWidth={3} />}
                </button>
            ))}
        </div>
    )
}

export function HeroOrgChip({ orgs = [], selectedOrg, onSelectOrg, loading }) {
    const [open, setOpen] = useState(false)
    const isMobile = useIsMobile()
    const selected = orgs.find(o => o.login === selectedOrg)
    const label = selectedOrg || 'All organizations'
    const ariaLabel = `Filter by organization, currently ${label}`

    const handleSelect = (value) => {
        onSelectOrg(value)
        setOpen(false)
    }

    if (isMobile) {
        return (
            <>
                <HeroChip
                    icon={Building2}
                    label={label}
                    hasMenu
                    disabled={loading}
                    onClick={() => setOpen(true)}
                    aria-label={ariaLabel}
                />
                <Drawer side="bottom" isOpen={open} onClose={() => setOpen(false)} title="Filter by organization">
                    <div className="px-4 py-3">
                        <OrgList orgs={orgs} selectedOrg={selectedOrg} onSelect={handleSelect} />
                    </div>
                </Drawer>
            </>
        )
    }

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <HeroChip
                    icon={selected ? undefined : Building2}
                    hasMenu
                    disabled={loading}
                    aria-label={ariaLabel}
                >
                    {selected && <img src={selected.avatar_url} alt="" loading="lazy" decoding="async" className="w-4 h-4 rounded" />}
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[10rem]">
                        {label}
                    </span>
                </HeroChip>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={8}
                    align="start"
                    className="w-[300px] p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/60 dark:border-slate-700/60 rounded-2xl shadow-2xl ds-animate-scale-in z-50"
                >
                    <OrgList orgs={orgs} selectedOrg={selectedOrg} onSelect={handleSelect} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
