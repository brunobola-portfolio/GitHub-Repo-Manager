import { useRef, useEffect, useMemo, useState, useId } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown } from 'lucide-react'
import { FileTreeItem } from './FileTreeItem'
import { RiskRail } from './RiskRail'
import { heuristicRisk } from '../hooks/useReviewAI'

/**
 * Virtualized file list with sort toggle.
 *
 * @param {Array}    files            - PR file objects [{ filename, additions, deletions, status }]
 * @param {string}   activeFile       - Currently selected filename
 * @param {string[]} reviewedFiles    - Array of reviewed filenames
 * @param {Array}    [aiFileRisks]    - Array of { filename, level } from AI summary fileRisks
 * @param {object}   [heuristicScores] - Precomputed { filename: score } map (optional)
 * @param {Function} onFileSelect     - Called with filename when a row is clicked
 * @param {string}   sortMode         - 'risk' | 'az'
 * @param {Function} onSortChange     - Called with new sort mode
 */
export function FileTree({
  files = [],
  activeFile,
  reviewedFiles = [],
  aiFileRisks = [],
  heuristicScores,
  onFileSelect,
  sortMode = 'risk',
  onSortChange,
}) {
  const parentRef = useRef(null)
  const treeId = useId()
  const itemId = (i) => `${treeId}-item-${i}`
  // Roving "active descendant" index for keyboard navigation. Focus stays on
  // the tree container; this points aria-activedescendant at the current row.
  const [focusedIndex, setFocusedIndex] = useState(0)

  // Build AI risk lookup: filename -> level string (e.g. 'high')
  // AI fileRisks items use `file` as the filename property
  const aiRiskMap = useMemo(() => {
    const map = {}
    if (Array.isArray(aiFileRisks)) {
      for (const entry of aiFileRisks) {
        const key = entry?.file ?? entry?.filename
        if (key) map[key] = entry.level ?? entry.risk
      }
    }
    return map
  }, [aiFileRisks])

  // Heuristic scores: use provided map or compute on the fly
  const heuristicMap = useMemo(() => {
    if (heuristicScores) return heuristicScores
    const map = {}
    for (const file of files) {
      map[file.filename] = heuristicRisk(file)
    }
    return map
  }, [heuristicScores, files])

  // Files are already sorted by PRReviewView — use them directly

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is intentional; the React Compiler's compatibility check skips the function but the hook itself is React-stable
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 15,
  })

  // Scroll active file into view when it changes + move the roving anchor to it
  // (so keyboard navigation resumes from the selected file).
  useEffect(() => {
    if (!activeFile) return
    const idx = files.findIndex(f => f.filename === activeFile)
    if (idx !== -1) {
      setFocusedIndex(idx)
      rowVirtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  }, [activeFile, files, rowVirtualizer])

  // Keyboard navigation for the tree (focus stays on the container; we move the
  // active descendant). Up/Down step, Home/End jump, Enter/Space select. Off-
  // screen targets are scrolled in so aria-activedescendant resolves.
  const handleTreeKeyDown = (e) => {
    if (!files.length) return
    let next = focusedIndex
    switch (e.key) {
      case 'ArrowDown': next = Math.min(focusedIndex + 1, files.length - 1); break
      case 'ArrowUp': next = Math.max(focusedIndex - 1, 0); break
      case 'Home': next = 0; break
      case 'End': next = files.length - 1; break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (files[focusedIndex]) onFileSelect?.(files[focusedIndex].filename)
        return
      default:
        return
    }
    e.preventDefault()
    setFocusedIndex(next)
    rowVirtualizer.scrollToIndex(next, { align: 'auto' })
  }

  // Clamp in case the file list shrank under a stale index.
  const activeDescendantIndex = Math.max(0, Math.min(focusedIndex, files.length - 1))

  const nextSortMode = sortMode === 'risk' ? 'az' : 'risk'

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <span className="ds-eyebrow text-slate-600 dark:text-slate-400">
          Files ({files.length})
        </span>
        <button
          onClick={() => onSortChange?.(nextSortMode)}
          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ds-focus-ring"
          title={`Sort by ${nextSortMode === 'risk' ? 'risk' : 'A–Z'}`}
          aria-label={`Currently sorted by ${sortMode === 'risk' ? 'risk' : 'A–Z'}. Click to sort by ${nextSortMode === 'risk' ? 'risk' : 'A–Z'}`}
        >
          <ArrowUpDown size={11} aria-hidden="true" />
          {sortMode === 'risk' ? 'Risk' : 'A–Z'}
        </button>
      </div>

      {/* Row: risk rail (whole-PR heat overview) + the virtualized list. */}
      <div className="flex flex-1 min-h-0">
        <RiskRail
          files={files}
          aiRiskMap={aiRiskMap}
          heuristicMap={heuristicMap}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
        />

        {/* Virtualized list. Focus lives here (single tab stop); arrow keys move
            the active descendant. The sizer + row wrappers are presentational so
            the treeitems read as direct children of the tree despite virtualization. */}
        <div
          ref={parentRef}
          role="tree"
          tabIndex={0}
          aria-label="Changed files"
          aria-activedescendant={files[activeDescendantIndex] ? itemId(activeDescendantIndex) : undefined}
          onKeyDown={handleTreeKeyDown}
          className="flex-1 overflow-y-auto overflow-x-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--ds-accent-ring)]"
        >
          <div
            role="presentation"
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const file = files[virtualRow.index]
              const isActive = file.filename === activeFile
              const isReviewed = reviewedFiles.includes(file.filename)
              const aiRisk = aiRiskMap[file.filename]
              const hScore = heuristicMap[file.filename]

              return (
                <div
                  key={file.filename}
                  role="presentation"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <FileTreeItem
                    id={itemId(virtualRow.index)}
                    file={file}
                    isActive={isActive}
                    isFocused={virtualRow.index === activeDescendantIndex}
                    isReviewed={isReviewed}
                    aiRisk={aiRisk}
                    heuristicScore={hScore}
                    posInSet={virtualRow.index + 1}
                    setSize={files.length}
                    onClick={() => { setFocusedIndex(virtualRow.index); onFileSelect?.(file.filename) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
