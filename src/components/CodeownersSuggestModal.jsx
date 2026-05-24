import { useEffect, useState } from 'react'
import { Modal, ModalFooter } from './ui/Modal'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Loader2, Copy, CheckCircle2, AlertTriangle, Users, GitCommit, Settings2 } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { Textarea } from './ui/form'
import { reposApi } from '../api/repos'

/**
 * CODEOWNERS Suggest modal — renders the output of the
 * `/codeowners/suggest` endpoint: hotspot directories, per-path owner
 * ranking, and a ready-to-paste `.github/CODEOWNERS` preview with a
 * copy-to-clipboard action.
 *
 * Props:
 *   isOpen  : boolean
 *   onClose : () => void
 *   owner   : string
 *   repo    : string
 */
export function CodeownersSuggestModal({ isOpen, onClose, owner, repo }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [data, setData] = useState(null)
    const [copied, setCopied] = useState(false)

    // Tunables — mirror the backend query params so the user can iterate
    // quickly on the suggestion shape without leaving the modal.
    const [commits, setCommits] = useState(100)
    const [minTouches, setMinTouches] = useState(2)
    const [maxOwners, setMaxOwners] = useState(3)

    const load = async () => {
        if (!owner || !repo) return
        setLoading(true)
        setError(null)
        setCopied(false)
        try {
            const res = await reposApi.suggestCodeowners(owner, repo, { commits, minTouches, maxOwners })
            setData(res)
        } catch (err) {
            setError(err?.message || 'Failed to fetch suggestions')
        } finally {
            setLoading(false)
        }
    }

    /* eslint-disable react-hooks/set-state-in-effect -- mount + open-state fetch */
    useEffect(() => {
        if (isOpen) load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, owner, repo])
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleCopy = async () => {
        if (!data?.preview) return
        try {
            await navigator.clipboard.writeText(data.preview)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        } catch {
            // Clipboard permission denied — fall back to a textarea the user
            // can manually select. ConfirmModal / Modal doesn't wrap the
            // preview textarea so the user can still Ctrl+A the textarea
            // below, which is the accessible fallback path.
        }
    }

    // Compute hotspots inline — the backend already ranks rules by touch
    // count, but we want a short "top 3" pill row above the full list.
    const hotspots = (data?.rules || [])
        .slice()
        .sort((a, b) => b.owners.length - a.owners.length)
        .slice(0, 3)

    const title = 'Suggest CODEOWNERS'
    const subtitle = owner && repo
        ? `${owner}/${repo} — from recent commit authorship`
        : ''

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            size="lg"
            closeOnBackdrop={false}
            footer={
                <ModalFooter>
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                    <Button
                        variant="primary"
                        onClick={handleCopy}
                        disabled={!data?.preview}
                        data-testid="codeowners-copy-btn"
                    >
                        {copied ? (
                            <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Copied</>
                        ) : (
                            <><Copy className="w-4 h-4 mr-1.5" /> Copy CODEOWNERS</>
                        )}
                    </Button>
                </ModalFooter>
            }
        >
            {/* Tuning controls */}
            <div className="flex items-center gap-3 flex-wrap p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-700/40 mb-4">
                <Settings2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Commits to analyse
                    <input
                        type="number"
                        value={commits}
                        onChange={(e) => setCommits(Math.min(200, Math.max(20, Number(e.target.value) || 100)))}
                        min={20}
                        max={200}
                        className="w-16 px-1.5 py-0.5 text-xs text-center rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                    />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Min touches
                    <input
                        type="number"
                        value={minTouches}
                        onChange={(e) => setMinTouches(Math.max(1, Number(e.target.value) || 1))}
                        min={1}
                        max={10}
                        className="w-14 px-1.5 py-0.5 text-xs text-center rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                    />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Max owners
                    <input
                        type="number"
                        value={maxOwners}
                        onChange={(e) => setMaxOwners(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                        min={1}
                        max={5}
                        className="w-14 px-1.5 py-0.5 text-xs text-center rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                    />
                </label>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={load}
                    disabled={loading}
                    className="ml-auto"
                >
                    {loading ? <Spinner size="xs" className="mr-1" /> : null}
                    Regenerate
                </Button>
            </div>

            {loading && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <Spinner size="lg" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Scanning {commits} recent commits…
                    </p>
                </div>
            )}

            {!loading && error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 text-sm text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && !error && data && !data.found && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-sm text-amber-800 dark:text-amber-300 space-y-1">
                    <p className="font-medium">No suggestions yet.</p>
                    <p className="text-xs">
                        Analyzed {data.analyzedCommits} commits but no author crossed
                        the min-touches threshold. Lower <strong>Min touches</strong>
                        {' '}to 1 or increase <strong>Commits to analyse</strong> and
                        regenerate.
                    </p>
                </div>
            )}

            {!loading && !error && data?.found && (
                <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                            <GitCommit className="w-3.5 h-3.5" />
                            {data.analyzedCommits} commits analysed
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {data.rules.length} path {data.rules.length === 1 ? 'rule' : 'rules'}
                        </span>
                    </div>

                    {/* Hotspots */}
                    {hotspots.length > 0 && (
                        <div>
                            <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                Most-contended paths
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {hotspots.map((h) => (
                                    <span
                                        key={h.pattern}
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                                    >
                                        <span className="font-mono">{h.pattern}</span>
                                        <span className="text-indigo-500 dark:text-indigo-400">
                                            {h.owners.length} {h.owners.length === 1 ? 'owner' : 'owners'}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Rules table */}
                    <div>
                        <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                            Suggested rules
                        </p>
                        <Card glass={false} shadow="none" className="rounded-xl">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left ds-text-meta uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-3 py-2 font-semibold">Path</th>
                                        <th className="px-3 py-2 font-semibold">Owners</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {data.rules.map((r) => (
                                        <tr key={r.pattern}>
                                            <td className="px-3 py-2 font-mono text-[13px] text-slate-800 dark:text-slate-200">
                                                {r.pattern}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                                {r.owners.map((o) => (
                                                    <span
                                                        key={o}
                                                        className="inline-block mr-1.5 mb-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-mono"
                                                    >
                                                        {o}
                                                    </span>
                                                ))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    </div>

                    {/* Preview — plain textarea so users can Ctrl+A on denied clipboards. */}
                    <div>
                        <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                            .github/CODEOWNERS preview
                        </p>
                        <Textarea
                            readOnly
                            value={data.preview}
                            rows={Math.min(12, Math.max(4, data.preview.split('\n').length + 1))}
                            aria-label="CODEOWNERS preview"
                            className="font-mono text-xs"
                            onFocus={(e) => e.target.select()}
                        />
                        <p className="mt-1 ds-text-meta text-slate-500 dark:text-slate-400">
                            Paste into <code className="font-mono">.github/CODEOWNERS</code> on the default branch and open a PR — GitHub will pick it up automatically.
                        </p>
                    </div>
                </div>
            )}
        </Modal>
    )
}
