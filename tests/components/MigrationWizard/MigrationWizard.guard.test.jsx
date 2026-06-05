/*
 * MigrationWizard extraction guard — characterization tests.
 *
 * Locks the wizard shell's render + dispatch behaviour before the split
 * (StepRenderer / StepperControl / useWizardNavigation / useWizardStepStatus /
 * ConfirmCloseModal). They pass against the current monolith by design.
 *
 * `useMigrationWizard` (the state machine, already unit-tested separately) is
 * mocked via vi.hoisted state so the shell's wiring is driven deterministically;
 * the step components + WizardPanel are stubbed to isolate the shell.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MigrationWizard from '@/components/MigrationWizard/MigrationWizard'

const h = vi.hoisted(() => ({ wizard: null, isMobile: false }))

function makeWizard(over = {}) {
  return {
    steps: ['sourceType', 'azureConnect', 'repoSelect', 'repoConfig', 'schedule', 'progress', 'summary'],
    currentStep: 'repoSelect',
    currentStepIndex: 2,
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    goToStep: vi.fn(),
    canGoBack: true,
    canGoNext: true,
    error: null,
    source: { sourceType: 'azure' },
    updateSource: vi.fn(),
    repos: [],
    setRepos: vi.fn(),
    updateRepo: vi.fn(),
    workItems: {}, updateWorkItems: vi.fn(),
    wiki: {}, updateWiki: vi.fn(),
    aiPlan: {}, updateAiPlan: vi.fn(),
    schedule: { isDryRun: false }, updateSchedule: vi.fn(),
    planId: null,
    importJobs: [],
    updateImportJobs: vi.fn(),
    resetWizard: vi.fn(),
    isDirty: false,
    ...over,
  }
}

vi.mock('@/hooks/useMigrationWizard', () => ({ useMigrationWizard: () => h.wizard }))
vi.mock('@/hooks/useAzureOAuth', () => ({ useAzureOAuth: () => ({}) }))
vi.mock('@/hooks/useAzureOrganizations', () => ({ useAzureOrganizations: () => ({}) }))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() } }) }))
vi.mock('@/hooks/useMobileBreakpoint', () => ({ useMobileBreakpoint: () => h.isMobile }))

// Render sidebar + children + footer flat so they're queryable.
vi.mock('@/components/ui/WizardPanel', () => ({
  WizardPanel: ({ children, footer, sidebar, title }) => (
    <div>
      <span>{title}</span>
      <div data-testid="wp-sidebar">{sidebar}</div>
      {children}
      <div data-testid="wp-footer">{footer}</div>
    </div>
  ),
}))

// Inline stubs (a shared helper can't be referenced from a hoisted vi.mock factory).
vi.mock('@/components/MigrationWizard/steps/SourceTypeStep', () => ({ default: () => <div data-testid="step-sourceType" /> }))
vi.mock('@/components/MigrationWizard/steps/SourceStep', () => ({ default: () => <div data-testid="step-azureConnect" /> }))
vi.mock('@/components/MigrationWizard/steps/UrlInputStep', () => ({ default: () => <div data-testid="step-urlInput" /> }))
vi.mock('@/components/MigrationWizard/steps/GitHubSourceStep', () => ({ default: () => <div data-testid="step-githubSource" /> }))
vi.mock('@/components/MigrationWizard/steps/TargetConfigStep', () => ({ default: () => <div data-testid="step-targetConfig" /> }))
vi.mock('@/components/MigrationWizard/steps/RepoSelectStep', () => ({ default: () => <div data-testid="step-repoSelect" /> }))
vi.mock('@/components/MigrationWizard/steps/RepoConfigStep', () => ({ default: () => <div data-testid="step-repoConfig" /> }))
vi.mock('@/components/MigrationWizard/steps/WorkItemsStep', () => ({ default: () => <div data-testid="step-workItems" /> }))
vi.mock('@/components/MigrationWizard/steps/WikiStep', () => ({ default: () => <div data-testid="step-wiki" /> }))
vi.mock('@/components/MigrationWizard/steps/AIReviewStep', () => ({ default: () => <div data-testid="step-aiReview" /> }))
vi.mock('@/components/MigrationWizard/steps/ScheduleStep', () => ({ default: () => <div data-testid="step-schedule" /> }))
vi.mock('@/components/MigrationWizard/steps/ProgressStep', () => ({ default: () => <div data-testid="step-progress" /> }))
vi.mock('@/components/MigrationWizard/steps/SimpleProgressStep', () => ({ default: () => <div data-testid="step-simpleProgress" /> }))
vi.mock('@/components/MigrationWizard/steps/SummaryStep', () => ({ default: () => <div data-testid="step-summary" /> }))
vi.mock('@/components/MigrationWizard/BreadcrumbNav', () => ({ default: () => <div data-testid="breadcrumb" /> }))

beforeEach(() => {
  vi.clearAllMocks()
  h.wizard = makeWizard()
  h.isMobile = false
})

describe('MigrationWizard guard — extraction safety net', () => {
  // --- StepRenderer (the switch) -------------------------------------------
  it('dispatches the eager step component for the current step', async () => {
    h.wizard = makeWizard({ currentStep: 'repoSelect' })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(await screen.findByTestId('step-repoSelect')).toBeInTheDocument()
  })

  it('dispatches the lazy SummaryStep at the summary step', async () => {
    h.wizard = makeWizard({ currentStep: 'summary', currentStepIndex: 6 })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(await screen.findByTestId('step-summary')).toBeInTheDocument()
  })

  it('renders SimpleProgressStep for a non-Azure source at the progress step', async () => {
    h.wizard = makeWizard({ currentStep: 'progress', source: { sourceType: 'github' } })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(await screen.findByTestId('step-simpleProgress')).toBeInTheDocument()
  })

  it('falls back to "Unknown Step" for an unrecognised step', async () => {
    h.wizard = makeWizard({ currentStep: 'bogus' })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(await screen.findByText('Unknown Step')).toBeInTheDocument()
  })

  // --- Dry-run badge (useWizardStepStatus-adjacent) ------------------------
  it('shows the dry-run badge only when schedule.isDryRun', () => {
    h.wizard = makeWizard({ schedule: { isDryRun: true } })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByTestId('dry-run-pill')).toBeInTheDocument()
  })

  it('hides the dry-run badge when not a dry run', () => {
    h.wizard = makeWizard({ schedule: { isDryRun: false } })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.queryByTestId('dry-run-pill')).toBeNull()
  })

  // --- Footer button logic (useWizardNavigation-adjacent) ------------------
  it('footer shows Back + Next on a normal mid-flow step', () => {
    h.wizard = makeWizard({ currentStep: 'repoSelect', canGoBack: true, canGoNext: true })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument()
  })

  it('footer shows Cancel (not Back) when canGoBack is false', () => {
    h.wizard = makeWizard({ currentStep: 'repoConfig', canGoBack: false, canGoNext: true })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
  })

  it('hides Next on a hideNextButton step (targetConfig) even when canGoNext', () => {
    h.wizard = makeWizard({ currentStep: 'targetConfig', canGoBack: true, canGoNext: true })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Next/i })).toBeNull()
  })

  // --- ConfirmCloseModal ----------------------------------------------------
  it('opens the confirm-close modal when cancelling a dirty wizard', () => {
    h.wizard = makeWizard({ currentStep: 'repoConfig', canGoBack: false, isDirty: true })
    render(<MigrationWizard onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(screen.getByText('Cancel Migration?')).toBeInTheDocument()
  })

  it('closes immediately (no modal) when cancelling a clean wizard', () => {
    const onClose = vi.fn()
    h.wizard = makeWizard({ currentStep: 'repoConfig', canGoBack: false, isDirty: false })
    render(<MigrationWizard onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByText('Cancel Migration?')).toBeNull()
  })

  // --- StepperControl (sidebar variant) ------------------------------------
  it('renders the sidebar stepper once a source type is chosen', () => {
    h.wizard = makeWizard({ source: { sourceType: 'azure' } })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByTestId('wp-sidebar')).not.toBeEmptyDOMElement()
  })

  it('omits the sidebar stepper before a source type is chosen', () => {
    h.wizard = makeWizard({ currentStep: 'sourceType', currentStepIndex: 0, source: { sourceType: '' } })
    render(<MigrationWizard onClose={vi.fn()} />)
    expect(screen.getByTestId('wp-sidebar')).toBeEmptyDOMElement()
  })
})
