import { useState, useCallback, useEffect, useRef } from 'react'
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
import SourceTypeStep from './steps/SourceTypeStep'
import SourceStep from './steps/SourceStep'
import UrlInputStep from './steps/UrlInputStep'
import GitHubSourceStep from './steps/GitHubSourceStep'
import TargetConfigStep from './steps/TargetConfigStep'
import RepoSelectStep from './steps/RepoSelectStep'
import RepoConfigStep from './steps/RepoConfigStep'
import WorkItemsStep from './steps/WorkItemsStep'
import WikiStep from './steps/WikiStep'
import AIReviewStep from './steps/AIReviewStep'
import ScheduleStep from './steps/ScheduleStep'
import ProgressStep from './steps/ProgressStep'
import SimpleProgressStep from './steps/SimpleProgressStep'
import SummaryStep from './steps/SummaryStep'
import BreadcrumbNav from './BreadcrumbNav'
import {
  ArrowLeft, ArrowRight, Rocket, Download, AlertCircle, AlertTriangle,
  Check, Radio, Link2, GitFork, Settings2, Sparkles,
  CalendarClock, Activity, Flag, Cloud, ChevronRight, Zap,
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
function SidebarStepper({ steps, currentStepIndex, onGoToStep, source, selectedCount, totalWarnings = 0, onBreadcrumbNavigate, currentStep }) {
  const VISIBLE_BREADCRUMB_STEPS = ['repoSelect', 'repoConfig', 'workItems', 'wiki', 'aiReview', 'schedule']
  const showBreadcrumb = source?.sourceType === 'azure' && VISIBLE_BREADCRUMB_STEPS.includes(currentStep)

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      {showBreadcrumb && (
        <div className="px-3 pt-4 pb-1">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500/[0.08] to-violet-500/[0.08] dark:from-indigo-500/[0.12] dark:to-violet-500/[0.12] border border-indigo-500/10 dark:border-indigo-500/15">
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

      {/* Progress summary */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Progress
          </span>
          <span className="text-[11px] font-bold text-indigo-500 dark:text-indigo-400 tabular-nums">
            {currentStepIndex + 1}/{steps.length}
          </span>
        </div>
        <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500"
            initial={false}
            animate={{ width: `${steps.length > 1 ? ((currentStepIndex) / (steps.length - 1)) * 100 : 0}%` }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      {/* Step list */}
      <nav aria-label="Wizard steps" className="flex-1 px-3 py-2 overflow-y-auto custom-scrollbar">
        <ol className="relative">
          {/* Vertical track line */}
          <div
            className="absolute left-[22px] top-3 bottom-3 w-[2px] rounded-full bg-slate-100 dark:bg-slate-800"
            aria-hidden="true"
          />
          {/* Animated progress fill on the track */}
          <motion.div
            className="absolute left-[22px] top-3 w-[2px] rounded-full bg-gradient-to-b from-emerald-400 via-emerald-400 to-indigo-500"
            aria-hidden="true"
            initial={false}
            animate={{
              height: steps.length > 1
                ? `${(currentStepIndex / (steps.length - 1)) * 100}%`
                : '0%',
            }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          />

          {steps.map((step, index) => {
            const isActive = index === currentStepIndex
            const isCompleted = index < currentStepIndex
            const label = STEP_LABELS[step] || step
            const hint = STEP_HINTS[step] || ''
            const StepIcon = STEP_ICONS[step] || Radio

            return (
              <li key={step} className="relative">
                <button
                  type="button"
                  onClick={() => onGoToStep(step)}
                  disabled={!isCompleted}
                  aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-all duration-300 group relative
                    ${isActive
                      ? 'bg-gradient-to-r from-indigo-500/[0.12] to-violet-500/[0.08] dark:from-indigo-500/[0.18] dark:to-violet-500/[0.1]'
                      : isCompleted
                        ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer'
                        : 'cursor-default'
                    }
                  `}
                >
                  {/* Step indicator */}
                  <div className="relative z-10 shrink-0">
                    {isCompleted ? (
                      <div className="w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_8px_rgba(16,185,129,0.4)]">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </div>
                    ) : isActive ? (
                      <div className="w-[18px] h-[18px] rounded-full bg-indigo-500 flex items-center justify-center shadow-[0_0_12px_rgba(99,102,241,0.5)] ring-[3px] ring-indigo-500/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    ) : (
                      <div className="w-[18px] h-[18px] rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                      </div>
                    )}
                  </div>

                  {/* Step content */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className={`
                      w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300
                      ${isActive
                        ? 'bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-500 dark:text-indigo-400'
                        : isCompleted
                          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 group-hover:bg-emerald-500/15'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'
                      }
                    `}>
                      <StepIcon className="w-3.5 h-3.5" strokeWidth={2} />
                    </div>

                    <div className="min-w-0">
                      <div className={`
                        text-[13px] font-semibold truncate leading-tight transition-colors duration-300
                        ${isActive
                          ? 'text-indigo-700 dark:text-indigo-300'
                          : isCompleted
                            ? 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                            : 'text-slate-400 dark:text-slate-600'
                        }
                      `}>
                        {label}
                      </div>
                      <div className={`
                        text-[10px] truncate leading-tight mt-0.5 transition-colors duration-300
                        ${isActive
                          ? 'text-indigo-500/70 dark:text-indigo-400/60'
                          : isCompleted
                            ? 'text-slate-400 dark:text-slate-500'
                            : 'text-slate-300 dark:text-slate-700'
                        }
                      `}>
                        {hint}
                      </div>
                    </div>
                  </div>

                  {/* Active indicator bar */}
                  {isActive && (
                    <motion.div
                      layoutId="activeStepBar"
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-indigo-500"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Bottom ambient glow */}
      <div className="px-4 pb-4 pt-2">
        <div className="h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
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
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
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

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
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
      toast.error(`Failed to start import — ${e.message || 'try again'}`)
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
                if (planId) migrationApi.retryTask(planId, taskId).catch(() => {})
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
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
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
          className={`ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white
            ${blockerCount > 0
              ? 'bg-slate-600 cursor-not-allowed opacity-60'
              : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'}
            shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/25 transition-all duration-200`}
        >
          Next
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )

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
          <div className={!isMobile ? 'max-w-3xl mx-auto' : ''}>
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

            {/* Step title/subtitle */}
            {STEP_META[currentStep] && (
              <div className="mb-6">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className={`font-bold tracking-tight text-slate-900 dark:text-slate-50 ${!isMobile ? 'text-xl' : 'text-lg'}`}>
                    {STEP_META[currentStep].title}
                  </h3>
                  {schedule.isDryRun && (
                    <span
                      data-testid="dry-run-pill"
                      role="status"
                      aria-live="polite"
                      className="ds-animate-scale-in inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
                    >
                      <Zap className="w-3 h-3" aria-hidden="true" />
                      Dry-Run Mode
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {STEP_META[currentStep].subtitle}
                </p>
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
                  {renderStep()}
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
