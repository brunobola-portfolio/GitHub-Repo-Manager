import { Check, X, Cpu } from 'lucide-react'
import { InsightCard } from '../../ui/InsightCard'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
    PROVIDER_CAPABILITIES,
    FEATURE_LABELS,
} from '../../../utils/providerCapabilities'

// ---------------------------------------------------------------------------
// Sub-component: CapabilityMatrix
// ---------------------------------------------------------------------------

export function CapabilityMatrix({ activeProvider }) {
    const features = Object.keys(FEATURE_LABELS)

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Capabilities
                    </span>
                </div>
                <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                        <thead>
                            <tr>
                                <th className="text-left py-1.5 pr-3 font-medium text-slate-500 dark:text-slate-400 w-32">
                                    Provider
                                </th>
                                {features.map((f) => (
                                    <th
                                        key={f}
                                        className="text-center py-1.5 px-2 font-medium text-slate-500 dark:text-slate-400"
                                    >
                                        {FEATURE_LABELS[f]}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {PROVIDER_IDS.map((pid) => {
                                const isActive = pid === activeProvider
                                return (
                                    <tr
                                        key={pid}
                                        className={`border-t border-slate-100 dark:border-slate-800 ${
                                            isActive
                                                ? 'bg-indigo-50/60 dark:bg-indigo-900/20'
                                                : ''
                                        }`}
                                    >
                                        <td className={`py-1.5 pr-3 font-medium ${
                                            isActive
                                                ? 'text-indigo-700 dark:text-indigo-300'
                                                : 'text-slate-600 dark:text-slate-400'
                                        }`}>
                                            {PROVIDER_LABELS[pid]}
                                            {isActive && (
                                                <span className="ml-1.5 text-[10px] font-semibold text-indigo-500 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded-full">
                                                    active
                                                </span>
                                            )}
                                        </td>
                                        {features.map((f) => {
                                            const cap = PROVIDER_CAPABILITIES[pid]?.[f]
                                            return (
                                                <td key={f} className="text-center py-1.5 px-2">
                                                    {cap === 'yes' ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                                    ) : cap === 'depends' ? (
                                                        <span
                                                            className="inline-block text-xs font-semibold text-amber-500 leading-none"
                                                            aria-label="depends on configuration"
                                                            title="Depends on configuration"
                                                        >~</span>
                                                    ) : (
                                                        <X className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mx-auto" />
                                                    )}
                                                </td>
                                            )
                                        })}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                {activeProvider && PROVIDER_CAPABILITIES[activeProvider]?.semanticSearch !== 'yes' && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                        Semantic search requires an embedding provider. Configure one above or switch to Gemini / OpenAI.
                    </p>
                )}
            </div>
        </InsightCard>
    )
}
