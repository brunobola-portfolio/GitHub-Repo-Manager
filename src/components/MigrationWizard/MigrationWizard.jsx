import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal, ModalFooter } from '../ui/Modal'
import { useMigrationWizard } from '../../hooks/useMigrationWizard'
import { useAzureOAuth } from '../../hooks/useAzureOAuth'
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
import { ArrowLeft, ArrowRight, Rocket, Download, AlertCircle } from 'lucide-react'

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
  sourceType:  { title: 'Choose Source',            subtitle: 'Select where to import your repositories from.' },
  azureConnect:{ title: 'Connect to Azure DevOps',  subtitle: 'Enter your organization and credentials.' },
  urlInput:    { title: 'Repository URL',            subtitle: 'Enter the clone URL of the Git repository.' },
  githubSource:{ title: 'GitHub Repository',         subtitle: 'Enter the GitHub repository to import.' },
  targetConfig:{ title: 'Target Configuration',      subtitle: 'Configure where to import the repository.' },
  repoSelect:  { title: 'Select Repositories',       subtitle: 'Choose which repositories to migrate.' },
  repoConfig:  { title: 'Configure Repositories',    subtitle: 'Set target names and options for each repo.' },
  workItems:   { title: 'Work Items',                subtitle: 'Configure work item migration settings.' },
  wiki:        { title: 'Wiki',                      subtitle: 'Configure wiki migration settings.' },
  aiReview:    { title: 'AI Review',                 subtitle: 'Review the migration plan with AI assistance.' },
  schedule:    { title: 'Schedule',                  subtitle: 'Choose when to run the migration.' },
  progress:    { title: 'Migration in Progress',     subtitle: 'Your migration is running.' },
  summary:     { title: 'Migration Complete',        subtitle: 'Review the results of your migration.' },
}

const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
}

export default function MigrationWizard({ onClose, orgs = [] }) {
  const wizard = useMigrationWizard()

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
  } = wizard

  const oauthHook = useAzureOAuth()

  const selectedRepos = repos.filter((r) => r.selected)
  const [direction, setDirection] = useState(1)

  const handleNext = () => { setDirection(1); nextStep() }
  const handleBack = () => { setDirection(-1); prevStep() }

  // Auto-advance when sourceType is set on the sourceType step.
  // This runs AFTER the steps array has been recomputed with the new sourceType,
  // avoiding stale closure issues with setTimeout-based auto-advance.
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
      let endpoint, body

      if (source.sourceType === 'github') {
        endpoint = '/api/import/url'
        body = {
          sourceUrl: source.githubSourceUrl,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.githubSourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      } else {
        // URL import
        endpoint = '/api/import/url'
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
        // Navigate to progress step
        nextStep()
      } else {
        updateImportJobs({
          importing: false,
          jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
        })
        nextStep()
      }
    } catch (e) {
      updateImportJobs({
        importing: false,
        jobStatus: { status: 'failed', errorMessage: e.message, progressPct: 0 },
      })
      nextStep()
    }
  }, [source, updateImportJobs, nextStep])

  function renderStep() {
    switch (currentStep) {
      case 'sourceType':
        return (
          <SourceTypeStep
            source={source}
            onChange={updateSource}
          />
        )
      case 'azureConnect':
        return <SourceStep source={source} onChange={updateSource} oauthHook={oauthHook} />
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
        return <RepoSelectStep repos={repos} onSetRepos={setRepos} source={source} onChange={updateSource} />
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

  // Hide Next button on sourceType (auto-advance) and targetConfig (has its own Import button)
  // Also hide after schedule step for Azure (progress handles itself)
  const hideNextButton = currentStep === 'sourceType'
    || currentStep === 'targetConfig'
    || currentStep === 'progress'
    || currentStep === 'summary'

  const footer = (
    <ModalFooter align="between">
      <button
        type="button"
        onClick={canGoBack ? handleBack : onClose}
        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
          text-slate-600 dark:text-slate-300
          bg-slate-100 dark:bg-slate-800
          hover:bg-slate-200 dark:hover:bg-slate-700
          transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {canGoBack ? 'Back' : 'Cancel'}
      </button>

      {canGoNext && !hideNextButton && (
        <button
          type="button"
          onClick={handleNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl
            text-white
            bg-gradient-to-r from-indigo-500 to-purple-600
            hover:from-indigo-600 hover:to-purple-700
            shadow-lg shadow-indigo-500/25
            transition-all"
        >
          Next
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </ModalFooter>
  )

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={wizardTitle}
      icon={wizardIcon}
      size="xl"
      footer={footer}
    >
      <div role="form" aria-label={wizardTitle}>
        {/* Step Indicator — hide on sourceType step when no source selected */}
        {source.sourceType && (
          <nav aria-label="Wizard steps" className="mb-4">
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
                        onClick={() => goToStep(step)}
                        disabled={!isCompleted}
                        aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                        aria-current={isActive ? 'step' : undefined}
                        className={`
                          flex items-center justify-center rounded-full text-xs font-bold transition-all
                          ${isActive
                            ? 'w-8 h-8 bg-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                            : isCompleted
                              ? 'w-6 h-6 bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                              : 'w-6 h-6 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                          }
                        `}
                      >
                        {isCompleted ? '✓' : index + 1}
                      </button>
                      <span className={`mt-1.5 text-[10px] font-medium truncate max-w-[52px] text-center
                        ${isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {label}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${isCompleted ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}

        {/* Step title/subtitle from STEP_META */}
        {STEP_META[currentStep] && (
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {STEP_META[currentStep].title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {STEP_META[currentStep].subtitle}
            </p>
          </div>
        )}

        {/* Breadcrumb Navigation (Azure only) */}
        <BreadcrumbNav
          source={source}
          currentStep={currentStep}
          selectedCount={selectedRepos.length}
          onNavigate={handleBreadcrumbNavigate}
        />

        {/* Error Display */}
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step Content with Animation */}
        <div className="relative min-h-[280px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center p-8">
                    <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                }
              >
                {renderStep()}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  )
}
