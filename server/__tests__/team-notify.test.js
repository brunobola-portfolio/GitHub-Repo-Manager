// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
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
        expect(args.html).toMatch(/You were added to the <strong>Platform<\/strong> team/)
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
