import { Suspense, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal, ModalFooter } from '../ui/Modal'
import { useMigrationWizard } from '../../hooks/useMigrationWizard'
import { migrationApi } from '../../api/migration'
import SourceStep from './steps/SourceStep'
import RepoSelectStep from './steps/RepoSelectStep'
import RepoConfigStep from './steps/RepoConfigStep'
import WorkItemsStep from './steps/WorkItemsStep'
import WikiStep from './steps/WikiStep'
import AIReviewStep from './steps/AIReviewStep'
import ScheduleStep from './steps/ScheduleStep'
import ProgressStep from './steps/ProgressStep'
import SummaryStep from './steps/SummaryStep'
import { ArrowLeft, ArrowRight, Rocket, AlertCircle } from 'lucide-react'

const STEP_LABELS = {
  source: 'Source',
  repoSelect: 'Repos',
  repoConfig: 'Configure',
  workItems: 'Work Items',
  wiki: 'Wiki',
  aiReview: 'AI Review',
  schedule: 'Schedule',
  progress: 'Progress',
  summary: 'Summary',
}

function StepPlaceholder({ label }) {
  return (
    <div className="p-8 text-center text-gray-500 dark:text-gray-400">
      <p className="text-lg font-medium">{label}</p>
      <p className="text-sm mt-1">Coming soon...</p>
    </div>
  )
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

export default function MigrationWizard({ onClose }) {
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
    setPlanId,
    resetWizard,
  } = wizard

  // Only selected repos for the config step
  const selectedRepos = repos.filter((r) => r.selected)

  // Track animation direction: +1 = forward, -1 = backward
  const [direction, setDirection] = useState(1)

  const handleNext = () => { setDirection(1); nextStep() }
  const handleBack = () => { setDirection(-1); prevStep() }

  function renderStep() {
    switch (currentStep) {
      case 'source':
        return <SourceStep source={source} onChange={updateSource} />
      case 'repoSelect':
        return <RepoSelectStep repos={repos} onSetRepos={setRepos} source={source} />
      case 'repoConfig':
        return (
          <RepoConfigStep
            repos={selectedRepos}
            onUpdateRepo={(selectedIndex, updates) => {
              // Map the selected-repo index back to the original repos array index
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
      case 'summary':
        return (
          <SummaryStep
            planId={planId}
            onNewMigration={resetWizard}
            onViewHistory={onClose}
          />
        )
      default:
        return <StepPlaceholder label="Unknown Step" />
    }
  }

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

      {canGoNext && (
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
      title="Migration Wizard"
      icon={Rocket}
      size="xl"
      footer={footer}
    >
      <div role="form" aria-label="Migration Wizard">
        {/* Step Indicator */}
        <nav aria-label="Wizard steps" className="mb-6">
          <ol className="flex items-center justify-between gap-1">
            {steps.map((step, index) => {
              const isActive = index === currentStepIndex
              const isCompleted = index < currentStepIndex
              const label = STEP_LABELS[step] || step

              return (
                <li
                  key={step}
                  className="flex flex-col items-center flex-1 min-w-0"
                  aria-current={isActive ? 'step' : undefined}
                >
                  <button
                    type="button"
                    onClick={() => goToStep(step)}
                    disabled={!isCompleted}
                    className={`
                      w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                      ${isActive
                        ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                        : isCompleted
                          ? 'bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                      }
                    `}
                    aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  >
                    {isCompleted ? '\u2713' : index + 1}
                  </button>
                  <span
                    className={`
                      mt-1.5 text-[10px] font-medium truncate max-w-full text-center
                      ${isActive
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : isCompleted
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }
                    `}
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>

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
