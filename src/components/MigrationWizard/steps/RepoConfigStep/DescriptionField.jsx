import { Sparkles, WandSparkles, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Spinner } from '../../../ui/Spinner'
import { Textarea } from '../../../ui/form'
import { REPO_DESCRIPTION_MAX } from '../../../../utils/migrationDescription'

/**
 * Per-repo description field for the migration wizard's RepoConfigStep.
 * Renders the textarea, the live character counter (with near/over-limit
 * tones), the AI "Generate" / template "Suggest" button, and a provenance
 * badge that makes it transparent whether the last text came from AI or a
 * deterministic template. Purely presentational — the parent owns the value,
 * the generate side effect and the `mode` flag.
 *
 * @param {'ai'|'template'|undefined} mode  provenance of the last generated text
 */
export function DescriptionField({ repo, index, aiAvailable, isGenerating, mode, onChange, onGenerate }) {
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
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <label
            htmlFor={`repo-desc-${index}`}
            className="ds-text-micro font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
          >
            Description
          </label>
          {/* Provenance badge — appears after a generate, clears on manual edit */}
          <AnimatePresence>
            {mode && !isGenerating && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ds-text-micro font-semibold uppercase tracking-wide ${
                  mode === 'ai'
                    ? 'bg-violet-500/12 text-violet-600 dark:text-violet-300'
                    : 'bg-slate-200/70 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400'
                }`}
              >
                {mode === 'ai'
                  ? <><Sparkles className="w-2.5 h-2.5" aria-hidden="true" /> AI-generated</>
                  : <><FileText className="w-2.5 h-2.5" aria-hidden="true" /> Template</>}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          title={aiAvailable
            ? 'Generate a professional description with AI'
            : 'Template-based suggestion — enable Gemini in Settings → AI for AI-written descriptions'}
          className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ds-text-meta font-semibold shrink-0
            transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ds-focus-ring
            ${aiAvailable
              ? 'text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 shadow-sm hover:shadow-md hover:shadow-violet-500/20'
              : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600/60'
            }`}
        >
          {isGenerating
            ? <Spinner size="xs" />
            : aiAvailable
              ? <Sparkles className="w-3 h-3 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
              : <WandSparkles className="w-3 h-3 text-slate-400 dark:text-slate-500" aria-hidden="true" />
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
          placeholder="Describe this repository, or generate one…"
          status={over ? 'error' : 'idle'}
        />
        <span className={`pointer-events-none absolute bottom-1.5 right-2 ds-text-micro font-mono tabular-nums ${counterTone}`}>
          {length}/{REPO_DESCRIPTION_MAX}
        </span>
      </div>
    </div>
  )
}
