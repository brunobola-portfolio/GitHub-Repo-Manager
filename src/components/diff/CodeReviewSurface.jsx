import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileTree } from '../PRReview/FileTree/FileTree'
import { DiffRenderer } from '../PRReview/DiffPanel/DiffRenderer'
import { Spinner } from '../ui/Spinner'
import { CodeReviewToolbar } from './CodeReviewToolbar'
import { MobileFileTreeSheet } from './MobileFileTreeSheet'
import { useDiffPreferences } from '../../hooks/useDiffPreferences'

function loadReviewed(storageKey) {
    if (!storageKey) return new Set()
    try {
        const raw = localStorage.getItem(storageKey)
        return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
}

function saveReviewed(storageKey, set) {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify([...set])) } catch { /* quota — silent */ }
}

export function CodeReviewSurface({
    files = [],
    storageKey,
    sortFiles,                  // optional: (files) => sortedFiles
    fileMeta,                   // optional: { aiFileRisks: [...] } passed to FileTree
    headerSlot = null,
    rightSlot = null,
    emptyState = null,
    initialActiveIndex = 0,
}) {
    const sortedFiles = useMemo(() => (sortFiles ? sortFiles(files) : files), [files, sortFiles])
    const [activeIndex, setActiveIndex] = useState(initialActiveIndex)
    const [reviewed, setReviewedRaw] = useState(() => loadReviewed(storageKey))
    const [treeCollapsed, setTreeCollapsed] = useState(false)
    const [rightCollapsed, setRightCollapsed] = useState(false)
    // Below the `md` breakpoint, the desktop left column is hidden and the
    // file tree is reachable via the toolbar's "Files" button as a
    // bottom sheet. State purely UI; no persistence.
    const [mobileSheetOpen, setMobileSheetOpen] = useState(false)
    const { prefs, setMode, setWrap, setTabWidth } = useDiffPreferences()

    // Re-hydrate viewed set when storageKey changes (commit/PR navigation)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on key change
        setReviewedRaw(loadReviewed(storageKey))
    }, [storageKey])

    const setReviewed = useCallback((updater) => {
        setReviewedRaw(curr => {
            const next = typeof updater === 'function' ? updater(curr) : updater
            saveReviewed(storageKey, next)
            return next
        })
    }, [storageKey])

    // Allow external code to jump the active file via a window event (used by
    // the AI panel "click file" affordance in PRFilesTab).
    const handleFileSelect = useCallback((filename) => {
        const idx = sortedFiles.findIndex(f => f.filename === filename)
        if (idx !== -1) setActiveIndex(idx)
    }, [sortedFiles])

    useEffect(() => {
        function onSelect(e) {
            const filename = e?.detail?.filename
            if (filename) handleFileSelect(filename)
        }
        window.addEventListener('code-review-surface:select-file', onSelect)
        return () => window.removeEventListener('code-review-surface:select-file', onSelect)
    }, [handleFileSelect])

    const activeFile = sortedFiles[activeIndex] ?? null

    function toggleReviewed(filename) {
        setReviewed(prev => {
            const next = new Set(prev)
            if (next.has(filename)) next.delete(filename); else next.add(filename)
            return next
        })
    }

    if (!sortedFiles.length) {
        return emptyState ?? (
            <div className="flex items-center justify-center h-40 text-sm text-slate-500 dark:text-slate-400">
                No files in this changeset.
            </div>
        )
    }

    const additions = sortedFiles.reduce((s, f) => s + (f.additions || 0), 0)
    const deletions = sortedFiles.reduce((s, f) => s + (f.deletions || 0), 0)

    return (
        <div className="flex flex-col h-full min-h-0">
            <CodeReviewToolbar
                filesCount={sortedFiles.length}
                additions={additions}
                deletions={deletions}
                reviewedCount={reviewed.size}
                activeIndex={activeIndex}
                treeCollapsed={treeCollapsed}
                onToggleTree={() => setTreeCollapsed(c => !c)}
                onOpenMobileTree={() => setMobileSheetOpen(true)}
                onPrev={() => setActiveIndex(i => Math.max(0, i - 1))}
                onNext={() => setActiveIndex(i => Math.min(sortedFiles.length - 1, i + 1))}
                mode={prefs.mode}
                onToggleMode={() => setMode(prefs.mode === 'unified' ? 'split' : 'unified')}
                wrap={prefs.wrap}
                onToggleWrap={() => setWrap(!prefs.wrap)}
                tabWidth={prefs.tabWidth}
                onSetTabWidth={setTabWidth}
                rightSlotPresent={rightSlot != null}
                rightCollapsed={rightCollapsed}
                onToggleRight={() => setRightCollapsed(c => !c)}
            />

            <MobileFileTreeSheet
                isOpen={mobileSheetOpen}
                onClose={() => setMobileSheetOpen(false)}
                files={sortedFiles}
                activeFile={activeFile?.filename ?? ''}
                reviewedFiles={[...reviewed]}
                aiFileRisks={fileMeta?.aiFileRisks ?? []}
                onFileSelect={handleFileSelect}
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                {!treeCollapsed && (
                    <div className="hidden md:block w-[220px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20">
                        <FileTree
                            files={sortedFiles}
                            activeFile={activeFile?.filename ?? ''}
                            reviewedFiles={[...reviewed]}
                            aiFileRisks={fileMeta?.aiFileRisks ?? []}
                            onFileSelect={handleFileSelect}
                        />
                        {activeFile && (
                            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={reviewed.has(activeFile.filename)}
                                        onChange={() => toggleReviewed(activeFile.filename)}
                                        className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Mark as reviewed
                                </label>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 min-w-0 overflow-auto">
                    {headerSlot}
                    {activeFile ? (
                        <div className="min-w-0">
                            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800 text-xs">
                                <span className="font-mono text-slate-700 dark:text-slate-200 font-medium truncate">{activeFile.filename}</span>
                                <span className="flex-shrink-0 text-green-600 dark:text-green-400">+{activeFile.additions}</span>
                                <span className="flex-shrink-0 text-red-600 dark:text-red-400">−{activeFile.deletions}</span>
                            </div>
                            {activeFile.patch ? (
                                <DiffRenderer
                                    filename={activeFile.filename}
                                    patch={activeFile.patch}
                                    viewMode={prefs.mode}
                                    tabWidth={prefs.tabWidth}
                                    wrap={prefs.wrap}
                                    additions={activeFile.additions || 0}
                                    deletions={activeFile.deletions || 0}
                                    storageKey={storageKey}
                                />
                            ) : (
                                <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                                    No diff available for this file (binary or too large).
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-40">
                            <Spinner size="md" />
                        </div>
                    )}
                </div>

                {rightSlot && !rightCollapsed && (
                    <div data-testid="code-review-right" className="w-[280px] flex-shrink-0 border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20 p-3">
                        {rightSlot}
                    </div>
                )}
            </div>
        </div>
    )
}
