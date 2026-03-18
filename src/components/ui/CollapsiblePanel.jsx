import { useState, useRef, useEffect, useCallback } from 'react'

export default function CollapsiblePanel({
  side = 'left',
  mode = 'expanded',
  expandedWidth = 280,
  slimWidth = 60,
  children,
  slimContent,
  className = '',
}) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const panelRef = useRef(null)

  // onTransitionStart is not a React synthetic event — use native listener via ref
  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const handleStart = (e) => {
      if (e.propertyName === 'width') setIsTransitioning(true)
    }
    el.addEventListener('transitionstart', handleStart)
    return () => el.removeEventListener('transitionstart', handleStart)
  }, [])

  const handleTransitionEnd = useCallback((e) => {
    if (e.propertyName === 'width') setIsTransitioning(false)
  }, [])

  if (mode === 'drawer') {
    return null
  }

  const width = mode === 'expanded' ? expandedWidth : slimWidth
  const overflowClass = isTransitioning
    ? 'overflow-hidden'
    : mode === 'slim'
      ? 'overflow-visible'
      : 'overflow-y-auto custom-scrollbar'

  return (
    <div
      ref={panelRef}
      className={`flex-shrink-0 sticky transition-[width] duration-300 ease-in-out ${overflowClass} ${className}`}
      style={{
        width: `${width}px`,
        top: 'calc(var(--header-height) + var(--layout-py))',
        maxHeight: 'calc(100vh - var(--header-height) - 2 * var(--layout-py))',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {mode === 'expanded' && (
        <div className="h-full overflow-y-auto custom-scrollbar">
          {children}
        </div>
      )}
      {mode === 'slim' && (
        <div className="h-full flex flex-col items-center py-3 gap-2">
          {slimContent}
        </div>
      )}
    </div>
  )
}
