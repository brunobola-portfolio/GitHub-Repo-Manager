import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown } from 'lucide-react'
import { FileTreeItem } from './FileTreeItem'
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

  // Build AI risk lookup: filename -> level string (e.g. 'high')
  const aiRiskMap = useMemo(() => {
    const map = {}
    if (Array.isArray(aiFileRisks)) {
      for (const entry of aiFileRisks) {
        if (entry?.filename) map[entry.filename] = entry.level ?? entry.risk
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

  // Sort files
  const sortedFiles = useMemo(() => {
    if (sortMode === 'az') {
      return [...files].sort((a, b) => a.filename.localeCompare(b.filename))
    }
    // Risk sort: named AI level first, then heuristic score
    const riskOrder = { critical: 5, high: 4, medium: 3, low: 2 }
    return [...files].sort((a, b) => {
      const aiA = riskOrder[aiRiskMap[a.filename]] ?? heuristicMap[a.filename] ?? 0
      const aiB = riskOrder[aiRiskMap[b.filename]] ?? heuristicMap[b.filename] ?? 0
      return aiB - aiA
    })
  }, [files, sortMode, aiRiskMap, heuristicMap])

  const rowVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 15,
  })

  // Scroll active file into view when it changes
  useEffect(() => {
    if (!activeFile) return
    const idx = sortedFiles.findIndex(f => f.filename === activeFile)
    if (idx !== -1) {
      rowVirtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  }, [activeFile, sortedFiles, rowVirtualizer])

  const nextSortMode = sortMode === 'risk' ? 'az' : 'risk'

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Files ({files.length})
        </span>
        <button
          onClick={() => onSortChange?.(nextSortMode)}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={`Sort by ${nextSortMode === 'risk' ? 'risk' : 'A–Z'}`}
          aria-label={`Currently sorted by ${sortMode === 'risk' ? 'risk' : 'A–Z'}. Click to sort by ${nextSortMode === 'risk' ? 'risk' : 'A–Z'}`}
        >
          <ArrowUpDown size={11} aria-hidden="true" />
          {sortMode === 'risk' ? 'Risk' : 'A–Z'}
        </button>
      </div>

      {/* Virtualized list */}
      <div
        ref={parentRef}
        role="tree"
        aria-label="Changed files"
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const file = sortedFiles[virtualRow.index]
            const isActive = file.filename === activeFile
            const isReviewed = reviewedFiles.includes(file.filename)
            const aiRisk = aiRiskMap[file.filename]
            const hScore = heuristicMap[file.filename]

            return (
              <div
                key={file.filename}
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
                  file={file}
                  isActive={isActive}
                  isReviewed={isReviewed}
                  aiRisk={aiRisk}
                  heuristicScore={hScore}
                  onClick={() => onFileSelect?.(file.filename)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
