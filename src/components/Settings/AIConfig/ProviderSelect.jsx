import { ChevronDown } from 'lucide-react'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
} from '../../../utils/providerCapabilities'
import { INPUT_CLS } from './constants'

// ---------------------------------------------------------------------------
// Sub-component: ProviderSelect
// ---------------------------------------------------------------------------

export function ProviderSelect({ value, onChange }) {
    return (
        <div className="relative">
            <select
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value || null)}
                className={`${INPUT_CLS} pr-8 appearance-none cursor-pointer`}
                aria-label="Completion provider"
            >
                <option value="">— Select a provider —</option>
                {PROVIDER_IDS.map((id) => (
                    <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
    )
}
