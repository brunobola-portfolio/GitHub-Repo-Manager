import { useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RepoRow } from './RepoRow'

const VIRTUALIZATION_THRESHOLD = 50

export function RepoList({ repos, selectedIds, activeId, density, onToggle, onOpenDetail }) {
  if (repos.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div
        className="space-y-1.5 max-h-[calc(100vh-420px)] overflow-y-auto pr-0.5"
        role="group"
        aria-label={`Repositories (${repos.length})`}
      >
        <AnimatePresence initial={false}>
          {repos.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              isSelected={selectedIds.has(r.id)}
              isActive={activeId === r.id}
              density={density}
              onToggle={onToggle}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </AnimatePresence>
      </div>
    )
  }

  return <VirtualList
    repos={repos}
    selectedIds={selectedIds}
    activeId={activeId}
    density={density}
    onToggle={onToggle}
    onOpenDetail={onOpenDetail}
  />
}

function VirtualList({ repos, selectedIds, activeId, density, onToggle, onOpenDetail }) {
  const parentRef = useRef(null)
  const rowHeight = density === 'compact' ? 40 : 68
  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is intentional; the React Compiler's compatibility check skips the function but the hook itself is React-stable
  const virtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })
  return (
    <div
      ref={parentRef}
      className="max-h-[32rem] overflow-y-auto pr-0.5"
      role="group"
      aria-label={`Repositories (${repos.length})`}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const r = repos[vi.index]
          return (
            <div
              key={r.id}
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 6,
              }}
            >
              <RepoRow
                repo={r}
                isSelected={selectedIds.has(r.id)}
                isActive={activeId === r.id}
                density={density}
                onToggle={onToggle}
                onOpenDetail={onOpenDetail}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
