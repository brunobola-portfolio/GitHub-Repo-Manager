import { memo, useCallback, useDeferredValue, useMemo } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
// NOTE: This imports global CSS from the diff library. If upgrading @git-diff-view,
// check for class name conflicts with Tailwind or the design system.
import '@git-diff-view/react/styles/diff-view-pure.css'
import { useTheme } from '../../../hooks/useTheme'
import { pickRenderStrategy } from './diffSize'
import { DiffCollapser } from './DiffCollapser'
import { DiffComputeOnDemand } from './DiffComputeOnDemand'
import ErrorBoundary from '../../ErrorBoundary'
import { splitPatchIntoHunks } from './hunkUtils'

// Silence a dev-only sanity warning from @git-diff-view/core that fires
// because we feed it GitHub patch fragments (no full file content). The
// library tries to reconstruct old/new file content from the diff and
// validates round-trip — for partial patches the validation is
// structurally unactionable. The warning lives at
// node_modules/@git-diff-view/core/dist/esm/index.mjs:2736 and is gated on
// NODE_ENV === 'development', so this filter is a no-op in production.
// Sentinel guards against double-install during HMR / repeated module evaluation.
// See docs/specs/2026-05-09-pr-review-perf-and-polish-design.md (Slice 1.2).
if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    const PREFIX = '[@git-diff-view/core] Mismatch detected'
    const original = console.warn
    if (!original.__diffViewMismatchFiltered) {
        const filtered = (...args) => {
            if (typeof args[0] === 'string' && args[0].startsWith(PREFIX)) return
            return original.apply(console, args)
        }
        filtered.__diffViewMismatchFiltered = true
        console.warn = filtered
    }
}

/**
 * Expand tab characters in a patch string to the given number of spaces.
 * Returns the original patch unchanged when tabWidth is falsy or 1.
 */
function expandTabs(patch, tabWidth) {
  if (!patch || !tabWidth || tabWidth === 1) return patch
  const spaces = ' '.repeat(tabWidth)
  return patch.replace(/\t/g, spaces)
}

/**
 * Language map: file extension → highlight.js language id
 */
const LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  php: 'php',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  vue: 'vue',
}

/**
 * Parse a unified diff patch string into an array of hunk strings.
 *
 * GitHub API patches start with @@ (no --- / +++ header). The underlying
 * @git-diff-view/core DiffParser.parseDiffHeader() requires --- and +++ lines
 * before it will process hunks, so we synthesise minimal headers per chunk.
 * Hunk-splitting itself lives in hunkUtils.splitPatchIntoHunks — shared with
 * HunkRiskRail so there's one source of truth for hunk boundaries.
 */
function parsePatchToHunks(patch, filename) {
  const hunks = splitPatchIntoHunks(patch)
  if (hunks.length === 0) return []

  const a = `a/${filename || 'file'}`
  const b = `b/${filename || 'file'}`
  return hunks.map(h => `--- ${a}\n+++ ${b}\n${h}`)
}

/**
 * Abstraction over @git-diff-view/react.
 *
 * Receives a unified diff patch string (as returned by the GitHub API per-file)
 * and renders it in split or unified mode.
 *
 * @param {object}   props
 * @param {string}   props.filename          - Full path of the file being diffed
 * @param {string}   [props.patch]           - Unified diff patch string from GitHub API
 * @param {'split'|'unified'} props.viewMode - Display mode
 * @param {Function} [props.onAddComment]    - Called with { lineNumber, side } when the widget button is clicked
 * @param {string}   [props.highlightLanguage] - Override language for syntax highlighting
 * @param {number}   [props.tabWidth=4]      - Number of spaces each tab character expands to
 * @param {boolean}  [props.wrap=false]      - When true, long lines wrap instead of scrolling horizontally
 */
// memo: DiffPanel owns the inline-comment composer's `commentBody` state, so
// it re-renders on every keystroke. Without this the third-party <DiffView>
// (and its highlighting) re-rendered with it — the dominant cost of typing a
// review comment on a large diff.
export const DiffRenderer = memo(function DiffRenderer({
  filename,
  patch,
  viewMode,
  onAddComment,
  highlightLanguage,
  tabWidth = 4,
  wrap = false,
  additions = 0,
  deletions = 0,
  storageKey,
}) {
  const { isDark } = useTheme()

  // Defer tab-width re-application — on a 5k-line patch the tab→spaces
  // pass blocks paint for hundreds of ms. useDeferredValue lets React
  // keep the previous patch on screen while the next renders, freeing
  // the main thread for input.
  const deferredTabWidth = useDeferredValue(tabWidth)
  const expanded = useMemo(() => expandTabs(patch, deferredTabWidth), [patch, deferredTabWidth])

  const lang = useMemo(() => {
    if (highlightLanguage) return highlightLanguage
    if (!filename) return 'plaintext'
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return LANG_MAP[ext] ?? 'plaintext'
  }, [filename, highlightLanguage])

  const diffData = useMemo(() => {
    if (!expanded) return null
    const hunks = parsePatchToHunks(expanded, filename)
    if (hunks.length === 0) return null
    return {
      oldFile: { fileName: filename ?? null, fileLang: lang },
      newFile: { fileName: filename ?? null, fileLang: lang },
      hunks,
    }
  }, [expanded, filename, lang])

  // Stable identity so DiffView isn't handed a brand-new handler on every
  // render — the library treats that as a prop change on every gutter row.
  const handleAddWidgetClick = useCallback(
    (lineNumber, side) => onAddComment?.({ lineNumber, side }),
    [onAddComment]
  )

  const diffMode =
    viewMode === 'unified' ? DiffModeEnum.Unified : DiffModeEnum.Split

  if (!diffData) {
    return (
      <div className={`diff-renderer${wrap ? ' diff-wrap-on' : ''}`}>
        <div className="flex items-center justify-center h-24 text-sm text-slate-400 dark:text-slate-500 italic select-none">
          No diff available for this file.
        </div>
      </div>
    )
  }

  // The lib's actual diff. Wrapped or unwrapped depending on file size.
  // DiffView is third-party (@git-diff-view) and is fed partial GitHub patch
  // fragments; certain inputs trip internal split-view edge cases (e.g.
  // getSplitLeftLine reading null). A diff-local error boundary keeps that
  // contained to "this file's diff" instead of bubbling up and taking down the
  // whole PR Review view (which would kill the breadcrumb + back navigation).
  // Keyed by filename so switching files starts with a fresh, un-errored boundary.
  const diffElement = (
    <div className={`diff-renderer overflow-auto text-sm font-mono${wrap ? ' diff-wrap-on' : ''}`}>
      <ErrorBoundary
        key={filename}
        fallback={() => (
          <div className="flex items-center justify-center h-24 px-4 text-center text-sm text-slate-400 dark:text-slate-500 italic select-none">
            Couldn&apos;t render the diff for this file. The rest of the review is unaffected.
          </div>
        )}
      >
        <DiffView
          data={diffData}
          diffViewMode={diffMode}
          diffViewTheme={isDark ? 'dark' : 'light'}
          diffViewHighlight
          diffViewAddWidget={Boolean(onAddComment)}
          onAddWidgetClick={onAddComment ? handleAddWidgetClick : undefined}
        />
      </ErrorBoundary>
    </div>
  )

  const strategy = pickRenderStrategy({ additions, deletions })
  if (strategy === 'compute') {
    return (
      <DiffComputeOnDemand filename={filename} additions={additions} deletions={deletions}>
        {diffElement}
      </DiffComputeOnDemand>
    )
  }
  if (strategy === 'collapse') {
    return (
      <DiffCollapser filename={filename} additions={additions} deletions={deletions} storageKey={storageKey}>
        {({ collapsed }) => collapsed ? null : diffElement}
      </DiffCollapser>
    )
  }
  return diffElement
})
