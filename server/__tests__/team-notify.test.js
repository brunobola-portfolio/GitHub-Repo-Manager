// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockSendEmail = vi.fn()
vi.mock('../lib/email.js', () => ({ sendEmail: mockSendEmail }))

const { notifyMemberAdded } = await import('../lib/team-notify.js')

describe('notifyMemberAdded', () => {
    beforeEach(() => {
        mockSendEmail.mockReset()
    })

    it('returns notified:false and skips sendEmail when there is no email on file', async () => {
        const result = await notifyMemberAdded({
            email: null,
            username: 'bob',
            teamName: 'Platform',
        })

        expect(result).toEqual({ notified: false, reason: 'no_email' })
        expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('sends the notification email and returns notified:true on success', async () => {
        mockSendEmail.mockResolvedValue({ ok: true, id: 'email_1' })

        const result = await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: 'Platform',
            addedByUsername: 'alice',
        })

        expect(result).toEqual({ notified: true })
        expect(mockSendEmail).toHaveBeenCalledTimes(1)
        const args = mockSendEmail.mock.calls[0][0]
        expect(args.to).toBe('bob@example.com')
        expect(args.subject).toMatch(/Platform/)
        expect(args.html).toMatch(/alice/)
        expect(args.html).toMatch(/Platform/)
        expect(args.text).toMatch(/alice/)
        expect(args.context).toEqual({ kind: 'team_member_added', teamName: 'Platform' })
    })

    it('omits the "added by" line when addedByUsername is not provided', async () => {
        mockSendEmail.mockResolvedValue({ ok: true })

        await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: 'Platform',
        })

        const args = mockSendEmail.mock.calls[0][0]
        expect(args.html).toMatch(/You were added to the <strong[^>]*>Platform<\/strong> team/)
        expect(args.text).toMatch(/You were added to the Platform team/)
    })

    it('returns notified:false without throwing when email delivery fails', async () => {
        mockSendEmail.mockResolvedValue({ ok: false, error: 'Resend 500' })

        const result = await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: 'Platform',
        })

        expect(result).toEqual({ notified: false, reason: 'delivery_failed' })
    })

    it('returns notified:false without throwing when sendEmail rejects', async () => {
        mockSendEmail.mockRejectedValue(new Error('network down'))

        const result = await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: 'Platform',
        })

        expect(result).toEqual({ notified: false, reason: 'error' })
    })
})

describe('notifyMemberAdded — user input in the message', () => {
    beforeEach(() => {
        mockSendEmail.mockReset()
        mockSendEmail.mockResolvedValue({ ok: true })
    })

    it('escapes team and inviter names in the HTML body', async () => {
        await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: '<a href="https://evil.example">Reset your password</a>',
            addedByUsername: '<img src=x onerror=alert(1)>',
        })

        const { html, text } = mockSendEmail.mock.calls[0][0]
        expect(html).not.toContain('<a href="https://evil.example">')
        expect(html).not.toContain('<img')
        expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;')
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        // The plain-text part is not HTML; it keeps the name as typed.
        expect(text).toContain('<img src=x onerror=alert(1)>')
    })

    it('keeps the subject on one line whatever the team is called', async () => {
        await notifyMemberAdded({
            email: 'bob@example.com',
            username: 'bob',
            teamName: 'Ops\r\nBcc: victim@example.com',
        })

        const { subject } = mockSendEmail.mock.calls[0][0]
        expect(subject).not.toMatch(/[\r\n]/)
        expect(subject).toBe("You've been added to Ops Bcc: victim@example.com")
    })

    it('no longer points recipients at a personal inbox', async () => {
        await notifyMemberAdded({ email: 'bob@example.com', username: 'bob', teamName: 'Platform' })
        const { html, text } = mockSendEmail.mock.calls[0][0]
        expect(html).not.toContain('bruno@bolalabs.pt')
        expect(text).not.toContain('bruno@bolalabs.pt')
    })
})
