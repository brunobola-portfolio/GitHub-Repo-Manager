import { Database, ExternalLink, FileWarning } from 'lucide-react'
import { AnimatedCopyIcon } from '../../ui/AnimatedCopyIcon'
import { formatFileSize } from '../../../utils/format'
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard'

export function OversizedFilesPanel({ files, fallback }) {
  const { copied, copy } = useCopyToClipboard()
  const total = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0)

  const handleCopy = () => {
    const text = files.map((f) => `${f.path}\t${formatFileSize(f.sizeBytes, 1)}`).join('\n')
    copy(text)
  }

  return (
    <div className="space-y-3">
      {/* Headline */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/15">
        <FileWarning className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div className="text-xs text-red-700 dark:text-red-300/90 leading-relaxed">
          <p className="font-medium">
            {files.length} file{files.length === 1 ? '' : 's'} exceed GitHub's 100 MB per-file limit
            <span className="ml-1.5 font-normal opacity-80">({formatFileSize(total, 1)} total)</span>
          </p>
          <p className="mt-0.5 opacity-80">
            GitHub rejects any blob over 100 MiB regardless of total repo size — even blobs that exist only in older commits count.
          </p>
        </div>
      </div>

      {/* File list */}
      <div className="relative group/files">
        <div className="rounded-lg border border-red-500/15 bg-red-950/10 dark:bg-red-950/30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-red-500/10 ds-text-micro font-semibold uppercase tracking-wider text-red-500/80">
            <span>Offending paths</span>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy file list"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-900/30"
            >
              <AnimatedCopyIcon copied={copied} size="w-3 h-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul className="divide-y divide-red-500/10 max-h-48 overflow-y-auto ds-scrollbar">
            {files.map((f, i) => (
              <li
                key={`${f.path}-${i}`}
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                <span className="font-[var(--ds-font-mono)] text-red-600 dark:text-red-400/90 truncate flex-1" title={f.path}>
                  {f.path}
                </span>
                <span className="shrink-0 tabular-nums text-red-500/90 font-medium">
                  {formatFileSize(f.sizeBytes, 1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* How to fix */}
      <div className="rounded-lg border border-indigo-500/15 bg-indigo-500/5 dark:bg-indigo-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--ds-accent-brand)] dark:text-indigo-300">
          <Database className="w-3.5 h-3.5" />
          How to fix
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          Run a new migration with the <strong>Migrate to Git LFS</strong> strategy selected for this
          repository. The server runs <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-[var(--ds-font-mono)] ds-text-meta">git lfs migrate import --above=100MiB --everything</code> on a
          fresh bare clone before pushing, which rewrites the affected blobs as LFS pointers without
          losing history.
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Alternative: select <strong>Exclude</strong> on the Configure step to skip this repo, or
          purge the blobs manually with{' '}
          <a
            href="https://github.com/newren/git-filter-repo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-500 hover:text-indigo-400 inline-flex items-center gap-0.5"
          >
            git-filter-repo
            <ExternalLink className="w-3 h-3" />
          </a>
          {' '}before retrying.
        </p>
        <a
          href="https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400"
        >
          GitHub: About large files
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {fallback && (
        <p className="ds-text-meta text-slate-500 italic">{fallback}</p>
      )}
    </div>
  )
}
