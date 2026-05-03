import { useMemo } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
// NOTE: This imports global CSS from the diff library. If upgrading @git-diff-view,
// check for class name conflicts with Tailwind or the design system.
import '@git-diff-view/react/styles/diff-view-pure.css'
import { useTheme } from '../../../hooks/useTheme'

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
 */
function parsePatchToHunks(patch, filename) {
  if (!patch) return []

  const parts = patch.split(/(?=^@@)/m)
  const hunks = parts
    .map(p => p.trim())
    .filter(p => p.startsWith('@@'))

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
 */
export function DiffRenderer({ filename, patch, viewMode, onAddComment, highlightLanguage }) {
  const { isDark } = useTheme()

  const lang = useMemo(() => {
    if (highlightLanguage) return highlightLanguage
    if (!filename) return 'plaintext'
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return LANG_MAP[ext] ?? 'plaintext'
  }, [filename, highlightLanguage])

  const diffData = useMemo(() => {
    if (!patch) return null
    const hunks = parsePatchToHunks(patch, filename)
    if (hunks.length === 0) return null
    return {
      oldFile: { fileName: filename ?? null, fileLang: lang },
      newFile: { fileName: filename ?? null, fileLang: lang },
      hunks,
    }
  }, [patch, filename, lang])

  const diffMode =
    viewMode === 'unified' ? DiffModeEnum.Unified : DiffModeEnum.Split

  if (!diffData) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-gray-400 dark:text-gray-500 italic select-none">
        No diff available for this file.
      </div>
    )
  }

  return (
    <div className="overflow-auto text-sm font-mono">
      <DiffView
        data={diffData}
        diffViewMode={diffMode}
        diffViewTheme={isDark ? 'dark' : 'light'}
        diffViewHighlight
        diffViewAddWidget={Boolean(onAddComment)}
        onAddWidgetClick={
          onAddComment
            ? (lineNumber, side) => onAddComment({ lineNumber, side })
            : undefined
        }
      />
    </div>
  )
}
