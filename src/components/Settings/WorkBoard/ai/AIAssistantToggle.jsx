import { Sparkles } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'
import { Select } from '../../../ui/Select'
import { useTrackedRepos } from '../../../../hooks/useTrackedRepos'

const CAP_OPTIONS = [
    { cents: 100,  label: '$1/month' },
    { cents: 500,  label: '$5/month' },
    { cents: 2000, label: '$20/month' },
    { cents: 0,    label: 'Unlimited' },
]

export function AIAssistantToggle() {
    const { prefs, updatePrefs } = useTrackedRepos()
    const enabled = prefs?.ai_assistant_enabled === 1
    const cap = prefs?.ai_monthly_cap_cents ?? 500

    return (
        <InsightCard tone="ai" hover={false}>
            <div className="space-y-3">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Repo Advisor</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Natural-language commands and smart suggestions. Opt-in; uses your BYOK provider.
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label="Enable Repo Advisor"
                        onClick={() => updatePrefs({ ai_assistant_enabled: enabled ? 0 : 1 })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            enabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                    >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                    </button>
                </div>

                {enabled && (
                    <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                            Monthly cap
                        </span>
                        <Select
                            label="Monthly cap"
                            size="sm"
                            value={cap}
                            onChange={(v) => updatePrefs({ ai_monthly_cap_cents: v })}
                            options={CAP_OPTIONS.map(o => ({ value: o.cents, label: o.label }))}
                            className="w-40"
                        />
                    </div>
                )}
            </div>
        </InsightCard>
    )
}
