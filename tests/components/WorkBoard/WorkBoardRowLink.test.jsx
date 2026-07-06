import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkBoardRowLink } from '../../../src/components/WorkBoard/WorkBoardRowLink'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

/**
 * Guards the stretched-control refactor: the row-open affordance is a real
 * <button> layered behind the content (absolute z-0), NOT a role="button"
 * wrapper AROUND the content. That is what removed the axe `nested-interactive`
 * violation, so these tests assert the structure that keeps it fixed as well as
 * the behaviour (open-in-app click/keyboard, modifier-click deferral, and that
 * inner action buttons remain independently clickable siblings).
 */
describe('WorkBoardRowLink', () => {
    let received
    let unsubs

    beforeEach(() => {
        received = []
        unsubs = [
            onAppEvent(APP_EVENTS.OPEN_REPO_PR, (p) => received.push({ type: 'pr', detail: p.detail })),
            onAppEvent(APP_EVENTS.OPEN_REPO_ISSUE, (p) => received.push({ type: 'issue', detail: p.detail })),
        ]
    })
    afterEach(() => {
        unsubs.forEach((off) => off())
    })

    function renderRow(props = {}) {
        return render(
            <WorkBoardRowLink
                repoFullName="acme/backend"
                number={142}
                itemType="pr"
                itemUrl="https://github.com/acme/backend/pull/142"
                {...props}
            >
                <div className="flex">
                    <span>Add rate limiting</span>
                    <button type="button" data-testid="child-action" onClick={props.onChildAction}>
                        Approve
                    </button>
                </div>
            </WorkBoardRowLink>,
        )
    }

    it('exposes the row-open affordance as a real <button>, not a role="button" wrapper', () => {
        const { container } = renderRow()
        const openBtn = screen.getByRole('button', { name: /open pull request #142 in app/i })
        expect(openBtn.tagName).toBe('BUTTON')
        // The container must NOT carry an interactive role/tabindex any more —
        // that was the shape axe flagged as nested-interactive.
        const wrapper = container.firstChild
        expect(wrapper.getAttribute('role')).toBeNull()
        expect(wrapper.getAttribute('tabindex')).toBeNull()
    })

    it('renders inner action buttons as SIBLINGS of the open button (no nesting)', () => {
        renderRow()
        const openBtn = screen.getByRole('button', { name: /open pull request #142 in app/i })
        const childAction = screen.getByTestId('child-action')
        // The child action button must not live inside the open-in-app button.
        expect(openBtn.contains(childAction)).toBe(false)
        expect(childAction.tagName).toBe('BUTTON')
    })

    it('opens the PR in-app on plain click', () => {
        renderRow()
        fireEvent.click(screen.getByRole('button', { name: /open pull request #142 in app/i }))
        expect(received).toEqual([{ type: 'pr', detail: { repoFullName: 'acme/backend', number: 142 } }])
    })

    it('opens the issue in-app when itemType is "issue"', () => {
        renderRow({ itemType: 'issue', number: 7, itemUrl: 'https://github.com/acme/backend/issues/7' })
        fireEvent.click(screen.getByRole('button', { name: /open issue #7 in app/i }))
        expect(received).toEqual([{ type: 'issue', detail: { repoFullName: 'acme/backend', number: 7 } }])
    })

    it('defers to the GitHub link on ctrl/meta-click (does not open in-app)', () => {
        renderRow()
        const openBtn = screen.getByRole('button', { name: /open pull request #142 in app/i })
        fireEvent.click(openBtn, { ctrlKey: true })
        fireEvent.click(openBtn, { metaKey: true })
        expect(received).toEqual([])
    })

    it('honours a custom ariaLabel on the open button', () => {
        renderRow({ ariaLabel: 'Open PR #142 — Add rate limiting in app' })
        expect(
            screen.getByRole('button', { name: 'Open PR #142 — Add rate limiting in app' }),
        ).toBeInTheDocument()
    })

    it('keeps the inner action button independently clickable', () => {
        let childClicked = 0
        renderRow({ onChildAction: () => { childClicked += 1 } })
        fireEvent.click(screen.getByTestId('child-action'))
        expect(childClicked).toBe(1)
        // Clicking the child action must not also open the row in-app.
        expect(received).toEqual([])
    })

    it('renders a secondary "Open on GitHub" link to the item URL', () => {
        renderRow()
        const link = screen.getByRole('link', { name: /open on github/i })
        expect(link).toHaveAttribute('href', 'https://github.com/acme/backend/pull/142')
        expect(link).toHaveAttribute('target', '_blank')
    })
})
