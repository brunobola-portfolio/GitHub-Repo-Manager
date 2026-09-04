import { useEffect, useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AlertTriangle, FileCode2, FileJson, ScrollText } from 'lucide-react'
import { SectionSpinner } from '../ui/Spinner'
import { reposApi } from '../../api/repos'

/**
 * Side-by-side diff modal for "Compare with Existing".
 *
 * Given a source repo and a similar target repo (both owner/name), fetches a
 * small set of canonical files (README, package.json) from each and renders
 * them in a two-pane layout. This is the lightweight diff view the ROADMAP
 * flagged as remaining work — backend semantic search already ranked the
 * target; this surface lets a human actually look at the overlap.
 *
 * Props:
 *   isOpen       : boolean
 *   onClose      : () => void
 *   source       : { owner, repo } of the currently-open repo
 *   target       : { owner, repo } of the similar repo the user clicked
 *   targetLabel  : optional display label for the right pane header
 */

// A minimal, deliberately small set — these are the files most useful for a
// "do these two repos solve the same problem?" gut check. More files would
// turn this into a full diff tool, which is out of scope.
const FILES = [
    { path: 'README.md', label: 'README', icon: ScrollText },
    { path: 'package.json', label: 'package.json', icon: FileJson },
]

function decodeBase64Utf8(base64) {
    if (!base64) return ''
    try {
        const cleaned = base64.replace(/\s/g, '')
        const binary = atob(cleaned)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch {
        return base64
    }
}

async function loadFile(owner, repo, path) {
    try {
        const res = await reposApi.getFileContent(owner, repo, path)
        // GitHub's contents API returns either an array (directory) or an object.
        const data = res?.data || res
        if (data && typeof data === 'object' && data.content) {
            return { ok: true, text: decodeBase64Utf8(data.content) }
        }
        return { ok: false, reason: 'unsupported-shape' }
    } catch (err) {
        if (err?.status === 404) return { ok: false, reason: 'missing' }
        return { ok: false, reason: err?.message || 'unknown-error' }
    }
}

function FilePane({ label, loading, result }) {
    if (loading) {
        return (
            <SectionSpinner padding="py-10" />
        )
    }
    if (!result || !result.ok) {
        const msg = !result
            ? 'Not loaded'
            : result.reason === 'missing'
                ? 'File does not exist in this repo.'
                : result.reason === 'unsupported-shape'
                    ? 'Unsupported contents response (directory or symlink).'
                    : `Couldn't load: ${result.reason}`
        return (
            <div className="flex items-center gap-2 p-3 rounded-lg text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-700/40">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                <span>{msg}</span>
            </div>
        )
    }
    // Truncate display to avoid DOM bloat on huge files; add a little
    // header with line count + size so the user knows they're looking
    // at a preview, not the full file.
    const lines = result.text.split('\n')
    const displayed = lines.slice(0, 200).join('\n')
    const truncated = lines.length > 200
    return (
        <div>
            <div className="ds-text-micro uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
                <span>{label}</span>
                <span>
                    {lines.length} lines
                    {truncated ? ' (first 200 shown)' : ''}
                </span>
            </div>
            <pre className="font-mono ds-text-meta leading-relaxed whitespace-pre-wrap break-words p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-700/40 text-slate-800 dark:text-slate-200 max-h-[340px] overflow-y-auto">
                {displayed || '(empty)'}
            </pre>
        </div>
    )
}

export function CompareDiffModal({ isOpen, onClose, source, target, targetLabel }) {
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState({}) // { 'README.md': { source, target }, ... }
    const [activePath, setActivePath] = useState(FILES[0].path)

    useEffect(() => {
        if (!isOpen || !source?.owner || !source?.repo || !target?.owner || !target?.repo) return
        let cancelled = false
        const run = async () => {
            setLoading(true)
            setResults({})
            for (const f of FILES) {
                const [s, t] = await Promise.all([
                    loadFile(source.owner, source.repo, f.path),
                    loadFile(target.owner, target.repo, f.path),
                ])
                if (cancelled) return
                setResults((prev) => ({ ...prev, [f.path]: { source: s, target: t } }))
            }
            if (!cancelled) setLoading(false)
        }
        run()
        return () => { cancelled = true }
    }, [isOpen, source?.owner, source?.repo, target?.owner, target?.repo])

    const sourceLabel = source ? `${source.owner}/${source.repo}` : ''
    const targetDisplay = targetLabel || (target ? `${target.owner}/${target.repo}` : '')
    const current = results[activePath]

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Compare with existing"
            subtitle={sourceLabel && targetDisplay ? `${sourceLabel}  ↔  ${targetDisplay}` : ''}
            size="xl"
            closeOnBackdrop={false}
            icon={FileCode2}
            footer={
                <ModalFooter>
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                </ModalFooter>
            }
        >
            {/* File tabs */}
            <div className="flex items-center gap-1 mb-3 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 w-fit">
                {FILES.map((f) => {
                    const Icon = f.icon
                    const isActive = activePath === f.path
                    return (
                        <button
                            key={f.path}
                            type="button"
                            onClick={() => setActivePath(f.path)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                isActive
                                    ? 'bg-white dark:bg-slate-900 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {f.label}
                        </button>
                    )
                })}
            </div>

            {/* Side-by-side panes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{sourceLabel}</p>
                    <FilePane
                        label={activePath}
                        loading={loading && !current}
                        result={current?.source}
                    />
                </div>
                <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{targetDisplay}</p>
                    <FilePane
                        label={activePath}
                        loading={loading && !current}
                        result={current?.target}
                    />
                </div>
            </div>

            <p className="mt-3 ds-text-meta text-slate-500 dark:text-slate-400">
                This is a quick side-by-side view of canonical files (README, package.json). For a full line-by-line diff, use GitHub's compare view:{' '}
                <code className="font-mono text-xs">github.com/{sourceLabel}/compare/main...{targetDisplay.replace('/', ':')}:main</code>
            </p>
        </Modal>
    )
}
