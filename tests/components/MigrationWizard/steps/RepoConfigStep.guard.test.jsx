/*
 * RepoConfigStep extraction guard — characterization tests.
 *
 * Locks the render + behaviour of the ~334-line repo-card loop and the
 * dashboard header before the component is split (DashboardHeader /
 * DescriptionField / RepoMetadataBadges / ConflictResolutionPanel / RepoCard).
 * They pass against the current monolith by design — a refactor safety net to
 * re-run after every extraction.
 *
 * The five data hooks are mocked (via vi.hoisted state) so render is
 * deterministic and conflict / AI / branch state can be driven per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RepoConfigStep from '@/components/MigrationWizard/steps/RepoConfigStep.jsx'

const h = vi.hoisted(() => ({
  conflicts: {},
  aiAvailable: true,
  aiNotice: '',
  expandedBranches: {},
  azureEmptyRepos: [],
  azureProjects: [],
  checkConflict: vi.fn(),
  setConflicts: vi.fn(),
  toggleBranchExpand: vi.fn(),
  suggest: vi.fn(),
  setAiNotice: vi.fn(),
}))

vi.mock('@/components/MigrationWizard/hooks/useBranchCache', () => ({
  useBranchCache: () => ({
    expandedBranches: h.expandedBranches,
    branchCache: {},
    loadingBranches: {},
    toggleBranchExpand: h.toggleBranchExpand,
  }),
}))
vi.mock('@/components/MigrationWizard/hooks/useAzureProjectData', () => ({
  useAzureProjectData: () => ({
    azureProjectRepoNames: new Set(),
    azureEmptyRepos: h.azureEmptyRepos,
    azureProjects: h.azureProjects,
    projectsLoading: false,
  }),
}))
vi.mock('@/components/MigrationWizard/hooks/useRepoNameConflicts', () => ({
  useRepoNameConflicts: () => ({ conflicts: h.conflicts, setConflicts: h.setConflicts, checkConflict: h.checkConflict }),
}))
vi.mock('@/components/MigrationWizard/hooks/useAiAvailability', () => ({
  useAiAvailability: () => ({ aiAvailable: h.aiAvailable, aiNotice: h.aiNotice, setAiNotice: h.setAiNotice }),
}))
vi.mock('@/hooks/useRepoDescriptionSuggestion', () => ({
  useRepoDescriptionSuggestion: () => ({ suggest: h.suggest }),
}))

const makeRepo = (over = {}) => ({
  id: 1,
  name: 'demo',
  visibility: 'public',
  size: 2048,
  language: 'JavaScript',
  branches: 3,
  targetName: 'demo',
  risk: { level: 'ok', flags: [] },
  ...over,
})

function renderStep(overrides = {}) {
  const props = {
    repos: [makeRepo()],
    onUpdateRepo: vi.fn(),
    source: { sourceType: 'github', validated: true, targetOrg: 'acme', targetName: 'demo' },
    orgs: [{ login: 'acme' }],
    onChangeDestination: vi.fn(),
    onGoToStep: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<RepoConfigStep {...props} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.conflicts = {}
  h.aiAvailable = true
  h.aiNotice = ''
  h.expandedBranches = {}
  h.azureEmptyRepos = []
  h.azureProjects = []
  h.suggest.mockResolvedValue({ description: 'AI desc', quotaExceeded: false })
})

describe('RepoConfigStep guard — extraction safety net', () => {
  it('renders the empty state when no repos are selected', () => {
    renderStep({ repos: [] })
    expect(screen.getByText('No repositories selected')).toBeInTheDocument()
  })

  // --- DashboardHeader target ----------------------------------------------
  it('renders the GitHub destination header', () => {
    renderStep()
    expect(screen.getByText('Importing to')).toBeInTheDocument()
  })

  it('renders the Azure DevOps in-place header', () => {
    renderStep({
      source: { sourceType: 'azure', validated: true, azureTargetMode: 'azure-devops', org: 'contoso', project: 'plat', targetProject: 'plat' },
    })
    expect(screen.getByText('Target project')).toBeInTheDocument()
    expect(screen.getByText('in-place')).toBeInTheDocument()
  })

  // --- RepoCard + RepoMetadataBadges targets -------------------------------
  it('renders a repo card with target-name input and metadata badges', () => {
    renderStep()
    expect(screen.getByLabelText('Target repository name for demo')).toBeInTheDocument()
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText('3 branches')).toBeInTheDocument()
  })

  it('renders one card per repo (multi-repo)', () => {
    renderStep({ repos: [makeRepo({ id: 1, name: 'alpha', targetName: 'alpha' }), makeRepo({ id: 2, name: 'beta', targetName: 'beta' })] })
    expect(screen.getByLabelText('Target repository name for alpha')).toBeInTheDocument()
    expect(screen.getByLabelText('Target repository name for beta')).toBeInTheDocument()
  })

  // --- Visibility (GitHub only) --------------------------------------------
  it('toggles visibility on GitHub and calls onUpdateRepo with the flipped value', () => {
    const { props } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Toggle visibility: currently public/i }))
    expect(props.onUpdateRepo).toHaveBeenCalledWith(0, { visibility: 'private' })
  })

  it('hides the visibility toggle for an Azure DevOps in-place target', () => {
    renderStep({
      source: { sourceType: 'azure', validated: true, azureTargetMode: 'azure-devops', org: 'contoso', project: 'plat', targetProject: 'plat' },
    })
    expect(screen.queryByRole('button', { name: /Toggle visibility/i })).toBeNull()
  })

  // --- Expand toggle + DescriptionField target -----------------------------
  it('reveals the description field and LFS control only when the card is expanded', () => {
    renderStep()
    expect(screen.queryByText('Description')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Toggle advanced options/i }))
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Git LFS')).toBeInTheDocument()
  })

  // --- Target-name conflict check behaviour --------------------------------
  it('runs a conflict check when the target name changes', () => {
    renderStep()
    fireEvent.change(screen.getByLabelText('Target repository name for demo'), { target: { value: 'renamed' } })
    expect(h.checkConflict).toHaveBeenCalledWith('demo', 'renamed')
  })

  it('clears a previously-confirmed Replace intent when the target name is edited', () => {
    // Repo has conflictAction='replace' (user already confirmed Replace for this name).
    const { props } = renderStep({
      repos: [makeRepo({ conflictAction: 'replace', targetName: 'demo' })],
    })
    // h.conflicts is {} — the will-replace badge is driven by conflictAction on the repo,
    // not a live conflicts entry; we only need to confirm onUpdateRepo behaviour.
    fireEvent.change(screen.getByLabelText('Target repository name for demo'), { target: { value: 'demo-v2' } })
    // Must clear conflictAction so the stale destructive intent doesn't carry over.
    expect(props.onUpdateRepo).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ targetName: 'demo-v2', conflictAction: undefined }),
    )
    // setConflicts must have been poked to reset the row away from will-replace.
    expect(h.setConflicts).toHaveBeenCalled()
  })

  // --- ConflictResolutionPanel target --------------------------------------
  it('auto-expands a conflicted card with Replace / Rename actions', () => {
    h.conflicts = { demo: 'conflict' }
    renderStep()
    expect(screen.getByText('A repository with this name already exists')).toBeInTheDocument()
  })

  it('Replace opens a confirm modal; confirming sets conflictAction', async () => {
    h.conflicts = { demo: 'conflict' }
    // source.targetOrg='acme', repo.targetName='demo' → repoFullName = 'acme/demo'
    const { props } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }))
    // Modal shown; conflictAction not yet set (sync effect may have fired hasConflict: true, but no replace action yet)
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
    expect(props.onUpdateRepo).not.toHaveBeenCalledWith(0, expect.objectContaining({ conflictAction: 'replace' }))

    // type-to-confirm using the full target name the component passes to the modal
    fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'acme/demo' } })
    fireEvent.click(screen.getByRole('button', { name: /delete & replace/i }))

    expect(props.onUpdateRepo).toHaveBeenCalledWith(0, expect.objectContaining({ conflictAction: 'replace', hasConflict: false }))
  })

  // --- AI description generation + quota notice ----------------------------
  it('generates an AI description and surfaces the quota notice', async () => {
    h.suggest.mockResolvedValue({ description: 'AI generated', quotaExceeded: true })
    const { props } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Toggle advanced options/i }))
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/i }))
    expect(await screen.findByText(/AI quota reached/i)).toBeInTheDocument()
    expect(props.onUpdateRepo).toHaveBeenCalledWith(0, { description: 'AI generated' })
  })

  it('labels the description button "Suggest" when AI is unavailable', () => {
    h.aiAvailable = false
    renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Toggle advanced options/i }))
    expect(screen.getByRole('button', { name: /Suggest/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate with AI/i })).toBeNull()
  })

  // --- Block-before-run guard: hasConflict sync effect ----------------------
  it('syncs hasConflict onto repo state when a conflict is present', async () => {
    h.conflicts = { demo: 'conflict' }
    const { props } = renderStep()
    await waitFor(() => {
      expect(props.onUpdateRepo).toHaveBeenCalledWith(0, { hasConflict: true })
    })
  })

  // --- Branch load-on-expand behaviour -------------------------------------
  it('requests branch expansion when the branches button is clicked', () => {
    renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Toggle advanced options/i }))
    fireEvent.click(screen.getByRole('button', { name: /All branches/i }))
    expect(h.toggleBranchExpand).toHaveBeenCalled()
  })
})
