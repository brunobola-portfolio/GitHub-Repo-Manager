import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DORATab } from '@/components/WorkBoard/tabs/DORATab'

vi.mock('@/hooks/useWorkBoard', () => ({
    useDORASummary: () => ({
        data: {
            deployFrequency: { totalDeployments: 42, perDay: [{ date: '2026-07-01', count: 2 }, { date: '2026-07-02', count: 1 }] },
            leadTime: { p50: 3, p90: 8, sampleSize: 10 },
            changeFailureRate: { rate: 0.1, failed: 1, total: 10 },
            mttr: { p50: 2, p90: 5, sampleSize: 3, unresolved: 0 },
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
    }),
}))

describe('DORATab — headline KPI typography matches KpiRow (tabular-nums + ds-font-display)', () => {
    it('the KPI value digits get the same treatment as KpiRow.jsx so they don\'t shift width on update', () => {
        render(<DORATab />)
        const deployments = screen.getByText('42')
        expect(deployments).toHaveClass('tabular-nums')
        expect(deployments).toHaveClass('ds-font-display')
    })
})
