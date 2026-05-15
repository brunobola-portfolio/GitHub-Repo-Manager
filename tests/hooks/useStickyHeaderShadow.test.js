import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStickyHeaderShadow } from '../../src/hooks/useStickyHeaderShadow'

describe('useStickyHeaderShadow', () => {
  it('returns elevated=false when scrollTop is 0', () => {
    const ref = { current: { scrollTop: 0, addEventListener() {}, removeEventListener() {} } }
    const { result } = renderHook(() => useStickyHeaderShadow(ref))
    expect(result.current).toBe(false)
  })

  it('returns elevated=true once a scroll event fires with scrollTop > 0', () => {
    const handlers = {}
    const el = {
      scrollTop: 0,
      addEventListener: (ev, fn) => { handlers[ev] = fn },
      removeEventListener: () => {},
    }
    const ref = { current: el }
    const { result } = renderHook(() => useStickyHeaderShadow(ref))
    act(() => {
      el.scrollTop = 12
      handlers.scroll()
    })
    expect(result.current).toBe(true)
  })
})
