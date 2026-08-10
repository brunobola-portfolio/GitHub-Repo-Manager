import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Calendar, Check } from 'lucide-react'
import { HeroChip } from './HeroChip'

function getRanges() {
    return [
        { value: '7d',  label: 'Last 7 days' },
        { value: '30d', label: 'Last 30 days' },
        { value: '90d', label: 'Last 90 days' },
    ]
}

export function HeroTimeRangeChip({ value, onChange }) {
    const [open, setOpen] = useState(false)
    const RANGES = useMemo(() => getRanges(), [])
    const current = RANGES.find(r => r.value === value) ?? RANGES[0]

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <HeroChip
                    icon={Calendar}
                    label={current.label}
                    hasMenu
                    aria-label={`Time range, currently ${current.label}`}
                />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={8}
                    align="start"
                    className="w-[200px] p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-md ds-animate-scale-in z-[var(--ds-z-popover)]"
                >
                    {RANGES.map(r => (
                        <button
                            key={r.value}
                            type="button"
                            onClick={() => { onChange(r.value); setOpen(false) }}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                value === r.value
                                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-semibold'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                            }`}
                        >
                            <span>{r.label}</span>
                            {value === r.value && <Check size={14} strokeWidth={3} />}
                        </button>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
