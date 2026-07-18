import { AnimatePresence, motion } from 'framer-motion'
import { Link2, FolderGit2, X, Building2, ChevronRight, Check } from 'lucide-react'
import { parseAzureUrl } from '../../../../utils/azureUrlParser'
import { Field, Input } from '../../../ui/form'
import ProviderBadge from '../../ui/ProviderBadge'

/**
 * Smart Azure DevOps URL paste field with rich preview.
 *
 * The preview makes the parsed result explicit and reviewable BEFORE the
 * fields are applied to wizard state — eliminates the "I pasted something
 * and now I don't know what got picked up" confusion.
 */
export default function SourceUrlForm({
  smartPasteValue,
  urlPreview,
  onInput,
  onApply,
  onDismiss,
}) {
  const parsedBadge = smartPasteValue ? parseAzureUrl(smartPasteValue) : null
  const showParseError = !urlPreview && parsedBadge?.error && smartPasteValue.length > 0

  return (
    <div>
      <Field
        label={
          <span className="flex items-center gap-1.5">
            Paste an Azure DevOps or TFS URL
            <span className="text-slate-400 font-normal">(optional, speeds up filling the form)</span>
          </span>
        }
        htmlFor="source-azure-url"
        hint={showParseError ? parsedBadge.error : undefined}
      >
        <Input
          id="source-azure-url"
          type="text"
          value={smartPasteValue}
          onChange={(e) => onInput(e.target.value)}
          placeholder="https://dev.azure.com/org/project  or  https://tfs.company.com/Collection/Project"
          leadingIcon={Link2}
        />
      </Field>

      <AnimatePresence>
        {urlPreview && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/15 overflow-hidden">
              {/* Header — provider identity */}
              <div className="px-3.5 py-2 flex items-center gap-2 border-b border-indigo-200/60 dark:border-indigo-800/50 bg-white/40 dark:bg-slate-900/30">
                <ProviderBadge host={urlPreview.host} variant="inline" />
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {urlPreview.host}
                </span>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="ml-auto p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                  aria-label="Dismiss preview"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Parsed breadcrumb + apply */}
              <div className="px-3.5 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-sm">
                  <PreviewChip icon={Building2} label="Organization / Collection" value={urlPreview.org} tone="indigo" />
                  {urlPreview.project && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <PreviewChip icon={FolderGit2} label="Project" value={urlPreview.project} tone="indigo" />
                    </>
                  )}
                  {urlPreview.repo && urlPreview.repo !== urlPreview.project && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <PreviewChip label="Repo" value={urlPreview.repo} tone="indigo" />
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onApply}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] dark:hover:bg-indigo-400 shadow-sm transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Apply
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PreviewChip({ icon: Icon, label, value, tone = 'indigo' }) {
  const toneText = tone === 'indigo'
    ? 'text-indigo-700 dark:text-indigo-300'
    : 'text-slate-700 dark:text-slate-300'
  return (
    <span
      className={`inline-flex items-center gap-1 min-w-0 max-w-full ${toneText} text-xs font-medium`}
      title={label ? `${label}: ${value}` : value}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />}
      <span className="truncate">{value}</span>
    </span>
  )
}
