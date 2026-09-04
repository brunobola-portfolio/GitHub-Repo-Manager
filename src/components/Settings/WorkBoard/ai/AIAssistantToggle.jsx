import { Sparkles } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'
import { Select } from '../../../ui/Select'
import { Switch } from '../../../ui/form'
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
                    <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-brand-500" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Repo Advisor</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Natural-language commands and smart suggestions. Opt-in; uses your BYOK provider.
                        </p>
                    </div>
                    <Switch
                        checked={enabled}
                        onChange={(v) => updatePrefs({ ai_assistant_enabled: v ? 1 : 0 })}
                        label="Enable Repo Advisor"
                    />
                </div>

                {enabled && (
                    <div id="ai-cap" className="flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-slate-700/40 scroll-mt-4">
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
