/**
 * Returns true when the given scroll container is scrolled past the top.
 * Designed for sticky table headers that should show a drop-shadow only
 * when content is scrolled beneath them.
 *
 * IMPORTANT: the ref must point to the SCROLLING CONTAINER (not the sticky
 * header element itself).
 *
 * Example:
 *   const scrollRef = useRef(null)
 *   const elevated = useStickyHeaderShadow(scrollRef)
 *   <div ref={scrollRef} className="overflow-y-auto">
 *     <table><thead className={elevated ? 'shadow-sm' : ''}>...</thead></table>
 *   </div>
 */
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
