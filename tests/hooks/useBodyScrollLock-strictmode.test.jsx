import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { useBodyScrollLock, __resetBodyScrollLockForTests } from '@/hooks/useBodyScrollLock'

function Modal({ isOpen }) {
  useBodyScrollLock(isOpen)
  return isOpen ? <div data-testid="modal">open</div> : null
}

describe('useBodyScrollLock — React Strict Mode', () => {
  beforeEach(() => {
    __resetBodyScrollLockForTests()
    document.body.style.overflow = ''
  })
  afterEach(() => {
    cleanup()
    __resetBodyScrollLockForTests()
    document.body.style.overflow = ''
  })

  it('restores body overflow after mount/unmount cycle in StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <Modal isOpen={true} />
      </StrictMode>
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores body overflow when body was pre-locked externally and modal lifecycles in StrictMode', () => {
    document.body.style.overflow = 'hidden'
    const { unmount } = render(
      <StrictMode>
        <Modal isOpen={true} />
      </StrictMode>
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('hidden')
  })
})
