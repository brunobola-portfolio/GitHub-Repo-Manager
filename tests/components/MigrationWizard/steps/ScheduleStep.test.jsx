/*
 * ScheduleStep — the migration execute step is the FRONTEND counterpart to the
 * server-side Free-tier meter (server/__tests__/migration-quota-route.test.js).
 * When executePlan() is rejected with the tier 403 (MIGRATION_QUOTA_EXCEEDED),
 * the step must (a) RENDER the error inline and (b) REVERT the optimistic
 * "starting…" transition — it must NOT advance to the progress step or record a
 * plan id, and the action button must be usable again. The happy path is the
 * control: success advances + records the plan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render-with-providers'
import ScheduleStep from '@/components/MigrationWizard/steps/ScheduleStep.jsx'

const createPlan = vi.fn()
const executePlan = vi.fn()
vi.mock('@/api/migration', () => ({
  migrationApi: {
    createPlan: (...a) => createPlan(...a),
    executePlan: (...a) => executePlan(...a),
  },
}))

function makeWizard(overrides = {}) {
  return {
    repos: [{ selected: true, name: 'app', size: 100, visibility: 'public' }],
    source: { type: 'azure', org: 'contoso', project: 'platform', targetOrg: 'contoso-gh', pat: 'pat_x' },
    setPlanId: vi.fn(),
    nextStep: vi.fn(),
    updateTaggingPolicy: vi.fn(),
    ...overrides,
  }
}

function renderStep(wizard) {
  return renderWithProviders(
    <ScheduleStep schedule={{ mode: 'now', isDryRun: false }} onUpdate={vi.fn()} wizard={wizard} />
  )
}

const startBtn = () => screen.getByRole('button', { name: /Start Migration/i })

beforeEach(() => {
  vi.clearAllMocks()
  createPlan.mockResolvedValue({ planId: 5 })
})

describe('ScheduleStep — tier 403 render + revert', () => {
  it('surfaces the quota message and does NOT advance to progress on MIGRATION_QUOTA_EXCEEDED', async () => {
    const wizard = makeWizard()
    executePlan.mockRejectedValue(Object.assign(
      new Error('The Free plan includes 1 full migration per month — upgrade to Pro for unlimited migrations.'),
      { status: 403, code: 'MIGRATION_QUOTA_EXCEEDED' },
    ))

    renderStep(wizard)
    fireEvent.click(startBtn())

    // RENDER: the inline error carries the upgrade message.
    expect(await screen.findByText(/1 full migration per month/i)).toBeInTheDocument()

    // REVERT: the optimistic "starting → progress" transition is rolled back —
    // no step advance, no plan recorded, and the button is usable again.
    expect(wizard.nextStep).not.toHaveBeenCalled()
    expect(wizard.setPlanId).not.toHaveBeenCalled()
    await waitFor(() => expect(startBtn()).not.toBeDisabled())
  })

  it('advances to the progress step and records the plan id on success', async () => {
    const wizard = makeWizard()
    executePlan.mockResolvedValue({})

    renderStep(wizard)
    fireEvent.click(startBtn())

    await waitFor(() => expect(wizard.nextStep).toHaveBeenCalledTimes(1))
    expect(wizard.setPlanId).toHaveBeenCalledWith(5)
    expect(executePlan).toHaveBeenCalledWith(5, { azurePat: 'pat_x', savedCredentialId: null })
  })
})
