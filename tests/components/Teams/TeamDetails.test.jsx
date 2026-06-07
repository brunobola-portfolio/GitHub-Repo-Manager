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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
})
