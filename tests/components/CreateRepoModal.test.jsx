import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { CreateRepoModal } from '../../src/components/CreateRepoModal'
import { renderWithProviders } from '../helpers/render-with-providers'
import { importCheckDuplicatesSchema } from '../../server/lib/validators.js'

// These tests cover WCAG 2.1 AA label wiring — the modal contains the main
// "create repo" form in the app, so label ↔ input association is load-bearing
// for screen-reader and voice-control users.

function renderModal(overrides = {}) {
    return render(
        <CreateRepoModal
            isOpen={true}
            onClose={() => {}}
            onCreate={vi.fn()}
            orgs={[]}
            isPerforming={false}
            askAI={vi.fn()}
            {...overrides}
        />
    )
}

describe('CreateRepoModal accessibility', () => {
    it('associates the Repository Name label with its input', () => {
        renderModal()
        const input = screen.getByLabelText(/repository name/i)
        expect(input).toBeInTheDocument()
        expect(input.tagName).toBe('INPUT')
    })

    it('associates the Description label with its textarea', () => {
        renderModal()
        const textarea = screen.getByLabelText(/description/i)
        expect(textarea).toBeInTheDocument()
        expect(textarea.tagName).toBe('TEXTAREA')
    })

    it('exposes an accessible name for the visibility toggle', () => {
        renderModal()
        expect(screen.getByRole('switch', { name: /private repository/i })).toBeInTheDocument()
    })
})

describe('CreateRepoModal — toast feedback', () => {
    it('fires an error toast when onCreate returns a failure', async () => {
        const onCreate = vi.fn().mockResolvedValue({ success: false, message: 'Name already taken' })
        renderWithProviders(
            <CreateRepoModal
                isOpen={true}
                onClose={() => {}}
                onCreate={onCreate}
                orgs={[]}
                isPerforming={false}
                askAI={vi.fn()}
            />
        )
        const input = screen.getByLabelText(/repository name/i)
        fireEvent.change(input, { target: { value: 'my-repo' } })
        const submit = screen.getByRole('button', { name: /create repository/i })
        fireEvent.click(submit)
        await waitFor(() => {
            expect(screen.getByText(/name already taken/i)).toBeInTheDocument()
        })
    })
})

/*
 * The name-availability check was broken in BOTH directions.
 *
 * The modal sent `{ names, org }` against a schema declaring `{ repos,
 * targetOwner }`, so every call 400'd. And the handler returns `duplicates` as
 * an OBJECT keyed by repo name while the modal read `.length` — so even with
 * the request fixed, the indicator would have said "available" forever.
 * Fixing one without the other looks like a fix and is not.
 */
describe('CreateRepoModal — duplicate-name check speaks the server contract', () => {
    // apiCall's safeParseJson reads response.headers.get('content-type') and
    // falls back to response.text() — both must be present on the mock Response.
    const JSON_HEADERS = { get: (k) => (k?.toLowerCase?.() === 'content-type' ? 'application/json' : null) }
    function captureFetch(responseBody) {
        const sent = {}
        global.fetch = vi.fn(async (url, init) => {
            // apiCall mints its own CSRF token via a separate GET first — answer
            // it directly so `sent` below ends up capturing the real POST call.
            if (String(url).includes('csrf-token')) {
                return { ok: true, status: 200, json: async () => ({ token: 'tok' }), headers: JSON_HEADERS }
            }
            sent.url = url
            sent.body = init?.body ? JSON.parse(init.body) : undefined
            return {
                ok: true,
                status: 200,
                json: async () => responseBody,
                text: async () => JSON.stringify(responseBody),
                headers: JSON_HEADERS,
            }
        })
        return sent
    }

    it('sends a body the route schema accepts', async () => {
        const sent = captureFetch({ duplicates: {} })
        renderModal()
        fireEvent.change(screen.getByLabelText(/repository name/i), { target: { value: 'my-repo' } })

        await waitFor(() => expect(sent.body).toBeTruthy(), { timeout: 3000 })
        const parsed = importCheckDuplicatesSchema.safeParse(sent.body)
        expect(
            parsed.success,
            `schema rejected ${JSON.stringify(sent.body)}: ${parsed.error?.issues?.map((i) => i.message).join('; ')}`,
        ).toBe(true)
    })

    it('reads the object-keyed response and reports a taken name', async () => {
        captureFetch({ duplicates: { 'my-repo': true } })
        renderModal()
        fireEvent.change(screen.getByLabelText(/repository name/i), { target: { value: 'my-repo' } })

        expect(await screen.findByText(/taken|unavailable|already exists/i, {}, { timeout: 3000 })).toBeInTheDocument()
    })

    it('reports an available name when the server returns no match', async () => {
        captureFetch({ duplicates: {} })
        renderModal()
        fireEvent.change(screen.getByLabelText(/repository name/i), { target: { value: 'brand-new' } })

        expect(await screen.findByText(/available/i, {}, { timeout: 3000 })).toBeInTheDocument()
    })
})

describe('CreateRepoModal name validation', () => {
    it('rejects a name GitHub would reject before the request leaves the browser', () => {
        renderWithProviders(<CreateRepoModal isOpen onClose={() => {}} onCreate={vi.fn()} orgs={[]} isPerforming={false} />)
        const input = screen.getByLabelText(/repository name/i)
        fireEvent.change(input, { target: { value: 'bad name!!' } })
        expect(input.value).toBe('bad-name!!')
        expect(screen.getByText(/letters, numbers, dots, hyphens and underscores/i)).toBeInTheDocument()
        const create = screen.getAllByRole('button', { name: /^create/i }).at(-1)
        expect(create).toBeDisabled()
        fireEvent.change(input, { target: { value: 'good.name_1' } })
        expect(screen.getAllByRole('button', { name: /^create/i }).at(-1)).not.toBeDisabled()
    })
})
