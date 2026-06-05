import { Sparkles } from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Textarea } from '../../../ui/form'
import { REPO_DESCRIPTION_MAX } from '../../../../utils/migrationDescription'

/**
 * Per-repo description field for the migration wizard's RepoConfigStep.
 * Renders the textarea, the live character counter (with near/over-limit
 * tones) and the AI "Generate" / template "Suggest" button. Purely
 * presentational — the parent owns the value and the generate side effect.
 */
export function DescriptionField({ repo, index, aiAvailable, isGenerating, onChange, onGenerate }) {
  const value = repo.description || ''
  const length = value.length
  const over = length > REPO_DESCRIPTION_MAX
  const near = !over && length > REPO_DESCRIPTION_MAX - 30

  const counterTone = over
    ? 'text-red-600 dark:text-red-400'
    : near
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-slate-400 dark:text-slate-500'

  const buttonLabel = isGenerating
    ? 'Generating…'
    : aiAvailable ? 'Generate with AI' : 'Suggest'

  const handleChange = (e) => {
    const next = e.target.value.slice(0, REPO_DESCRIPTION_MAX)
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor={`repo-desc-${index}`}
          className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          Description
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          title={aiAvailable
            ? 'Generate a professional description with AI'
            : 'Template-based — enable Gemini in Settings for AI-generated descriptions'}
          className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ds-text-meta font-medium
            transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
            ${aiAvailable
              ? 'text-white bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)] shadow-sm hover:shadow-md'
              : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600/60'
            }`}
        >
          {isGenerating
            ? <Spinner size="xs" />
            : <Sparkles className={`w-3 h-3 ${aiAvailable ? '' : 'text-slate-400 dark:text-slate-500'}`} />
          }
          <span>{buttonLabel}</span>
        </button>
      </div>
      <div className="relative">
        <Textarea
          id={`repo-desc-${index}`}
          rows={2}
          value={value}
          onChange={handleChange}
          maxLength={REPO_DESCRIPTION_MAX}
          placeholder="Optional description..."
          status={over ? 'error' : 'idle'}
        />
        <span className={`pointer-events-none absolute bottom-1.5 right-2 ds-text-micro font-mono tabular-nums ${counterTone}`}>
          {length}/{REPO_DESCRIPTION_MAX}
        </span>
      </div>
    </div>
  )
}
