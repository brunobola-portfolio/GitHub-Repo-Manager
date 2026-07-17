/*
 * Regression guard for the TeamDetails member-management wiring.
 *
 * MemberCard calls onUpdateRole(id, role) and onRemove(id), but the call site
 * shipped without passing those props — so changing a member's role or removing
 * a member threw a TypeError for any owner/admin at runtime. These tests drive
 * the real member-management UI and assert the corresponding PUT / DELETE fire,
 * so the dead-prop regression can't come back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/render-with-providers'

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'section', 'ul', 'li', 'h1', 'h2', 'h3', 'p', 'img'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
        MotionConfig: ({ children }) => children,
    }
})

// Keep the Activity tab inert — its own data fetching is irrelevant here.
vi.mock('@/components/Teams/ActivityTab', () => ({
    ActivityTab: () => <div data-testid="activity-tab" />,
}))

const { TeamDetails } = await import('@/components/Teams/TeamDetails')
const { ToastProvider } = await import('@/contexts/ToastProvider')

const BOB = { id: 2, username: 'bob', role: 'member', avatar_url: '', joined_at: '2026-01-01T00:00:00.000Z' }

let calls
beforeEach(() => {
    calls = []
    global.fetch = vi.fn((url, opts = {}) => {
        calls.push({ url, method: opts.method || 'GET', body: opts.body })
        if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: async () => ({ members: [BOB], repos: [], currentUserRole: 'owner' }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
    })
})

function renderDetails() {
    return render(
        <ToastProvider>
            <TeamDetails team={{ id: 1, name: 'Platform' }} user={{ login: 'me' }} userRepos={[]} onBack={() => {}} />
        </ToastProvider>
    )
}

// Pairs ToastProvider with a real ToastContainer so a test can assert on
// the rendered toast text — used by the notify-on-add coverage below.
function renderDetailsWithToasts() {
    return renderWithProviders(
        <TeamDetails team={{ id: 1, name: 'Platform' }} user={{ login: 'me' }} userRepos={[]} onBack={() => {}} />
    )
}

async function gotoMembers() {
    await screen.findByText('Platform', {}, { timeout: 5000 })
    fireEvent.click(screen.getByText('Members'))
    await screen.findByText('bob', {}, { timeout: 5000 })
}

describe('TeamDetails — member management wiring', () => {
    it('changing a member role issues a PUT to the member endpoint', { timeout: 20000 }, async () => {
        renderDetails()
        await gotoMembers()
        fireEvent.click(screen.getByRole('combobox', { name: /select/i }))
        fireEvent.click(await screen.findByRole('option', { name: 'Admin' }, { timeout: 5000 }))
        await waitFor(
            () => expect(calls.some(c => c.url === '/api/teams/1/members/2' && c.method === 'PUT')).toBe(true),
            { timeout: 5000 },
        )
        const put = calls.find(c => c.url === '/api/teams/1/members/2' && c.method === 'PUT')
        expect(JSON.parse(put.body)).toEqual({ role: 'admin' })
    })

    it('removing a member confirms then issues a DELETE to the member endpoint', { timeout: 20000 }, async () => {
        renderDetails()
        await gotoMembers()
        fireEvent.click(screen.getByRole('button', { name: 'Remove Member' }))
        // Confirmation modal then the actual delete.
        fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }, { timeout: 5000 }))
        await waitFor(
            () => expect(calls.some(c => c.url === '/api/teams/1/members/2' && c.method === 'DELETE')).toBe(true),
            { timeout: 5000 },
        )
    })

    it('renders the user-search Spinner without crashing (regression: Spinner must be imported)', { timeout: 20000 }, async () => {
        // The invite search renders <Spinner/> while looking up users. Spinner
        // was used here but never imported, so this branch threw
        // "ReferenceError: Spinner is not defined" at render — invisible to the
        // member-tab happy path and to ESLint. Exercising it guards the import.
        renderDetails()
        await gotoMembers()
        fireEvent.click(screen.getByRole('button', { name: /add member/i }))
        const search = await screen.findByRole('combobox', { name: /search github username/i }, { timeout: 5000 })
        // >2 chars -> the debounce effect flips isSearchingUsers -> Spinner renders.
        fireEvent.change(search, { target: { value: 'oct' } })
        expect(await screen.findByRole('status', { name: /loading/i }, { timeout: 5000 })).toBeInTheDocument()
    })

    it('exposes accessible names: remove button + combobox search + listbox results', { timeout: 20000 }, async () => {
        global.fetch = vi.fn((url, opts = {}) => {
            calls.push({ url, method: opts.method || 'GET', body: opts.body })
            if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: true, json: async () => ({ members: [BOB], repos: [], currentUserRole: 'owner' }) })
            }
            if (url.startsWith('/api/search/users')) {
                return Promise.resolve({ ok: true, json: async () => ([{ id: 9, login: 'newdev', avatar_url: '' }]) })
            }
            return Promise.resolve({ ok: true, json: async () => ({}) })
        })
        renderDetails()
        await gotoMembers()
        // Remove button has a real accessible name (not just title).
        expect(screen.getByRole('button', { name: 'Remove Member' })).toBeInTheDocument()
        // Invite search is a combobox; results are a listbox of options.
        fireEvent.click(screen.getByRole('button', { name: /add member/i }))
        const combo = await screen.findByRole('combobox', { name: /search github username/i }, { timeout: 5000 })
        fireEvent.change(combo, { target: { value: 'newdev' } })
        const listbox = await screen.findByRole('listbox', { name: /search results/i }, { timeout: 5000 })
        expect(listbox).toBeInTheDocument()
        expect(within(listbox).getByRole('option', { name: /newdev/i })).toBeInTheDocument()
    })
})

describe('TeamDetails — load errors surface (not empty states)', () => {
    it('shows an error + Retry (not a "no members" blank grid) when team details fail to load', { timeout: 20000 }, async () => {
        global.fetch = vi.fn((url, opts = {}) => {
            if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
            }
            return Promise.resolve({ ok: true, json: async () => ({}) })
        })
        renderDetails()
        await screen.findByText('Platform', {}, { timeout: 5000 })
        fireEvent.click(screen.getByText('Members'))
        expect(await screen.findByText(/couldn't load members/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('recovers when Retry is clicked after a failed load', { timeout: 20000 }, async () => {
        let failNext = true
        global.fetch = vi.fn((url, opts = {}) => {
            if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
                if (failNext) { failNext = false; return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) }
                return Promise.resolve({ ok: true, json: async () => ({ members: [BOB], repos: [], currentUserRole: 'owner' }) })
            }
            return Promise.resolve({ ok: true, json: async () => ({}) })
        })
        renderDetails()
        await screen.findByText('Platform', {}, { timeout: 5000 })
        fireEvent.click(screen.getByText('Members'))
        fireEvent.click(await screen.findByRole('button', { name: /retry/i }, { timeout: 5000 }))
        expect(await screen.findByText('bob', {}, { timeout: 5000 })).toBeInTheDocument()
    })

    it('shows an error + Retry (not "no collaborators found") when a repo\'s collaborators fail to load', { timeout: 20000 }, async () => {
        global.fetch = vi.fn((url, opts = {}) => {
            if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: true, json: async () => ({
                    members: [BOB],
                    repos: [{ id: 10, repo_full_name: 'acme/api', created_at: '2026-01-01T00:00:00.000Z' }],
                    currentUserRole: 'owner',
                }) })
            }
            if (String(url).includes('/collaborators')) {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
            }
            return Promise.resolve({ ok: true, json: async () => ({}) })
        })
        renderDetails()
        await screen.findByText('Platform', {}, { timeout: 5000 })
        fireEvent.click(screen.getByText('Repositories'))
        const access = await screen.findByRole('button', { name: /access/i }, { timeout: 5000 })
        fireEvent.click(access)
        expect(await screen.findByText(/couldn't load collaborators/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
})

describe('TeamDetails — surfaces whether the added member was notified', () => {
    const JSON_HEADERS = { get: () => 'application/json' }

    function mockFetchWithMemberAddResponse(notifiedResponse) {
        return vi.fn((url, opts = {}) => {
            if (url === '/api/teams/1' && (!opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: async () => ({ members: [BOB], repos: [], currentUserRole: 'owner' }) })
            }
            if (url.startsWith('/api/search/users')) {
                return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: async () => ([{ id: 9, login: 'newdev', avatar_url: '' }]) })
            }
            if (url === '/api/teams/1/members' && opts.method === 'POST') {
                return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: async () => notifiedResponse })
            }
            return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: async () => ({}) })
        })
    }

    it('toasts that the member was emailed when the server reports notified:true', { timeout: 20000 }, async () => {
        global.fetch = mockFetchWithMemberAddResponse({ success: true, notified: true })
        renderDetailsWithToasts()
        await gotoMembers()
        fireEvent.click(screen.getByRole('button', { name: /add member/i }))
        const combo = await screen.findByRole('combobox', { name: /search github username/i }, { timeout: 5000 })
        fireEvent.change(combo, { target: { value: 'newdev' } })
        fireEvent.click(await screen.findByRole('option', { name: /newdev/i }, { timeout: 5000 }))
        expect(await screen.findByText(/they've been emailed/i, {}, { timeout: 5000 })).toBeInTheDocument()
    })

    it('toasts that the member was not notified when the server reports notified:false', { timeout: 20000 }, async () => {
        global.fetch = mockFetchWithMemberAddResponse({ success: true, notified: false })
        renderDetailsWithToasts()
        await gotoMembers()
        fireEvent.click(screen.getByRole('button', { name: /add member/i }))
        const combo = await screen.findByRole('combobox', { name: /search github username/i }, { timeout: 5000 })
        fireEvent.change(combo, { target: { value: 'newdev' } })
        fireEvent.click(await screen.findByRole('option', { name: /newdev/i }, { timeout: 5000 }))
        expect(await screen.findByText(/wasn't notified by email/i, {}, { timeout: 5000 })).toBeInTheDocument()
    })
})
