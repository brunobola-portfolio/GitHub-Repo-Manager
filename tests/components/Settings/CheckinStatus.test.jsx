import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CheckinStatus } from '@/components/Settings/LicensePlanSection.jsx'

const exp = '2031-01-31T00:00:00.000Z'

describe('CheckinStatus', () => {
    it('shows nothing on the hosted issuer or in tests', () => {
        const { container: a } = render(<CheckinStatus checkin={{ disabled: 'issuer' }} expiresAt={exp} />)
        expect(a).toBeEmptyDOMElement()
        const { container: b } = render(<CheckinStatus checkin={{ disabled: 'test' }} expiresAt={exp} />)
        expect(b).toBeEmptyDOMElement()
    })

    it('says renewal is off and what to do instead', () => {
        render(<CheckinStatus checkin={{ disabled: 'disabled' }} expiresAt={exp} />)
        expect(screen.getByText(/Automatic renewal is off/)).toBeInTheDocument()
    })

    it('reports the machines against the plan, and warns without blocking when over', () => {
        const { rerender } = render(<CheckinStatus checkin={{ last: { at: exp, installs: { number: 2, active: 1, limit: 2, over: false } } }} expiresAt={exp} />)
        expect(screen.getByText(/Used on 1 of the 2 machines/)).toBeInTheDocument()
        expect(screen.getByText(/This is installation #2 of this licence/)).toBeInTheDocument()
        rerender(<CheckinStatus checkin={{ last: { at: exp, installs: { active: 3, limit: 2, over: true } } }} expiresAt={exp} />)
        expect(screen.getByText(/active on 3 machines and your plan covers 2/)).toBeInTheDocument()
    })

    it('a blocked installation is told its key runs out and is not replaced, with the number to quote', () => {
        render(<CheckinStatus checkin={{ last: { at: exp, status: 'blocked', installs: { number: 4, active: 2, limit: 2, over: false } } }} expiresAt={exp} />)
        expect(screen.getByText(/stopped renewals for this installation/)).toBeInTheDocument()
        expect(screen.getByText(/quote installation #4/)).toBeInTheDocument()
        expect(screen.queryByText(/Used on/)).toBeNull()
    })

    it('an unreachable issuer is reassuring, not alarming', () => {
        render(<CheckinStatus checkin={{ last: { at: exp, error: 'unreachable' } }} expiresAt={exp} />)
        expect(screen.getByText(/keeps working until/)).toBeInTheDocument()
    })

    it('names an automatic renewal, and a pending one behind an env-pinned key', () => {
        render(<CheckinStatus checkin={{ last: { at: exp, renewedTo: exp, renewalPending: true, installs: null } }} expiresAt={exp} />)
        expect(screen.getByText(/Renewed automatically/)).toBeInTheDocument()
        expect(screen.getByText(/reads its key from/)).toBeInTheDocument()
    })
})
