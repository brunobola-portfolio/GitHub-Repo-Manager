import { EmptyState } from '../ui/EmptyState'
import { RepoMarkdown } from '../ui/RepoMarkdown'
import { SectionPanel } from '../ui/SectionPanel'
import { FileText, BookOpen, Sparkles, Info } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useModal } from '../../hooks/useModal'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { InlineEditField } from './InlineEditField'

/**
 * Decode a GitHub contents-API README payload into a UTF-8 string.
 *
 * GitHub returns content as base64 with whitespace/newlines injected every
 * ~60 chars — atob() rejects that whitespace, so we strip it first. The
 * remaining atob() output is a binary string (one char per byte), which
 * would render non-ASCII (emoji, accents, CJK) as mojibake if handed
 * straight to React. We therefore route the bytes through TextDecoder so
 * multi-byte UTF-8 sequences render correctly.
 *
 * Safe for empty/missing content — returns '' instead of throwing.
 */
function decodeBase64ReadmeUtf8(base64) {
    if (!base64) return ''
    try {
        const cleaned = base64.replace(/\s/g, '')
        const binary = atob(cleaned)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch {
        // Corrupted / non-base64 payload — fall back to the raw string so
        // users at least see *something* instead of a blank card.
        return base64
    }
}

export function OverviewTab({ api, repoData, onUpdate }) {
    const { openModalWithData } = useModal()
    const { toast } = useToast()
    const { data: readme, loading, error } = useTabData(
        async () => {
            const result = await api.fetchReadme()
            return result.data || result
        },
        [api],
    )

    const canEdit = !!onUpdate && !repoData.archived
    const saveField = async (key, value, label) => {
        try {
            const result = await api.updateRepo({ [key]: value })
            const updated = result.data || result
            onUpdate?.((prev) => ({ ...prev, ...updated }))
            toast.success(`${label} updated`)
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: `Failed to update ${label.toLowerCase()}` })
            throw e
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* AI Insights entry point */}
            <div className="lg:col-span-3">
                <button
                    onClick={() => openModalWithData('showRepoInsights', { repo: repoData, initialTab: 'quality' })}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 ds-btn-shimmer ds-focus-ring transition"
                >
                    <Sparkles className="w-4 h-4" />
                    View AI Insights
                </button>
            </div>

            {/* README */}
            <div className="lg:col-span-2">
                <SectionPanel title="README" icon={BookOpen}>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Spinner size="lg" />
                        </div>
                    ) : error ? (
                        // 404 means no README yet — show the empty-state, not
                        // a red error banner. 401/403 means the user lost the
                        // GitHub token; show a friendly "sign in to view"
                        // instead of leaking the raw "Session expired" string
                        // from the server. Other failures get a generic retry
                        // message — never the raw server message.
                        error.status === 404 ? (
                            <EmptyState
                                icon={BookOpen}
                                title="No README"
                                description="This repository doesn't have a README yet."
                            />
                        ) : (error.status === 401 || error.status === 403) ? (
                            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400">
                                Sign in again to view this README.
                            </div>
                        ) : (
                            <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                                Couldn&apos;t load the README. Please retry.
                            </div>
                        )
                    ) : readme?.content ? (
                        <RepoMarkdown
                            source={decodeBase64ReadmeUtf8(readme.content)}
                            owner={repoData.owner?.login || repoData.full_name?.split('/')[0]}
                            repo={repoData.name}
                            branch={repoData.default_branch || 'main'}
                        />
                    ) : (
                        <EmptyState
                            icon={BookOpen}
                            title="No README"
                            description="This repository doesn't have a README yet."
                        />
                    )}
                </SectionPanel>
            </div>

            {/* Sidebar info */}
            <div className="space-y-4">
                <SectionPanel title="About" icon={Info}>
                    <dl className="space-y-2 text-sm">
                        <div>
                            <dt className="text-xs text-slate-500 dark:text-slate-400">Description</dt>
                            <dd>
                                <InlineEditField
                                    value={repoData.description}
                                    placeholder="Add a description"
                                    ariaLabel="description"
                                    disabled={!canEdit}
                                    onSave={(v) => saveField('description', v, 'Description')}
                                />
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-slate-500 dark:text-slate-400">Website</dt>
                            <dd>
                                <InlineEditField
                                    value={repoData.homepage}
                                    placeholder="Add a website"
                                    ariaLabel="website"
                                    type="url"
                                    disabled={!canEdit}
                                    onSave={(v) => saveField('homepage', v, 'Website')}
                                    renderValue={(v) => (
                                        <a href={v} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-600 dark:text-indigo-400 hover:underline truncate block">{v}</a>
                                    )}
                                />
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-slate-500 dark:text-slate-400">Default Branch</dt>
                            <dd className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <FileText className="w-3 h-3" /> {repoData.default_branch || 'main'}
                            </dd>
                        </div>
                        {repoData.license?.name && (
                            <div>
                                <dt className="text-xs text-slate-500 dark:text-slate-400">License</dt>
                                <dd className="text-slate-700 dark:text-slate-300">{repoData.license.name}</dd>
                            </div>
                        )}
                        <div>
                            <dt className="text-xs text-slate-500 dark:text-slate-400">Created</dt>
                            <dd className="text-slate-700 dark:text-slate-300">{repoData.created_at ? new Date(repoData.created_at).toLocaleDateString() : 'N/A'}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-slate-500 dark:text-slate-400">Last Updated</dt>
                            <dd className="text-slate-700 dark:text-slate-300">{repoData.updated_at ? new Date(repoData.updated_at).toLocaleDateString() : 'N/A'}</dd>
                        </div>
                        {repoData.size > 0 && (
                            <div>
                                <dt className="text-xs text-slate-500 dark:text-slate-400">Size</dt>
                                <dd className="text-slate-700 dark:text-slate-300">{(repoData.size / 1024).toFixed(1)} MB</dd>
                            </div>
                        )}
                    </dl>
                </SectionPanel>

                {repoData.topics?.length > 0 && (
                    <SectionPanel title="Topics">
                        <div className="flex flex-wrap gap-1.5">
                            {repoData.topics.map(topic => (
                                <span key={topic} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                                    {topic}
                                </span>
                            ))}
                        </div>
                    </SectionPanel>
                )}
            </div>
        </div>
    )
}
