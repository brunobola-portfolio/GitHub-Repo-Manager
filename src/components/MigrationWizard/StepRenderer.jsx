import { lazy, Suspense } from 'react'
import { migrationApi } from '../../api/migration'
import { SectionSpinner } from '../ui/Spinner'
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

/**
 * StepRenderer — pure dispatch of the current wizard step to its step
 * component. Every dependency arrives through a single `ctx` object (assembled
 * in MigrationWizard) so the prop surface stays flat despite the breadth of
 * the switch. Holds no state; lazy steps are caught by a local Suspense
 * boundary so the wizard shell stays agnostic of which steps are code-split.
 */
export default function StepRenderer({ ctx }) {
  const {
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
  } = ctx

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
              onReplaceRetryTask={(taskId) => {
                // Destructive recovery: delete the conflicting target and re-run.
                if (planId) migrationApi.replaceRetryTask(planId, taskId, {
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
            onReplaceRetry={(error) => {
              // Delete the conflicting target and re-run the single task, then
              // jump to Progress to watch the live re-run over SSE.
              if (!planId) return
              migrationApi.replaceRetryTask(planId, error.taskId, {
                azurePat: source.pat || null,
                savedCredentialId: source.savedCredentialId || null,
              }).then(() => {
                setDirection(1)
                goToStep('progress')
              }).catch(() => {})
            }}
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

  return <Suspense fallback={<SectionSpinner />}>{renderStep()}</Suspense>
}
