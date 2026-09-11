import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DORATab } from '@/components/WorkBoard/tabs/DORATab'

let summary
vi.mock('@/hooks/useWorkBoard', () => ({
    useDORASummary: () => ({ data: summary, loading: false, error: null, refresh: vi.fn() }),
}))

beforeEach(() => {
    summary = {
        deployFrequency: { totalDeployments: 42, perDay: [{ date: '2026-07-01', count: 2 }, { date: '2026-07-02', count: 1 }] },
        leadTime: { p50: 3, p90: 8, sampleSize: 10, basis: 'deployed' },
        changeFailureRate: { rate: 0.1, failed: 1, total: 10 },
        mttr: { p50: 2, p90: 5, sampleSize: 3, unresolved: 0 },
        environments: [{ name: 'production', deployments: 42 }, { name: 'staging', deployments: 90 }],
    }
})

describe('DORATab — headline KPI typography matches KpiRow (tabular-nums + ds-font-display)', () => {
    it('the KPI value digits get the same treatment as KpiRow.jsx so they don\'t shift width on update', () => {
        render(<DORATab />)
        const deployments = screen.getByText('42')
        expect(deployments).toHaveClass('tabular-nums')
        expect(deployments).toHaveClass('ds-font-display')
    })
})

describe('DORATab — says what DORA is and what each number measures', () => {
    it('spells out the acronym before any number', () => {
        render(<DORATab />)
        expect(screen.getByText(/DevOps Research and Assessment/)).toBeInTheDocument()
    })

    it('uses DORA\'s current names and gives every KPI a definition control', () => {
        render(<DORATab />)
        expect(screen.getByText('Change lead time p50 / p90')).toBeInTheDocument()
        expect(screen.getByText('Change fail rate')).toBeInTheDocument()
        expect(screen.getByText('Recovery time p50 / p90')).toBeInTheDocument()
        expect(screen.getByText(/PR opened → deployed/)).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /^What is / })).toHaveLength(4)
    })

    it('never shows a PR cycle time under the lead-time name', () => {
        summary.leadTime = { p50: 3, p90: 8, sampleSize: 10, basis: 'merged' }
        render(<DORATab />)
        expect(screen.queryByText('Change lead time p50 / p90')).not.toBeInTheDocument()
        expect(screen.getByText('PR cycle time p50 / p90')).toBeInTheDocument()
        expect(screen.getByText(/PR opened → merged/)).toBeInTheDocument()
    })
})
