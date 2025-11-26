import { useState } from 'react'
import { ArrowRight, Building2, GitFork, X, AlertTriangle, ArrowRightLeft, Copy } from 'lucide-react'
import { Button } from './ui/Button'
import { ProgressBar } from './ui/ProgressBar'

export function TransferModal({
    isOpen,
    onClose,
    repos = [],
    orgs = [],
    onTransfer,
    onMirror,
    isPerforming = false,
    progress = null
}) {
	    const [targetOrg, setTargetOrg] = useState('')
	    const [action, setAction] = useState('transfer') // 'transfer' | 'mirror'

    if (!isOpen) return null

    const handleSubmit = () => {
        if (!targetOrg) {
            alert('Please select a target organization')
            return
        }
        if (action === 'transfer') {
            onTransfer?.(repos.map(r => r.full_name), targetOrg)
        } else {
            onMirror?.(repos.map(r => r.full_name), targetOrg)
        }
    }

	    return (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl dark:shadow-slate-900/50 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white/20 rounded-lg">
                                {action === 'transfer' ? (
                                    <ArrowRightLeft className="w-6 h-6" />
                                ) : (
                                    <Copy className="w-6 h-6" />
                                )}
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">
                                    {action === 'transfer' ? 'Transfer Repositories' : 'Mirror Repositories'}
                                </h2>
                                <p className="text-white/80 text-sm">
                                    {repos.length} repo{repos.length !== 1 ? 's' : ''} selected
                                </p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Action Toggle */}
                    <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                        <button
                            onClick={() => setAction('transfer')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                                action === 'transfer'
                                    ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                        >
                            <ArrowRightLeft className="w-4 h-4" />
                            Transfer (Move)
                        </button>
                        <button
                            onClick={() => setAction('mirror')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                                action === 'mirror'
                                    ? 'bg-white dark:bg-slate-600 text-purple-600 dark:text-purple-400 shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                        >
                            <Copy className="w-4 h-4" />
                            Mirror (Fork)
                        </button>
                    </div>

                    {/* Info Box */}
                    <div className={`p-4 rounded-lg border ${
                        action === 'transfer'
                            ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                            : 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
                    }`}>
                        <div className="flex gap-3">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div className="text-sm">
                                {action === 'transfer' ? (
                                    <>
                                        <strong>Transfer</strong> will move repositories to the target organization.
                                        The original URLs will redirect automatically.
                                    </>
                                ) : (
                                    <>
                                        <strong>Mirror</strong> creates independent copies (forks) in the target
                                        organization. Original repos remain unchanged.
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Target Organization */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Target Organization
                        </label>
                        {orgs.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                                {orgs.map(org => (
                                    <button
                                        key={org.login}
                                        onClick={() => setTargetOrg(org.login)}
                                        className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                                            targetOrg === org.login
                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                                                : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                                        }`}
                                    >
                                        <img
                                            src={org.avatar_url}
                                            alt={org.login}
                                            className="w-8 h-8 rounded-lg"
                                        />
                                        <div className="text-left">
                                            <div className="font-medium text-slate-900 dark:text-slate-100">{org.login}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                                {org.public_repos || 0} repos
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-lg">
                                <Building2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-500 dark:text-slate-400 mb-3">No organizations found</p>
                                <a
                                    href="https://github.com/organizations/plan"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium text-sm"
                                >
                                    Create an organization on GitHub →
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Repository Preview */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Repositories to {action === 'transfer' ? 'Transfer' : 'Mirror'}
                        </label>
                        <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
                            {repos.map(repo => (
                                <div key={repo.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <GitFork className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{repo.name}</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{repo.full_name}</div>
                                    </div>
                                    {targetOrg && (
                                        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                                            <ArrowRight className="w-4 h-4" />
                                            <span className="text-indigo-600 dark:text-indigo-400 font-medium">{targetOrg}/{repo.name}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Progress */}
                    {progress && (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            status={progress.status}
                            message={progress.message}
                            results={progress.results}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        {repos.length} repo{repos.length !== 1 ? 's' : ''} will be {action === 'transfer' ? 'transferred' : 'mirrored'}
                    </span>
                    <div className="flex gap-3">
                        <Button variant="ghost" onClick={onClose} disabled={isPerforming}>
                            Cancel
                        </Button>
                        <Button
                            variant={action === 'transfer' ? 'primary' : 'secondary'}
                            onClick={handleSubmit}
                            disabled={!targetOrg || isPerforming}
                        >
                            {isPerforming ? 'Processing...' : (action === 'transfer' ? 'Transfer' : 'Mirror')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

