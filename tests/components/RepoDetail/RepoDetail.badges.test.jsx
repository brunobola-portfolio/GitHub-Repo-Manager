/*
 * Chrome uniformity (audit task 11c): RepoDetail's header hand-rolled the
 * Private/Public/Archived/Fork pills instead of the canonical <Badge>. These
 * tests lock in the Badge-backed rendering (tone-driven palette, not raw
 * className color overrides) for each status pill.
 *
 * SettingsTab / OverviewTab / TrackedChip are stubbed and fetchRepo rejects
 * so RepoDetail keeps rendering the exact `repo` prop passed in (same
 * isolation approach as RepoDetail.settingsGuard.test.jsx).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const apiStub = { fetchRepo: () => Promise.reject(new Error('offline — keep prop data')) }

vi.mock('@/hooks/useRepoDetail', () => ({ useRepoDetail: () => apiStub }))

vi.mock('@/components/WorkBoard/TrackedChip', () => ({
    TrackedChip: () => null,
}))

vi.mock('@/components/RepoDetail/OverviewTab', () => ({
    OverviewTab: () => <div data-testid="overview-stub">overview</div>,
}))

vi.mock('@/components/RepoDetail/SettingsTab', () => ({
    SettingsTab: () => <div data-testid="settings-stub" />,
}))

const { RepoDetail } = await import('@/components/RepoDetail/RepoDetail')

function baseRepo(overrides = {}) {
    return {
        id: 1,
        name: 'app',
        full_name: 'me/app',
        owner: { login: 'me' },
        private: false,
        archived: false,
        fork: false,
        topics: [],
        html_url: 'https://github.com/me/app',
        ...overrides,
    }
}

describe('RepoDetail — status pills use the canonical Badge', () => {
    afterEach(cleanup)

    it('renders Public with Badge success tone', async () => {
        render(<RepoDetail repo={baseRepo({ private: false })} onBack={vi.fn()} />)
        const pill = await screen.findByText('Public')
        expect(pill.className).toContain('bg-emerald-100')
        expect(pill.className).toContain('dark:bg-emerald-900/50')
    })

    it('renders Private with Badge warning tone', async () => {
        render(<RepoDetail repo={baseRepo({ private: true })} onBack={vi.fn()} />)
        const pill = await screen.findByText('Private')
        expect(pill.className).toContain('bg-amber-100')
        expect(pill.className).toContain('dark:bg-amber-900/50')
    })

    it('renders Archived with Badge neutral tone', async () => {
        render(<RepoDetail repo={baseRepo({ archived: true })} onBack={vi.fn()} />)
        const pill = await screen.findByText('Archived')
        expect(pill.className).toContain('bg-slate-100')
    })

    it('renders Fork with Badge violet tone', async () => {
        render(<RepoDetail repo={baseRepo({ fork: true })} onBack={vi.fn()} />)
        const pill = await screen.findByText('Fork')
        expect(pill.className).toContain('bg-violet-100')
        expect(pill.className).toContain('dark:bg-violet-900/50')
    })

    it('leaves topic pills as plain informational tags, not converted', async () => {
        render(<RepoDetail repo={baseRepo({ topics: ['react', 'vite'] })} onBack={vi.fn()} />)
        const topic = await screen.findByText('react')
        // Still the original hand-rolled indigo tag styling (untouched per brief's
        // escape hatch — topics are open-ended tags, not a genuine status pill).
        expect(topic.className).toContain('bg-indigo-50')
    })
})
