import { useEffect, useState } from 'react'

export function useStickyHeaderShadow(scrollRef) {
  const [elevated, setElevated] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setElevated(el.scrollTop > 0)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  return elevated
}
