import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WizardPanel } from '../ui/WizardPanel'
import { Button } from '../ui/Button'
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useMigrationWizard } from '../../hooks/useMigrationWizard'
import { useAzureOAuth } from '../../hooks/useAzureOAuth'
import { useAzureOrganizations } from '../../hooks/useAzureOrganizations'
import { useToast } from '../../hooks/useToast'
import { useWizardNavigation } from './hooks/useWizardNavigation'
import StepRenderer from './StepRenderer'
import BreadcrumbNav from './BreadcrumbNav'
import { SidebarStepper, HorizontalStepper, MobileProgressBar } from './Steppers'
import { ArrowLeft, ArrowRight, Rocket, Download, AlertCircle, Zap } from 'lucide-react'

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
  const { direction, setDirection, handleNext, handleBack, handleStartImport } = useWizardNavigation({
    source,
    currentStepIndex,
    steps,
    nextStep,
    prevStep,
    updateImportJobs,
    toast,
  })
  const [showConfirm, setShowConfirm] = useState(false)
  const isMobile = useMobileBreakpoint()
  const [isMaximized, setIsMaximized] = useState(true)
  const handleToggleMaximize = useCallback(() => setIsMaximized((v) => !v), [])

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
  }, [setDirection, updateSource, setRepos, goToStep])

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

  // Everything the step switch needs, bundled into one object so StepRenderer
  // stays a flat, presentational dispatcher (mirrors the RepoCard handlers
  // pattern). Rebuilt each render; StepRenderer is not memoized.
  const stepCtx = {
    currentStep,
    source,
    updateSource,
    handleNext,
    oauthHook,
    orgsHook,
    orgs,
    importJobs,
    updateImportJobs,
    handleStartImport,
    repos,
    setRepos,
    updateRepo,
    selectedRepos,
    goToStep,
    workItems,
    updateWorkItems,
    wiki,
    updateWiki,
    aiPlan,
    updateAiPlan,
    wizard,
    schedule,
    updateSchedule,
    planId,
    resetWizard,
    onClose,
    setDirection,
    nextStep,
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
              : 'bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)]'}
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
      if (failed > 0) return `${failed} ${failed === 1 ? 'failed' : 'failed'} · ${running} running`
      if (running > 0) return `${running} ${running === 1 ? 'job running' : 'jobs running'}`
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
                  <StepRenderer ctx={stepCtx} />
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
