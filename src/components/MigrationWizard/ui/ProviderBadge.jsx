import { Cloud, Server, Sparkles, HelpCircle } from 'lucide-react'
import { classifyProvider, providerToneClasses, PROVIDERS } from '../../../utils/azureProvider'

/**
 * Visual identity for the detected Azure DevOps provider. Shows the
 * provider family (cloud / VSTS / on-prem) and the host so the user is
 * never in doubt about which server they're connecting to.
 *
 * Variants:
 *   - "inline"  → small chip, used in headers / preview rows
 *   - "card"    → full-width card with description, used as the primary
 *                 identity element near the URL paste field
 */
export default function ProviderBadge({ host, variant = 'inline', className = '' }) {
  const provider = classifyProvider(host)
  const tone = providerToneClasses(provider.tone)

  if (variant === 'card') {
    return (
      <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border ${tone.bg} ${tone.border} ${className}`}>
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${tone.bg} border ${tone.border}`}>
          <ProviderIcon type={provider.type} className={`w-5 h-5 ${tone.iconText}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${tone.text}`}>{provider.label}</span>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot}`} />
            <code className="text-xs text-slate-600 dark:text-slate-400 truncate font-mono">
              {host || '—'}
            </code>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {provider.longLabel}
            {provider.type === PROVIDERS.ON_PREM && (
              <>
                {' · '}
                <span className="text-amber-600 dark:text-amber-400">requer PAT criado nesse servidor</span>
              </>
            )}
          </p>
        </div>
      </div>
    )
  }

  // inline chip
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium
        ${tone.bg} ${tone.border} ${tone.text} ${className}`}
      title={provider.longLabel}
    >
      <ProviderIcon type={provider.type} className={`w-3 h-3 ${tone.iconText}`} />
      {provider.label}
    </span>
  )
}

function ProviderIcon({ type, className }) {
  if (type === PROVIDERS.CLOUD) return <Cloud className={className} />
  if (type === PROVIDERS.VSTS) return <Sparkles className={className} />
  if (type === PROVIDERS.ON_PREM) return <Server className={className} />
  return <HelpCircle className={className} />
}
