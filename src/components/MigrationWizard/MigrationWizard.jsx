import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WizardPanel } from '../ui/WizardPanel'
import { Button } from '../ui/Button'
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useMigrationWizard } from '../../hooks/useMigrationWizard'
import { useAzureOAuth } from '../../hooks/useAzureOAuth'
import { useAzureOrganizations } from '../../hooks/useAzureOrganizations'
import { useToast } from '../../hooks/useToast'
import { migrationApi } from '../../api/migration'
import { getCsrfToken } from '../../utils/api'
// Early steps (everyone sees these on the migration path) stay eager.
import SourceTypeStep from './steps/SourceTypeStep'
import SourceStep from './steps/SourceStep'
import UrlInputStep from './steps/UrlInputStep'
import GitHubSourceStep from './steps/GitHubSourceStep'
import TargetConfigStep from './steps/TargetConfigStep'
import RepoSelectStep from './steps/RepoSelectStep'
import RepoConfigStep from './steps/RepoConfigStep'
// Late / optional steps are lazy — many migrations never reach them
// (workItems/wiki only for Azure, aiReview is gated by a feature flag,
// progress + summary only after the user kicks off a migration).
const WorkItemsStep = lazy(() => import('./steps/WorkItemsStep'))
const WikiStep = lazy(() => import('./steps/WikiStep'))
const AIReviewStep = lazy(() => import('./steps/AIReviewStep'))
const ScheduleStep = lazy(() => import('./steps/ScheduleStep'))
const ProgressStep = lazy(() => import('./steps/ProgressStep'))
const SimpleProgressStep = lazy(() => import('./steps/SimpleProgressStep'))
const SummaryStep = lazy(() => import('./steps/SummaryStep'))
import { SectionSpinner, Spinner } from '../ui/Spinner'
import BreadcrumbNav from './BreadcrumbNav'
import {
  ArrowLeft, ArrowRight, Rocket, Download, AlertCircle, AlertTriangle,
  Check, Radio, Link2, GitFork, Settings2, Sparkles,
  CalendarClock, Activity, Flag, Cloud, ChevronRight, Zap,
  MinusCircle, XCircle,
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
  aiReview: 'AI Review',
  schedule: 'Schedule',
  progress: 'Progress',
  summary: 'Summary',
}

const STEP_META = {
  sourceType:   { title: 'Choose Source',            subtitle: 'Select where to import your repositories from.' },
  azureConnect: { title: 'Connect to Azure DevOps',  subtitle: 'Enter your organization and credentials.' },
  urlInput:     { title: 'Repository URL',            subtitle: 'Enter the clone URL of the Git repository.' },
  githubSource: { title: 'GitHub Repository',         subtitle: 'Enter the GitHub repository to import.' },
  targetConfig: { title: 'Target Configuration',      subtitle: 'Configure where to import the repository.' },
  repoSelect:   { title: 'Select Repositories',       subtitle: 'Choose which repositories to migrate.' },
  repoConfig:   { title: 'Configure Repositories',    subtitle: 'Set target names and options for each repo.' },
  workItems:    { title: 'Work Items',                subtitle: 'Configure work item migration settings.' },
  wiki:         { title: 'Wiki',                      subtitle: 'Configure wiki migration settings.' },
  aiReview:     { title: 'AI Review',                 subtitle: 'Review the migration plan with AI assistance.' },
  schedule:     { title: 'Schedule',                  subtitle: 'Choose when to run the migration.' },
  progress:     { title: 'Migration in Progress',     subtitle: 'Your migration is running.' },
  summary:      { title: 'Migration Complete',        subtitle: 'Review the results of your migration.' },
}

const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -80 : 80, opacity: 0 }),
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
      <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-[0_0_0_4px_rgba(99,102,241,0.15),0_4px_14px_-2px_rgba(99,102,241,0.5)]">
        <Icon className="w-4 h-4" strokeWidth={2.25} />
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-indigo-500"
          initial={{ opacity: 0.35, scale: 1 }}
          animate={{ opacity: 0, scale: 1.6 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-300 dark:ring-indigo-700">
        <Spinner size="md" tone="primary" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="w-9 h-9 rounded-full bg-red-500 dark:bg-red-500/90 flex items-center justify-center text-white shadow-[0_2px_8px_-2px_rgba(239,68,68,0.5)]">
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
    <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center text-[11px] font-semibold tabular-nums text-slate-400 dark:text-slate-500">
      {index + 1}
    </div>
  )
}

const ROW_TONE = {
  done:    { row: 'hover:bg-emerald-50/60 dark:hover:bg-emerald-900/10 cursor-pointer', label: 'text-slate-800 dark:text-slate-100', hint: 'text-emerald-600/80 dark:text-emerald-400/70', pill: null },
  current: { row: 'bg-gradient-to-r from-indigo-50/80 to-transparent dark:from-indigo-500/[0.12] dark:to-transparent', label: 'text-indigo-700 dark:text-indigo-200', hint: 'text-indigo-500/80 dark:text-indigo-300/80', pill: { label: 'AGORA', cls: 'bg-indigo-500 text-white' } },
  pending: { row: '', label: 'text-slate-500 dark:text-slate-500', hint: 'text-slate-400 dark:text-slate-600', pill: null },
  loading: { row: 'bg-gradient-to-r from-indigo-50/80 to-transparent dark:from-indigo-500/[0.10] dark:to-transparent', label: 'text-indigo-700 dark:text-indigo-200', hint: 'text-indigo-500/80 dark:text-indigo-300/80', pill: { label: 'A PROCESSAR', cls: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' } },
  error:   { row: 'bg-gradient-to-r from-red-50/80 to-transparent dark:from-red-500/[0.10] dark:to-transparent', label: 'text-red-700 dark:text-red-300', hint: 'text-red-600/80 dark:text-red-400/80', pill: { label: 'AÇÃO', cls: 'bg-red-500 text-white' } },
  warning: { row: 'bg-gradient-to-r from-amber-50/70 to-transparent dark:from-amber-500/[0.10] dark:to-transparent', label: 'text-amber-700 dark:text-amber-300', hint: 'text-amber-600/80 dark:text-amber-400/80', pill: { label: 'AVISO', cls: 'bg-amber-400 text-white' } },
  skipped: { row: '', label: 'text-slate-400 dark:text-slate-600', hint: 'text-slate-300 dark:text-slate-700 italic', pill: { label: 'SALTADO', cls: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' } },
}

function SidebarStepper({
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
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-500/[0.12] border border-indigo-500/10 dark:border-indigo-500/15">
            <Cloud className="w-3 h-3 text-indigo-400 shrink-0" />
            <button
              type="button"
              onClick={() => onBreadcrumbNavigate('org')}
              className="text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors truncate max-w-[60px]"
            >
              {source.org}
            </button>
            <ChevronRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600 shrink-0" />
            <button
              type="button"
              onClick={() => onBreadcrumbNavigate('project')}
              className="text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors truncate max-w-[70px]"
            >
              {source.project}
            </button>
            {selectedCount > 0 && (
              <>
                <ChevronRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600 shrink-0" />
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1 ${
                  totalWarnings > 0
                    ? 'text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15'
                    : 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15'
                }`}>
                  {selectedCount} repos
                  {totalWarnings > 0 && <AlertTriangle className="w-2.5 h-2.5" />}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Progress header — premium pill + slim bar */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            Progresso
          </span>
          <div className="inline-flex items-baseline gap-0.5 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-bold tabular-nums">
            <span className="text-[13px] leading-none">{effectiveCurrent}</span>
            <span className="text-[10px] leading-none opacity-60">/</span>
            <span className="text-[11px] leading-none opacity-70">{effectiveTotal}</span>
          </div>
        </div>
        <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800/70 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-indigo-500"
            initial={false}
            animate={{ width: `${fillPct}%` }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
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
            className="absolute left-[30px] top-5 w-px bg-gradient-to-b from-emerald-400 via-emerald-500 to-indigo-500"
            aria-hidden="true"
            initial={false}
            animate={{
              height: steps.length > 1
                ? `${((fillUpToIndex + 1) / steps.length) * 100}%`
                : '0%',
            }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
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
                  aria-label={`${label}${isActiveLike ? ' (actual)' : status === 'done' ? ' (concluído)' : ''}`}
                  aria-current={isActiveLike ? 'step' : undefined}
                  title={!isClickable && status === 'pending' ? `Disponível depois de "${STEP_LABELS[steps[currentStepIndex]] || ''}"` : undefined}
                  className={`
                    w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-all duration-200 group relative
                    ${tone.row}
                    ${!isClickable ? 'cursor-default' : ''}
                  `}
                >
                  {/* Disc */}
                  <div className="relative z-10 shrink-0">
                    <StepDisc status={status} index={index} icon={StepIcon} />
                  </div>

                  {/* Label + hint */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[13px] font-semibold truncate leading-tight ${tone.label}`}>
                        {label}
                      </span>
                      {tone.pill && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md leading-none ${tone.pill.cls}`}>
                          {tone.pill.label}
                        </span>
                      )}
                    </div>
                    <div className={`text-[10.5px] truncate leading-snug mt-0.5 ${tone.hint}`}>
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
function HorizontalStepper({ steps, currentStepIndex, onGoToStep }) {
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
                      ? 'w-7 h-7 bg-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                      : isCompleted
                        ? 'w-5 h-5 bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                        : 'w-5 h-5 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                    }
                  `}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : index + 1}
                </button>
                <span className={`mt-1 text-[10px] font-medium truncate max-w-[52px] text-center
                  ${isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
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
function MobileProgressBar({ steps, currentStepIndex }) {
  const progress = steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 0
  const label = STEP_LABELS[steps[currentStepIndex]] || ''
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
        Step {currentStepIndex + 1} of {steps.length} — {label}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Wizard Component                                              */
/* ------------------------------------------------------------------ */
export default function MigrationWizard({
  onClose,
  orgs = [],
  initialDryRun = false,
  initialSource,
  initialRepos,
  initialStep,
}) {
  const wizard = useMigrationWizard({ initialDryRun, initialSource, initialRepos, initialStep })

  const {
    steps,
    currentStep,
    currentStepIndex,
    nextStep,
    prevStep,
    goToStep,
    canGoBack,
    canGoNext,
    error,
    source,
    updateSource,
    repos,
    setRepos,
    updateRepo,
    workItems,
    updateWorkItems,
    wiki,
    updateWiki,
    aiPlan,
    updateAiPlan,
    schedule,
    updateSchedule,
    planId,
    importJobs,
    updateImportJobs,
    resetWizard,
    isDirty,
  } = wizard

  const oauthHook = useAzureOAuth()
  const orgsHook = useAzureOrganizations()
  const { toast } = useToast()
  const selectedRepos = repos.filter((r) => r.selected)
  const totalWarnings = selectedRepos.reduce(
    (sum, r) => sum + (r.risk?.flags || []).filter((f) => f.severity === 'warning').length,
    0
  )
  const blockerCount = currentStep === 'repoSelect'
    ? selectedRepos.reduce((sum, r) => sum + (r.risk?.flags || []).filter((f) => f.severity === 'blocker').length, 0)
    : 0
  const [direction, setDirection] = useState(1)
  const [showConfirm, setShowConfirm] = useState(false)
  const isMobile = useMobileBreakpoint()
  const [isMaximized, setIsMaximized] = useState(true)
  const handleToggleMaximize = useCallback(() => setIsMaximized((v) => !v), [])

  const handleNext = useCallback(() => { setDirection(1); nextStep() }, [nextStep])
  const handleBack = useCallback(() => { setDirection(-1); prevStep() }, [prevStep])

  // Auto-advance when sourceType is set on the sourceType step
  const prevSourceType = useRef(source.sourceType)
  useEffect(() => {
    if (source.sourceType && !prevSourceType.current && currentStepIndex === 0) {
      Promise.resolve().then(() => {
        setDirection(1)
        nextStep()
      })
    }
    prevSourceType.current = source.sourceType
  }, [source.sourceType, currentStepIndex, steps.length, nextStep])

  // Breadcrumb navigation for Azure flow
  const handleBreadcrumbNavigate = useCallback((target) => {
    setDirection(-1)
    if (target === 'org') {
      updateSource({ project: '', validated: false })
      setRepos([])
      goToStep('azureConnect')
    } else if (target === 'project') {
      setRepos([])
      goToStep('azureConnect')
    }
  }, [updateSource, setRepos, goToStep])

  // Start import for URL/GitHub flows
  const handleStartImport = useCallback(async () => {
    updateImportJobs({ importing: true })
    setDirection(1)

    try {
      const endpoint = '/api/import/url'
      let body

      if (source.sourceType === 'github') {
        body = {
          sourceUrl: source.githubSourceUrl,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.githubSourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      } else {
        let credentials
        if (source.authType === 'token') credentials = { type: 'token', token: source.authToken }
        else if (source.authType === 'basic') credentials = { type: 'basic', username: source.authUsername, password: source.authPassword }

        body = {
          sourceUrl: source.sourceUrl,
          credentials,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.sourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      }

      const headers = { 'Content-Type': 'application/json' }
      try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.success) {
        updateImportJobs({ jobId: data.jobId })
        toast.success('Import queued')
        nextStep()
      } else {
        updateImportJobs({
          importing: false,
          jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
        })
        toast.error(`Failed to start import — ${data.error || 'try again'}`)
        nextStep()
      }
    } catch (e) {
      updateImportJobs({
        importing: false,
        jobStatus: { status: 'failed', errorMessage: e.message, progressPct: 0 },
      })
      toast.errorFromException(e, { fallbackTitle: 'Failed to start import' })
      nextStep()
    }
  }, [source, updateImportJobs, nextStep, toast])

  // Close with dirty-state confirmation. React 19's compiler handles
  // memoization automatically; manual useCallback was tripping the
  // compiler's preserve-manual-memoization rule.
  const handleClose = () => {
    if (currentStep === 'summary') {
      onClose()
      return
    }
    if (isDirty) {
      setShowConfirm(true)
    } else {
      onClose()
    }
  }

  const handleConfirmClose = () => {
    setShowConfirm(false)
    onClose()
  }

  function renderStep() {
    switch (currentStep) {
      case 'sourceType':
        return <SourceTypeStep source={source} onChange={updateSource} onAdvance={handleNext} />
      case 'azureConnect':
        return <SourceStep source={source} onChange={updateSource} oauthHook={oauthHook} orgsHook={orgsHook} />
      case 'urlInput':
        return <UrlInputStep source={source} onChange={updateSource} />
      case 'githubSource':
        return <GitHubSourceStep source={source} onChange={updateSource} />
      case 'targetConfig':
        return (
          <TargetConfigStep
            source={source}
            onChange={updateSource}
            orgs={orgs}
            importJobs={importJobs}
            onUpdateImportJobs={updateImportJobs}
            onStartImport={handleStartImport}
          />
        )
      case 'repoSelect':
        return (
          <RepoSelectStep
            repos={repos}
            onSetRepos={setRepos}
            onUpdateRepo={updateRepo}
            source={source}
            onChange={updateSource}
          />
        )
      case 'repoConfig':
        return (
          <RepoConfigStep
            repos={selectedRepos}
            onUpdateRepo={(selectedIndex, updates) => {
              const originalIndex = repos.findIndex(
                (r) => r.name === selectedRepos[selectedIndex]?.name
              )
              if (originalIndex !== -1) updateRepo(originalIndex, updates)
            }}
            source={source}
            orgs={orgs}
            onChangeDestination={(orgLogin) => updateSource({ targetOrg: orgLogin })}
            onChangeSource={updateSource}
            onGoToStep={goToStep}
          />
        )
      case 'workItems':
        return <WorkItemsStep workItems={workItems} onUpdate={updateWorkItems} source={source} />
      case 'wiki':
        return <WikiStep wiki={wiki} onUpdate={updateWiki} source={source} />
      case 'aiReview':
        return <AIReviewStep aiPlan={aiPlan} onUpdate={updateAiPlan} wizard={wizard} />
      case 'schedule':
        return <ScheduleStep schedule={schedule} onUpdate={updateSchedule} wizard={wizard} />
      case 'progress':
        if (source.sourceType === 'azure') {
          return (
            <ProgressStep
              planId={planId}
              onPause={() => {}}
              onCancel={() => {}}
              onRetryTask={(taskId) => {
                // Forward the same credential the wizard used at execute time
                // so retries against TFVC/TFS sources don't 401.
                if (planId) migrationApi.retryTask(planId, taskId, {
                  azurePat: source.pat || null,
                  savedCredentialId: source.savedCredentialId || null,
                }).catch(() => {})
              }}
              onComplete={() => {
                setDirection(1)
                nextStep()
              }}
            />
          )
        }
        return (
          <SimpleProgressStep
            importJobs={importJobs}
            onUpdate={updateImportJobs}
            source={source}
          />
        )
      case 'summary':
        return (
          <SummaryStep
            planId={planId}
            onNewMigration={resetWizard}
            onViewHistory={onClose}
            preflightFlags={selectedRepos.flatMap((r) => r.risk?.flags || [])}
          />
        )
      default:
        return (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            <p className="text-lg font-medium">Unknown Step</p>
          </div>
        )
    }
  }

  const isAzure = source.sourceType === 'azure'
  const wizardTitle = isAzure ? 'Migration Wizard' : 'Import Repository'
  const wizardIcon = isAzure ? Rocket : Download
  const disableEscape = currentStep === 'progress' || currentStep === 'summary'

  const hideNextButton = currentStep === 'sourceType'
    || currentStep === 'targetConfig'
    || currentStep === 'schedule'
    || currentStep === 'progress'
    || currentStep === 'summary'

  const isProgressOrSummary = currentStep === 'progress' || currentStep === 'summary'
  const isFirstStep = currentStep === 'sourceType'
  const confirmMessage = currentStep === 'progress'
    ? 'A migration is in progress. Closing will not stop it, but you will lose visibility of the progress. Are you sure?'
    : 'You have unsaved progress. All entered data will be lost.'

  const showSidebar = !!source.sourceType
  const effectiveMaximized = isMobile || isMaximized

  // Footer
  const footer = (
    <div className="flex items-center justify-between gap-4">
      <Button variant="secondary" type="button" onClick={canGoBack ? handleBack : handleClose}>
        <ArrowLeft className="w-3.5 h-3.5" />
        {canGoBack ? 'Back' : 'Cancel'}
      </Button>

      {canGoNext && !hideNextButton && (
        <button
          type="button"
          onClick={handleNext}
          disabled={blockerCount > 0}
          title={blockerCount > 0 ? `${blockerCount} blocker(s) must be resolved — open a row to see options` : undefined}
          className={`inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white
            ${blockerCount > 0
              ? 'bg-slate-600 cursor-not-allowed opacity-60'
              : 'bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600'}
            shadow-md transition-all duration-200`}
        >
          Next
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )

  // Derive per-step status from live wizard state so the sidebar mirrors
  // what's happening in the main panel (loading spinner on a step running
  // async work, red disc on a step with blocking errors, etc.).
  const stepStates = (() => {
    const out = {}
    // Progress step: reflect import-job aggregate state. A failed job →
    // 'error', any still running → 'loading', all done → 'done'.
    const jobs = Array.isArray(importJobs) ? importJobs : []
    if (jobs.length > 0) {
      const anyFailed = jobs.some((j) => j?.status === 'failed' || j?.status === 'error')
      const anyRunning = jobs.some((j) => j?.status === 'running' || j?.status === 'pending' || j?.status === 'queued')
      const allDone = jobs.every((j) => j?.status === 'complete' || j?.status === 'completed')
      if (anyFailed) out.progress = 'error'
      else if (anyRunning) out.progress = 'loading'
      else if (allDone) out.progress = 'done'
    }
    // Summary step: 'done' once all jobs completed successfully.
    if (jobs.length > 0 && jobs.every((j) => j?.status === 'complete' || j?.status === 'completed')) {
      out.summary = 'done'
    }
    return out
  })()

  // Inline status hint under the current step name. Keeps the user aware
  // of background activity without forcing them to look at the main panel.
  const currentStepStatusDetail = (() => {
    if (currentStep === 'progress' && Array.isArray(importJobs) && importJobs.length > 0) {
      const running = importJobs.filter((j) => j?.status === 'running' || j?.status === 'pending').length
      const failed = importJobs.filter((j) => j?.status === 'failed' || j?.status === 'error').length
      if (failed > 0) return `${failed} ${failed === 1 ? 'falhou' : 'falharam'} · ${running} a correr`
      if (running > 0) return `${running} ${running === 1 ? 'job a correr' : 'jobs a correr'}`
    }
    return undefined
  })()

  // Sidebar content
  const sidebar = showSidebar ? (
    <SidebarStepper
      steps={steps}
      currentStepIndex={currentStepIndex}
      onGoToStep={goToStep}
      source={source}
      selectedCount={selectedRepos.length}
      totalWarnings={totalWarnings}
      onBreadcrumbNavigate={handleBreadcrumbNavigate}
      currentStep={currentStep}
      stepStates={stepStates}
      currentStepStatusDetail={currentStepStatusDetail}
    />
  ) : null

  return (
    <>
      <WizardPanel
        isOpen={true}
        onClose={handleClose}
        title={wizardTitle}
        icon={wizardIcon}
        stepInfo={STEP_META[currentStep] || null}
        sidebar={sidebar}
        footer={isProgressOrSummary || isFirstStep ? null : footer}
        disableEscape={disableEscape}
        isMaximized={isMaximized}
        isMobile={isMobile}
        onToggleMaximize={handleToggleMaximize}
      >
        <div data-testid="migration-wizard" role="form" aria-label={wizardTitle} className="p-4 md:p-6 lg:p-8">
          <div className={!isMobile ? 'max-w-5xl mx-auto' : ''}>
            {/* Horizontal stepper — desktop restored mode only */}
            {showSidebar && !effectiveMaximized && (
              <HorizontalStepper
                steps={steps}
                currentStepIndex={currentStepIndex}
                onGoToStep={goToStep}
              />
            )}

            {/* Mobile progress bar */}
            {showSidebar && isMobile && (
              <MobileProgressBar steps={steps} currentStepIndex={currentStepIndex} />
            )}

            {/* Dry-run badge — title/subtitle live in WizardPanel header to avoid duplication */}
            {schedule.isDryRun && (
              <div className="mb-6">
                <span
                  data-testid="dry-run-pill"
                  role="status"
                  aria-live="polite"
                  className="ds-animate-scale-in inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
                >
                  <Zap className="w-3 h-3" aria-hidden="true" />
                  Dry-Run Mode
                </span>
              </div>
            )}

            {/* Breadcrumb — mobile and restored mode (sidebar handles it in fullscreen) */}
            {(isMobile || !effectiveMaximized) && (
              <BreadcrumbNav
                source={source}
                currentStep={currentStep}
                selectedCount={selectedRepos.length}
                totalWarnings={totalWarnings}
                onNavigate={handleBreadcrumbNavigate}
              />
            )}

            {/* Error Display */}
            {error && (
              <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Step Content with Animation */}
            <div className="relative">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep}
                  data-testid={`wizard-step-${currentStep}`}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                >
                  <Suspense fallback={<SectionSpinner />}>{renderStep()}</Suspense>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </WizardPanel>

      {/* Dirty state confirmation modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmClose}
        title="Cancel Migration?"
        message={confirmMessage}
        confirmText="Discard & Close"
        cancelText="Continue Editing"
        variant="warning"
      />
    </>
  )
}
