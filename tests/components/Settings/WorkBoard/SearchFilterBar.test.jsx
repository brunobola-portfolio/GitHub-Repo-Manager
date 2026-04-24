import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchFilterBar } from '../../../../src/components/Settings/WorkBoard/SearchFilterBar'

describe('SearchFilterBar', () => {
    it('emits onChange with search after debounce', async () => {
        vi.useFakeTimers()
        const onChange = vi.fn()
        render(<SearchFilterBar filters={{}} countsBySignal={{}} onChange={onChange} />)

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'acme' } })

        expect(onChange).not.toHaveBeenCalled()

        act(() => { vi.advanceTimersByTime(200) })
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme' }))

        vi.useRealTimers()
    })

    it('renders signal filter chips with counts', () => {
        render(
            <SearchFilterBar
                filters={{}}
                countsBySignal={{ review_requested: 3, owned: 5 }}
                onChange={() => {}}
            />
        )
        expect(screen.getByRole('button', { name: /review requested \(3\)/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /owned \(5\)/i })).toBeInTheDocument()
    })

    it('signal chip click emits onChange with signal filter', () => {
        const onChange = vi.fn()
        render(
            <SearchFilterBar
                filters={{}}
                countsBySignal={{ owned: 5 }}
                onChange={onChange}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /owned/i }))
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ signal: 'owned' }))
    })

    it('Show muted toggle emits onChange with muted: undefined', () => {
        const onChange = vi.fn()
        render(
            <SearchFilterBar
                filters={{ muted: false }}
                countsBySignal={{}}
                onChange={onChange}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /show muted/i }))
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ muted: undefined }))
    })
})
