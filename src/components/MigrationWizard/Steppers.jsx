import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { Spinner } from '../ui/Spinner'
import { Badge } from '../ui/Badge'
import {
  Check, Radio, Link2, GitFork, Settings2, Sparkles,
  CalendarClock, Activity, Flag, Cloud, ChevronRight,
  AlertTriangle, MinusCircle, XCircle,
} from 'lucide-react'

const STEP_LABELS = {
  sourceType: 'Source',
  azureConnect: 'Connect',
  urlInput: 'URL',
  githubSource: 'Source',
  targetConfig: 'Target',
  repoSelect: 'Repos',
  repoConfig: 'Configure',
  workItems: 'Work Items',
  wiki: 'Wiki',
  aiReview: 'Plan review',
  schedule: 'Schedule',
  progress: 'Progress',
  summary: 'Summary',
}

const STEP_ICONS = {
  sourceType: Radio,
  azureConnect: Link2,
  urlInput: Link2,
  githubSource: Link2,
  targetConfig: Settings2,
  repoSelect: GitFork,
  repoConfig: Settings2,
  workItems: Flag,
  wiki: Flag,
  aiReview: Sparkles,
  schedule: CalendarClock,
  progress: Activity,
  summary: Check,
}

const STEP_HINTS = {
  sourceType: 'Choose platform',
  azureConnect: 'Authenticate',
  urlInput: 'Paste clone URL',
  githubSource: 'Select source',
  targetConfig: 'Set destination',
  repoSelect: 'Pick repositories',
  repoConfig: 'Names & options',
  workItems: 'Migrate items',
  wiki: 'Migrate docs',
  aiReview: 'AI validation',
  schedule: 'Set timing',
  progress: 'Live tracking',
  summary: 'Review results',
}

/* ------------------------------------------------------------------ */
/*  Sidebar Stepper (desktop fullscreen)                               */
/* ------------------------------------------------------------------ */

/**
 * Step status palette used by the sidebar to surface edge cases:
 *   - 'done'     completed step (default for index < current)
 *   - 'current'  the active step (default for index === current)
 *   - 'pending'  upcoming step (default for index > current)
 *   - 'loading'  current step waiting on async work (e.g. validating)
 *   - 'error'    current/past step has a blocking failure
 *   - 'warning'  step is reachable but has non-blocking advisories
 *   - 'skipped'  step intentionally skipped (e.g. feature flag off)
 *
 * Callers pass `stepStates` to override the default (index-based) status.
 */
function statusFor(step, index, currentStepIndex, stepStates) {
  const override = stepStates?.[step]
  if (override) return override
  if (index < currentStepIndex) return 'done'
  if (index === currentStepIndex) return 'current'
  return 'pending'
}

function StepDisc({ status, index, icon: Icon }) {
  // Single unified disc — replaces the previous dual-indicator design (small
  // dot + larger icon square) that read as visual noise. The disc carries
  // both number/check AND a small per-status badge in the corner when needed.
  if (status === 'done') {
    return (
      <div className="w-9 h-9 rounded-full bg-emerald-500 dark:bg-emerald-500/90 flex items-center justify-center text-white shadow-[0_2px_8px_-2px_rgba(16,185,129,0.5)]">
        <Check className="w-4 h-4" strokeWidth={3} />
      </div>
    )
  }
  if (status === 'current') {
    return (
      <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white shadow-[0_0_0_4px_rgba(85,131,27,0.15),0_4px_14px_-2px_rgba(85,131,27,0.5)]">
        <Icon className="w-4 h-4" strokeWidth={2.25} />
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-brand-500"
          initial={{ opacity: 0.35, scale: 1 }}
          animate={{ opacity: 0, scale: 1.6 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: EASE.emphasized }}
        />
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ring-2 ring-brand-300 dark:ring-brand-700">
        <Spinner size="md" tone="primary" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="w-9 h-9 rounded-full bg-rose-500 dark:bg-rose-500/90 flex items-center justify-center text-white shadow-[0_2px_8px_-2px_rgba(239,68,68,0.5)]">
        <XCircle className="w-4 h-4" strokeWidth={2.5} />
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="w-9 h-9 rounded-full bg-amber-400 dark:bg-amber-500/90 flex items-center justify-center text-white shadow-[0_2px_8px_-2px_rgba(245,158,11,0.45)]">
        <AlertTriangle className="w-4 h-4" strokeWidth={2.5} />
      </div>
    )
  }
  if (status === 'skipped') {
    return (
      <div className="w-9 h-9 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400 dark:text-slate-500">
        <MinusCircle className="w-3.5 h-3.5" strokeWidth={2.25} />
      </div>
    )
  }
  // pending
  return (
    <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center ds-text-meta font-semibold tabular-nums text-slate-500 dark:text-slate-400">
      {index + 1}
    </div>
  )
}

const ROW_TONE = {
  done:    { row: 'hover:bg-emerald-50/60 dark:hover:bg-emerald-900/10 cursor-pointer', label: 'text-slate-800 dark:text-slate-100', hint: 'text-emerald-700/80 dark:text-emerald-400/70', pill: null },
  current: { row: 'bg-gradient-to-r from-brand-50/80 to-transparent dark:from-brand-500/[0.12] dark:to-transparent', label: 'text-brand-700 dark:text-brand-200', hint: 'text-brand-500/80 dark:text-brand-300/80', pill: { label: 'Current', cls: 'bg-brand-500 text-white' } },
  pending: { row: '', label: 'text-slate-500 dark:text-slate-500', hint: 'text-slate-400 dark:text-slate-600', pill: null },
  loading: { row: 'bg-gradient-to-r from-brand-50/80 to-transparent dark:from-brand-500/[0.10] dark:to-transparent', label: 'text-brand-700 dark:text-brand-200', hint: 'text-brand-500/80 dark:text-brand-300/80', pill: { label: 'PROCESSING', cls: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' } },
  error:   { row: 'bg-gradient-to-r from-rose-50/80 to-transparent dark:from-rose-500/[0.10] dark:to-transparent', label: 'text-rose-700 dark:text-rose-300', hint: 'text-rose-600/80 dark:text-rose-400/80', pill: { label: 'ACTION', cls: 'bg-rose-500 text-white' } },
  warning: { row: 'bg-gradient-to-r from-amber-50/70 to-transparent dark:from-amber-500/[0.10] dark:to-transparent', label: 'text-amber-700 dark:text-amber-300', hint: 'text-amber-700/80 dark:text-amber-400/80', pill: { label: 'WARNING', cls: 'bg-amber-400 text-white' } },
  skipped: { row: '', label: 'text-slate-400 dark:text-slate-600', hint: 'text-slate-300 dark:text-slate-700 italic', pill: { label: 'SKIPPED', cls: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' } },
}

export function SidebarStepper({
  steps,
  currentStepIndex,
  onGoToStep,
  source,
  selectedCount,
  totalWarnings = 0,
  onBreadcrumbNavigate,
  currentStep,
  stepStates,                  // optional: { [stepId]: 'error'|'warning'|'loading'|'skipped' }
  currentStepStatusDetail,     // optional: short string shown under the current step (e.g. "A validar credenciais…")
}) {
  const VISIBLE_BREADCRUMB_STEPS = ['repoSelect', 'repoConfig', 'workItems', 'wiki', 'aiReview', 'schedule']
  const showBreadcrumb = source?.sourceType === 'azure' && VISIBLE_BREADCRUMB_STEPS.includes(currentStep)

  // Find the deepest step that's truly "done" so the connector fill stops
  // there even when later steps carry non-default statuses (e.g. an error
  // on the current step shouldn't make the bar look like it advanced past).
  const fillUpToIndex = (() => {
    let last = -1
    for (let i = 0; i < steps.length; i++) {
      const s = statusFor(steps[i], i, currentStepIndex, stepStates)
      if (s === 'done' || s === 'skipped') last = i
      else break
    }
    return last
  })()
  const fillPct = steps.length > 1 ? Math.max(0, (fillUpToIndex + 1) / steps.length) * 100 : 0

  // Total visible work = steps that aren't skipped. Used for the "x/y" header
  // so users don't see 3/8 when 2 steps are skipped (would feel stuck).
  const skippedCount = steps.filter((s, i) => statusFor(s, i, currentStepIndex, stepStates) === 'skipped').length
  const effectiveTotal = steps.length - skippedCount
  const effectiveCurrent = steps.slice(0, currentStepIndex + 1).filter((s, i) => statusFor(s, i, currentStepIndex, stepStates) !== 'skipped').length

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb — preserved verbatim (already premium for Azure flows) */}
      {showBreadcrumb && (
        <div className="px-3 pt-4 pb-1">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500/[0.08] dark:bg-brand-500/[0.12] border border-brand-500/10 dark:border-brand-500/15">
            <Cloud className="w-3 h-3 text-brand-400 shrink-0" />
            <button
              type="button"
              onClick={() => onBreadcrumbNavigate('org')}
              className="ds-text-meta font-semibold text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)] hover:text-brand-400 dark:hover:text-brand-300 transition-colors truncate max-w-[60px]"
            >
              {source.org}
            </button>
            <ChevronRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600 shrink-0" />
            <button
              type="button"
              onClick={() => onBreadcrumbNavigate('project')}
              className="ds-text-meta font-semibold text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)] hover:text-brand-400 dark:hover:text-brand-300 transition-colors truncate max-w-[70px]"
            >
              {source.project}
            </button>
            {selectedCount > 0 && (
              <>
                <ChevronRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600 shrink-0" />
                <Badge tone={totalWarnings > 0 ? 'warning' : 'success'} size="xs" className="gap-1 whitespace-nowrap font-bold">
                  {selectedCount} repos
                  {totalWarnings > 0 && <AlertTriangle className="w-2.5 h-2.5" />}
                </Badge>
              </>
            )}
          </div>
        </div>
      )}

      {/* Progress header — premium pill + slim bar */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="ds-eyebrow text-slate-500 dark:text-slate-400">
            Progress
          </span>
          <div className="inline-flex items-baseline gap-0.5 px-2 py-0.5 rounded-md bg-brand-50 dark:bg-brand-500/10 text-[color:var(--ds-accent-brand)] dark:text-brand-300 font-bold tabular-nums">
            <span className="ds-text-sm leading-none">{effectiveCurrent}</span>
            <span className="ds-text-micro leading-none opacity-60">/</span>
            <span className="ds-text-meta leading-none opacity-70">{effectiveTotal}</span>
          </div>
        </div>
        <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800/70 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-brand-500"
            initial={false}
            animate={{ width: `${fillPct}%` }}
            transition={{ duration: DURATION.ambient, ease: EASE.emphasized }}
          />
        </div>
      </div>

      {/* Step list */}
      <nav aria-label="Wizard steps" className="flex-1 px-3 pb-2 overflow-y-auto ds-scrollbar">
        <ol className="relative space-y-0.5">
          {/* Vertical track (background) — aligned with disc centre (px-3 + half of 36px) */}
          <div
            className="absolute left-[30px] top-5 bottom-5 w-px bg-slate-200/70 dark:bg-slate-700/60"
            aria-hidden="true"
          />
          {/* Animated progress fill — emerald → indigo gradient stops at fillUpToIndex */}
          <motion.div
            className="absolute left-[30px] top-5 w-px bg-gradient-to-b from-emerald-400 via-emerald-500 to-brand-500"
            aria-hidden="true"
            initial={false}
            animate={{
              height: steps.length > 1
                ? `${((fillUpToIndex + 1) / steps.length) * 100}%`
                : '0%',
            }}
            transition={{ duration: DURATION.ambient, ease: EASE.emphasized }}
          />

          {steps.map((step, index) => {
            const status = statusFor(step, index, currentStepIndex, stepStates)
            const label = STEP_LABELS[step] || step
            const hint = STEP_HINTS[step] || ''
            const StepIcon = STEP_ICONS[step] || Radio
            const tone = ROW_TONE[status] || ROW_TONE.pending
            const isActiveLike = status === 'current' || status === 'loading' || status === 'error' || status === 'warning'
            const isClickable = status === 'done' || status === 'warning'

            return (
              <li key={step} className="relative">
                <button
                  type="button"
                  onClick={() => isClickable && onGoToStep(step)}
                  disabled={!isClickable}
                  aria-label={`${label}${isActiveLike ? ' (current)' : status === 'done' ? ' (done)' : ''}`}
                  aria-current={isActiveLike ? 'step' : undefined}
                  title={!isClickable && status === 'pending' ? `Available after "${STEP_LABELS[steps[currentStepIndex]] || ''}"` : undefined}
                  className={`
                    w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-all duration-200 group relative
                    ${tone.row}
                    ${!isClickable ? 'cursor-default' : ''}
                   ds-focus-ring`}
                >
                  {/* Disc */}
                  <div className="relative z-10 shrink-0">
                    <StepDisc status={status} index={index} icon={StepIcon} />
                  </div>

                  {/* Label + hint */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`ds-text-sm font-semibold truncate leading-tight ${tone.label}`}>
                        {label}
                      </span>
                      {tone.pill && (
                        <span className={`ds-eyebrow px-1.5 py-0.5 rounded-md leading-none ${tone.pill.cls}`}>
                          {tone.pill.label}
                        </span>
                      )}
                    </div>
                    <div className={`ds-text-micro truncate leading-snug mt-0.5 ${tone.hint}`}>
                      {status === 'current' && currentStepStatusDetail ? currentStepStatusDetail : hint}
                    </div>
                  </div>

                  {/* Right-side affordance: chevron on done (revisit), nothing on pending */}
                  {status === 'done' && (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Footer — single hair-thin divider, no visual noise */}
      <div className="px-4 pb-4 pt-1">
        <div className="h-px bg-gradient-to-r from-transparent via-slate-200/60 dark:via-slate-700/40 to-transparent" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Horizontal Stepper (desktop restored mode)                         */
/* ------------------------------------------------------------------ */
export function HorizontalStepper({ steps, currentStepIndex, onGoToStep }) {
  return (
    <nav aria-label="Wizard steps" className="px-6 pt-4 pb-2">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isActive = index === currentStepIndex
          const isCompleted = index < currentStepIndex
          const label = STEP_LABELS[step] || step
          return (
            <li key={step} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => onGoToStep(step)}
                  disabled={!isCompleted}
                  aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    flex items-center justify-center rounded-full text-xs font-bold transition-all
                    ${isActive
                      ? 'w-7 h-7 bg-brand-500 text-white ring-4 ring-brand-500/20 scale-110'
                      : isCompleted
                        ? 'w-5 h-5 bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                        : 'w-5 h-5 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }
                  `}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : index + 1}
                </button>
                <span className={`mt-1 ds-text-micro font-medium truncate max-w-[52px] text-center
                  ${isActive ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]' : isCompleted ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${isCompleted ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/*  Mobile Progress Bar                                                */
/* ------------------------------------------------------------------ */
export function MobileProgressBar({ steps, currentStepIndex }) {
  const progress = steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 0
  const label = STEP_LABELS[steps[currentStepIndex]] || ''
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] rounded-full"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: DURATION.slow, ease: EASE.emphasized }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
        Step {currentStepIndex + 1} of {steps.length} — {label}
      </p>
    </div>
  )
}
