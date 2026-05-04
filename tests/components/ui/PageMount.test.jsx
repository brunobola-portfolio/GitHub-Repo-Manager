import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageMount } from '../../../src/components/ui/PageMount'

describe('PageMount', () => {
    it('wraps children in a single motion container', () => {
        render(
            <PageMount>
                <span>page content</span>
            </PageMount>
        )
        expect(screen.getByText('page content')).toBeInTheDocument()
    })

    it('forwards className to the wrapper', () => {
        const { container } = render(
            <PageMount className="my-page">
                <span>x</span>
            </PageMount>
        )
        expect(container.firstChild.className).toContain('my-page')
    })

    it('PageMount.Item renders its children', () => {
        render(
            <PageMount>
                <PageMount.Item>
                    <span>row-1</span>
                </PageMount.Item>
                <PageMount.Item>
                    <span>row-2</span>
                </PageMount.Item>
            </PageMount>
        )
        expect(screen.getByText('row-1')).toBeInTheDocument()
        expect(screen.getByText('row-2')).toBeInTheDocument()
    })

    it('PageMount.Item forwards className', () => {
        const { container } = render(
            <PageMount>
                <PageMount.Item className="my-row">
                    <span>row</span>
                </PageMount.Item>
            </PageMount>
        )
        const item = container.querySelector('.my-row')
        expect(item).not.toBeNull()
    })
})
