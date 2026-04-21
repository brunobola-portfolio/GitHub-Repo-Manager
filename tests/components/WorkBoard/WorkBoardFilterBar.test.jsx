import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, motion: new Proxy(actual.motion, { get: (t, k) => t[k] ?? t.div }), AnimatePresence: ({children}) => children }
})

const { WorkBoardFilterBar } = await import('@/components/WorkBoard/filters/WorkBoardFilterBar')

describe('WorkBoardFilterBar', () => {
    const makeProps = (overrides = {}) => ({
        filters: { repos: '', authors: '', labels: '', age: '', snoozed: '' },
        setFilters: vi.fn(),
        availableRepos: ['acme/x', 'acme/y'],
        availableAuthors: ['alice', 'bob'],
        availableLabels: ['bug', 'enhancement'],
        ...overrides,
    })

    it('renders a chip for each unique repo/author/label', () => {
        render(<WorkBoardFilterBar {...makeProps()} />)
        expect(screen.getByRole('button', { name: /acme\/x/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /acme\/y/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /alice/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /bug/ })).toBeInTheDocument()
    })

    it('clicking a chip calls setFilters with the value toggled in', () => {
        const setFilters = vi.fn()
        render(<WorkBoardFilterBar {...makeProps({ setFilters })} />)
        fireEvent.click(screen.getByRole('button', { name: /acme\/x/ }))
        expect(setFilters).toHaveBeenCalledWith({ repos: 'acme/x' })
    })

    it('clicking an active chip removes it', () => {
        const setFilters = vi.fn()
        render(<WorkBoardFilterBar {...makeProps({ filters: { repos: 'acme/x,acme/y', authors: '', labels: '', age: '', snoozed: '' }, setFilters })} />)
        fireEvent.click(screen.getByRole('button', { name: /acme\/x/ }))
        expect(setFilters).toHaveBeenCalledWith({ repos: 'acme/y' })
    })

    it('renders age bucket chips (24h, 7d, 30d)', () => {
        render(<WorkBoardFilterBar {...makeProps()} />)
        expect(screen.getByRole('button', { name: /24h/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /7d/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /30d/ })).toBeInTheDocument()
    })

    it('age is single-select — clicking a bucket replaces any prior selection', () => {
        const setFilters = vi.fn()
        render(<WorkBoardFilterBar {...makeProps({ filters: { repos: '', authors: '', labels: '', age: '24h', snoozed: '' }, setFilters })} />)
        fireEvent.click(screen.getByRole('button', { name: /7d/ }))
        expect(setFilters).toHaveBeenCalledWith({ age: '7d' })
    })

    it('clicking Hide snoozed toggles the snoozed filter', () => {
        const setFilters = vi.fn()
        render(<WorkBoardFilterBar {...makeProps({ setFilters })} />)
        fireEvent.click(screen.getByRole('button', { name: /hide snoozed/i }))
        expect(setFilters).toHaveBeenCalledWith({ snoozed: 'hidden' })
    })
})
