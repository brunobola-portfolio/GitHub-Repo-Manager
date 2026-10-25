import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const mockToast = vi.hoisted(() => ({
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), errorFromException: vi.fn(),
}))
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast, toasts: [], dismissToast: vi.fn() }),
}))

const mockApi = vi.hoisted(() => ({
    listLicenses: vi.fn(),
    listInstalls: vi.fn(),
    blockInstall: vi.fn(),
    unblockInstall: vi.fn(),
    rotateLicense: vi.fn(),
}))
vi.mock('@/api/admin-licenses', () => mockApi)

const { AdminLicensesPage } = await import('@/components/Admin/AdminLicensesPage.jsx')

const LICENSES = [
    { subRef: 'sub_shared', tier: 'pro', org: 'Acme, Lda', holder: 'owner@acme.example', expiresAt: '2031-01-17T00:00:00.000Z', machines: 5, limit: 2, level: 'suspected', networks: 4, installations: 6, blocked: 0, lastSeen: '2031-01-01 10:00:00' },
    { subRef: 'sub_quiet', tier: 'enterprise', org: 'Globex', holder: null, expiresAt: null, machines: 1, limit: 10, level: 'ok', networks: 1, installations: 1, blocked: 0, lastSeen: null },
]
const INSTALLS = [
    { seq: 1, name: 'prod', platform: 'linux-x64', network: '203.0.113.0/24', version: '4.28.0', machine: 'aaaaaaaaaaaa', first_seen: '2030-12-01 10:00:00', last_seen: '2031-01-01 10:00:00', blocked_at: null, blocked_reason: null, active: true },
    { seq: 4, name: 'unknown-vps', platform: 'linux-x64', network: '198.51.100.0/24', version: '4.28.0', machine: null, first_seen: '2031-01-01 09:00:00', last_seen: '2031-01-01 09:00:00', blocked_at: null, blocked_reason: null, active: true },
]

beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listLicenses.mockResolvedValue(LICENSES)
    mockApi.listInstalls.mockResolvedValue(INSTALLS)
})

async function openShared() {
    render(<AdminLicensesPage />)
    const row = await screen.findByRole('button', { name: /Acme, Lda/ })
    fireEvent.click(row)
    await screen.findByText('unknown-vps')
}

describe('AdminLicensesPage', () => {
    it('lists licences with machines against the plan and the sharing level', async () => {
        render(<AdminLicensesPage />)
        expect(await screen.findByText('Suspected sharing')).toBeInTheDocument()
        expect(screen.getByText('5 / 2')).toBeInTheDocument()
        expect(screen.getByText('Within plan')).toBeInTheDocument()
        expect(screen.getByText(/1 suspected sharing/)).toBeInTheDocument()
    })

    it('opens the installations of a licence on demand', async () => {
        await openShared()
        expect(mockApi.listInstalls).toHaveBeenCalledWith('sub_shared')
        expect(screen.getByText(/203\.0\.113\.0\/24/)).toBeInTheDocument()
        expect(screen.getByText(/no machine id/)).toBeInTheDocument()
    })

    it('blocks an installation only with a reason', async () => {
        mockApi.blockInstall.mockResolvedValue({ blocked: 1 })
        await openShared()
        fireEvent.click(screen.getAllByRole('button', { name: /Block renewals/ })[1])
        const dialog = await screen.findByRole('dialog')
        const confirm = within(dialog).getByRole('button', { name: 'Block renewals' })
        expect(confirm).toBeDisabled()
        fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Unknown VPS' } })
        fireEvent.click(confirm)
        await waitFor(() => expect(mockApi.blockInstall).toHaveBeenCalledWith('sub_shared', 4, 'Unknown VPS'))
        expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/#4 gets no more renewals/))
    })

    it('rotates the key keeping only the installations left ticked', async () => {
        mockApi.rotateLicense.mockResolvedValue({ lid: 'new', revoked: 1, blocked: 1, emailDelivered: true })
        await openShared()
        fireEvent.click(screen.getByRole('button', { name: /Rotate key/ }))
        const dialog = await screen.findByRole('dialog')
        fireEvent.click(within(dialog).getByLabelText(/#4 unknown-vps/))
        fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Key on a paste site' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }))
        await waitFor(() => expect(mockApi.rotateLicense).toHaveBeenCalledWith('sub_shared', [1], 'Key on a paste site'))
        expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/emailed the new key/))
    })

    it('an installation holding a rotated key can be trusted, which sends it the new key', async () => {
        mockApi.listInstalls.mockResolvedValue([{ ...INSTALLS[1], awaitingTrust: true }])
        mockApi.unblockInstall.mockResolvedValue({ unblocked: 1 })
        await openShared()
        expect(screen.getByText('Holds a rotated key')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Trust and send new key/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText(/only if the customer confirms/)).toBeInTheDocument()
        fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Customer rebuilt the server' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Trust and send new key' }))
        await waitFor(() => expect(mockApi.unblockInstall).toHaveBeenCalledWith('sub_shared', 4, 'Customer rebuilt the server'))
        expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/receives the new key/))
    })

    it('says plainly when the account is not an admin', async () => {
        mockApi.listLicenses.mockRejectedValue(Object.assign(new Error('Admin access required'), { status: 403 }))
        render(<AdminLicensesPage />)
        expect(await screen.findByText('Admin access required')).toBeInTheDocument()
    })
})
