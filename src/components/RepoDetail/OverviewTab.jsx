import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Loader2, FileText, BookOpen, Sparkles } from 'lucide-react'
import { useModal } from '../../hooks/useModal'

export function OverviewTab({ owner, repo, api, repoData }) {
    const { openModalWithData } = useModal()
    const [readme, setReadme] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        const controller = new AbortController()
        const load = async () => {
            setLoading(true)
            setError(null)
            try {
                const data = await api.fetchReadme()
                if (!controller.signal.aborted) {
                    setReadme(data.data || data)
                }
            } catch (e) {
                if (!controller.signal.aborted) {
                    setReadme(null)
                    setError(e?.message || 'Failed to load README')
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }
        load()
        return () => controller.abort()
    }, [owner, repo]) // eslint-disable-line react-hooks/exhaustive-deps

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
                <Card className="p-6">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-4">
                        <BookOpen className="w-4 h-4 text-indigo-500" /> README
                    </h3>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                            {error}
                        </div>
                    ) : readme?.content ? (
                        <div className="prose dark:prose-invert prose-sm max-w-none overflow-auto">
                            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                {atob(readme.content.replace(/\n/g, ''))}
                            </pre>
                        </div>
                    ) : (
                        <EmptyState
                            icon={BookOpen}
                            title="No README"
                            description="This repository doesn't have a README yet."
                        />
                    )}
                </Card>
            </div>

            {/* Sidebar info */}
            <div className="space-y-4">
                <Card className="p-4">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-3">About</h3>
                    <dl className="space-y-2 text-sm">
                        {repoData.description && (
                            <div>
                                <dt className="text-xs text-slate-500 dark:text-slate-400">Description</dt>
                                <dd className="text-slate-700 dark:text-slate-300">{repoData.description}</dd>
                            </div>
                        )}
                        {repoData.homepage && (
                            <div>
                                <dt className="text-xs text-slate-500 dark:text-slate-400">Website</dt>
                                <dd><a href={repoData.homepage} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline truncate block">{repoData.homepage}</a></dd>
                            </div>
                        )}
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
                </Card>

                {repoData.topics?.length > 0 && (
                    <Card className="p-4">
                        <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-3">Topics</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {repoData.topics.map(topic => (
                                <span key={topic} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                                    {topic}
                                </span>
                            ))}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    )
}
