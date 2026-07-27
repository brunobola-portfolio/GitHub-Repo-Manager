import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReleasesTab } from '@/components/RepoDetail/ReleasesTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

// Focus trap uses real DOM APIs we don't need in this test
vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

const sampleReleases = [
  {
    id: 1,
    name: 'v2.0.0 — Stable',
    tag_name: 'v2.0.0',
    body: 'First stable release with all the goodies.',
    draft: false,
    prerelease: false,
    author: { login: 'octocat' },
    published_at: '2026-04-10T12:00:00Z',
    html_url: 'https://github.com/owner/repo/releases/tag/v2.0.0'
  },
  {
    id: 2,
    name: 'v2.1.0-rc.1',
    tag_name: 'v2.1.0-rc.1',
    body: 'Release candidate for the 2.1 line.',
    draft: false,
    prerelease: true,
    author: { login: 'octocat' },
    published_at: '2026-04-11T12:00:00Z',
    html_url: 'https://github.com/owner/repo/releases/tag/v2.1.0-rc.1'
  },
  {
    id: 3,
    name: 'Draft Release',
    tag_name: 'v-draft',
    body: '',
    draft: true,
    prerelease: false,
    author: { login: 'octocat' },
    created_at: '2026-04-11T13:00:00Z'
  }
]

function makeApi(overrides = {}) {
  return {
    fetchReleases: vi.fn().mockResolvedValue({ data: sampleReleases }),
    createRelease: vi.fn().mockResolvedValue({ id: 999, tag_name: 'v9.9.9' }),
    deleteRelease: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ReleasesTab — list rendering', () => {
  it('renders releases list with correct count and badges', async () => {
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    // Header reflects count
    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )

    // Names + tags visible
    expect(screen.getByText('v2.0.0 — Stable')).toBeInTheDocument()
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    // v2.1.0-rc.1 appears twice (name + tag pill) — list is fine
    expect(screen.getAllByText('v2.1.0-rc.1').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Draft Release')).toBeInTheDocument()

    // Pre-release and Draft badges present
    expect(screen.getByText('Pre-release')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()

    // External "View" link for published releases
    const viewLinks = screen.getAllByRole('link', { name: /View/ })
    expect(viewLinks.length).toBeGreaterThanOrEqual(2)
    expect(viewLinks[0]).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/releases/tag/v2.0.0'
    )
    expect(viewLinks[0]).toHaveAttribute('target', '_blank')
    expect(viewLinks[0]).toHaveAttribute('rel', 'noopener noreferrer')

    expect(api.fetchReleases).toHaveBeenCalledTimes(1)
  })

  it('renders empty state when no releases exist', async () => {
    const api = makeApi({
      fetchReleases: vi.fn().mockResolvedValue({ data: [] })
    })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText('No releases yet')).toBeInTheDocument()
    )
    expect(screen.getByText(/0 Releases/)).toBeInTheDocument()
  })

  // A fetch failure must never render the empty state: saying "No releases
  // yet" when GitHub actually 500'd states something false as fact, and the
  // user has no reason to retry because nothing looks broken.
  it('reports a load failure instead of claiming the repo has no releases', async () => {
    const api = makeApi({
      fetchReleases: vi.fn().mockRejectedValue(new Error('network down'))
    })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
    )
    expect(screen.queryByText('No releases yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('retry re-runs the fetch', async () => {
    const fetchReleases = vi.fn().mockRejectedValueOnce(new Error('network down'))
    const api = makeApi({ fetchReleases })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
    fetchReleases.mockResolvedValueOnce(sampleReleases)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.getByText('v2.0.0 — Stable')).toBeInTheDocument())
  })

  it('accepts response shape { data: [...] } and bare array', async () => {
    const api = makeApi({
      fetchReleases: vi.fn().mockResolvedValue([sampleReleases[0]])
    })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/1 Release\b/)).toBeInTheDocument()
    )
    expect(screen.getByText('v2.0.0 — Stable')).toBeInTheDocument()
  })
})

describe('ReleasesTab — create release flow', () => {
  it('opens the create form, publishes a release, and refreshes the list', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: /New Release/i }))

    const tagInput = screen.getByPlaceholderText('v1.0.0')
    const titleInput = screen.getByPlaceholderText('Release title')
    const notesInput = screen.getByPlaceholderText('Describe this release...')

    await user.type(tagInput, 'v3.0.0')
    await user.type(titleInput, 'Three Point Oh')
    await user.type(notesInput, 'Big release.')

    await user.click(screen.getByRole('button', { name: /Publish/i }))

    await waitFor(() => {
      expect(api.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_name: 'v3.0.0',
          name: 'Three Point Oh',
          body: 'Big release.',
          draft: false,
          prerelease: false
        })
      )
    })
    // List is refreshed after create
    expect(api.fetchReleases).toHaveBeenCalledTimes(2)
    // Success message rendered
    expect(
      screen.getByText(/Release "v3\.0\.0" created/)
    ).toBeInTheDocument()
  })

  it('disables Publish while tag_name is empty', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /New Release/i }))
    const publishBtn = screen.getByRole('button', { name: /Publish/i })
    expect(publishBtn).toBeDisabled()
  })

  it('surfaces API error from createRelease', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      createRelease: vi.fn().mockRejectedValue(new Error('Tag already exists'))
    })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /New Release/i }))
    await user.type(screen.getByPlaceholderText('v1.0.0'), 'v2.0.0')
    await user.click(screen.getByRole('button', { name: /Publish/i }))

    await waitFor(() =>
      expect(screen.getByText('Tag already exists')).toBeInTheDocument()
    )
  })

  it('fires a success toast when a release is published', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    renderWithProviders(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /New Release/i }))
    await user.type(screen.getByPlaceholderText('v1.0.0'), 'v3.0.0')
    await user.click(screen.getByRole('button', { name: /Publish/i }))

    await waitFor(() => expect(api.createRelease).toHaveBeenCalled())
    // Toast text lands in the <ToastContainer>
    expect(await screen.findByText('Release published')).toBeInTheDocument()
  })

  it('toggles draft and pre-release flags before publishing', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /New Release/i }))

    await user.type(screen.getByPlaceholderText('v1.0.0'), 'v4.0.0-beta')
    await user.click(screen.getByLabelText('Draft'))
    await user.click(screen.getByLabelText('Pre-release'))
    await user.click(screen.getByRole('button', { name: /Publish/i }))

    await waitFor(() => {
      expect(api.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_name: 'v4.0.0-beta',
          draft: true,
          prerelease: true
        })
      )
    })
  })
})

describe('ReleasesTab — delete flow', () => {
  it('exposes a specific accessible name on each per-row delete button', async () => {
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )

    // Named after the release title (falling back to tag_name) so the
    // icon-only Trash button is not an anonymous "button" for AT users.
    expect(
      screen.getByRole('button', { name: 'Delete release v2.0.0 — Stable' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete release v2.1.0-rc.1' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete release Draft Release' })
    ).toBeInTheDocument()
  })

  it('opens ConfirmModal then deletes on confirm', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )

    // Each release row has a delete (Trash) button with a specific
    // accessible name — click the first (v2.0.0 — Stable).
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete release/i })
    expect(deleteButtons.length).toBe(3)
    await user.click(deleteButtons[0])

    // ConfirmModal dialog opens
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/Delete release "v2\.0\.0 — Stable"/)
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Delete/i }))

    await waitFor(() =>
      expect(api.deleteRelease).toHaveBeenCalledWith(1)
    )
    expect(screen.getByText('Release deleted')).toBeInTheDocument()
    // List refreshed
    expect(api.fetchReleases).toHaveBeenCalledTimes(2)
  })

  it('surfaces API error from deleteRelease', async () => {
    const user = userEvent.setup()
    const api = makeApi({
      deleteRelease: vi.fn().mockRejectedValue(new Error('Permission denied'))
    })
    render(<ReleasesTab owner="owner" repo="repo" api={api} />)

    await waitFor(() =>
      expect(screen.getByText(/3 Releases/)).toBeInTheDocument()
    )
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete release/i })
    await user.click(deleteButtons[0])

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Delete/i }))

    await waitFor(() =>
      expect(screen.getByText('Permission denied')).toBeInTheDocument()
    )
  })
})
