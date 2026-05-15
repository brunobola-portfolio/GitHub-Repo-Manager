import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnimatedCheck } from '../../../src/components/ui/AnimatedCheck'

describe('AnimatedCheck', () => {
  it('renders an svg path with stroke-dasharray animation hooks', () => {
    const { container } = render(<AnimatedCheck />)
    const path = container.querySelector('path')
    expect(path).toBeTruthy()
    expect(path.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
