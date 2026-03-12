import { useState, useEffect, useCallback } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Cloud, CheckCircle2, XCircle, Loader2, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const STEPS = ['credentials', 'source', 'target', 'review', 'progress']

export function AzureImportModal({ isOpen, onClose, orgs }) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [step, setStep] = useState(0)
    const [azureOrg, setAzureOrg] = useState('')
    const [azurePat, setAzurePat] = useState('')
    const [patStatus, setPatStatus] = useState(null) // null | 'validating' | 'valid' | 'invalid'
    const [patError, setPatError] = useState('')

    const [projects, setProjects] = useState([])
    const [selectedProject, setSelectedProject] = useState('')
    const [repos, setRepos] = useState([])
    const [selectedRepo, setSelectedRepo] = useState('')
    const [loadingProjects, setLoadingProjects] = useState(false)
    const [loadingRepos, setLoadingRepos] = useState(false)

    const [targetOrg, setTargetOrg] = useState('')
    const [targetName, setTargetName] = useState('')
    const [makePrivate, setMakePrivate] = useState(true)

    const [jobId, setJobId] = useState(null)
    const [jobStatus, setJobStatus] = useState(null)
    const [importing, setImporting] = useState(false)

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setStep(0)
            setPatStatus(null)
            setPatError('')
            setProjects([])
            setSelectedProject('')
            setRepos([])
            setSelectedRepo('')
            setJobId(null)
            setJobStatus(null)
            setImporting(false)
        }
    }, [isOpen])

    // Fetch projects when PAT is validated
    const fetchProjects = useCallback(async () => {
        if (!azureOrg || !azurePat) return
        setLoadingProjects(true)
        try {
            const res = await fetch('/api/azure/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ org: azureOrg, pat: azurePat }) })
            if (res.status === 401) return
            const data = await res.json()
            if (res.ok) {
                setProjects(data.projects || [])
            }
        } catch { /* ignore */ } finally {
            setLoadingProjects(false)
        }
    }, [azureOrg, azurePat])

    // Fetch repos when project selected
    useEffect(() => {
        if (!selectedProject || !azureOrg || !azurePat) {
            setRepos([])
            setSelectedRepo('')
            return
        }
        const fetchRepos = async () => {
            setLoadingRepos(true)
            try {
                const res = await fetch('/api/azure/repos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ org: azureOrg, project: selectedProject, pat: azurePat }) })
                if (res.status === 401) return
                const data = await res.json()
                if (res.ok) {
                    setRepos(data.repos || [])
                }
            } catch { /* ignore */ } finally {
                setLoadingRepos(false)
            }
        }
        fetchRepos()
    }, [selectedProject, azureOrg, azurePat])

    // Poll job status
    useEffect(() => {
        if (!jobId) return
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/import/status/${jobId}`, { credentials: 'include' })
                const data = await res.json()
                setJobStatus(data)
                if (data.status === 'complete' || data.status === 'failed') {
                    clearInterval(interval)
                    setImporting(false)
                }
            } catch { /* ignore */ }
        }, 2000)
        return () => clearInterval(interval)
    }, [jobId])

    const validatePat = async () => {
        setPatStatus('validating')
        setPatError('')
        try {
            const res = await fetch('/api/azure/validate', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org: azureOrg, pat: azurePat })
            })
            const data = await res.json()
            if (data.valid) {
                setPatStatus('valid')
                fetchProjects()
            } else {
                setPatStatus('invalid')
                setPatError(data.error || 'Invalid credentials')
            }
        } catch (e) {
            setPatStatus('invalid')
            setPatError(e.message)
        }
    }

    const startImport = async () => {
        setImporting(true)
        setStep(4) // progress step

        try {
            const res = await fetch('/api/import/azure', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    azureOrg,
                    azureProject: selectedProject,
                    azureRepo: selectedRepo,
                    azurePat,
                    targetOrg: targetOrg || undefined,
                    targetName: targetName || selectedRepo,
                    makePrivate
                })
            })
            const data = await res.json()
            if (data.success) {
                setJobId(data.jobId)
            } else {
                setJobStatus({ status: 'failed', errorMessage: data.error, progressPct: 0 })
                setImporting(false)
            }
        } catch (e) {
            setJobStatus({ status: 'failed', errorMessage: e.message, progressPct: 0 })
            setImporting(false)
        }
    }

    if (!isOpen) return null

    const currentStep = STEPS[step]
    const selectedRepoObj = repos.find(r => r.name === selectedRepo)

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <Card ref={modalRef} className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="azure-import-title">
                <div className="flex items-center justify-between mb-4">
                    <h2 id="azure-import-title" className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <Cloud className="w-6 h-6 text-blue-500" />
                        Import from Azure DevOps
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl leading-none">&times;</button>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-1 mb-6">
                    {STEPS.map((s, i) => (
                        <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-blue-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                    ))}
                </div>

                {/* Step 1: Credentials */}
                {currentStep === 'credentials' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Enter your Azure DevOps organization and PAT to get started.</p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Organization *</label>
                            <input type="text" value={azureOrg} onChange={e => { setAzureOrg(e.target.value); setPatStatus(null) }}
                                placeholder="e.g., mycompany"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Personal Access Token *</label>
                            <input type="password" value={azurePat} onChange={e => { setAzurePat(e.target.value); setPatStatus(null) }}
                                placeholder="Azure DevOps PAT with Code (Read) scope"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Create at: dev.azure.com/{azureOrg || '{org}'}/_usersSettings/tokens
                            </p>
                        </div>

                        {patStatus === 'valid' && (
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected successfully</div>
                        )}
                        {patStatus === 'invalid' && (
                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"><XCircle className="w-4 h-4" /> {patError}</div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
                            {patStatus !== 'valid' ? (
                                <Button onClick={validatePat} disabled={!azureOrg || !azurePat || patStatus === 'validating'} className="flex-1">
                                    {patStatus === 'validating' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Validating...</> : 'Validate'}
                                </Button>
                            ) : (
                                <Button onClick={() => setStep(1)} className="flex-1">
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Select source repo */}
                {currentStep === 'source' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Select the project and repository to import.</p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Project *</label>
                            {loadingProjects ? (
                                <div className="flex items-center gap-2 text-slate-500 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading projects...</div>
                            ) : (
                                <Select value={selectedProject} onChange={setSelectedProject}
                                    options={[{ value: '', label: 'Select a project...' }, ...projects.map(p => ({ value: p.name, label: p.name }))]} />
                            )}
                        </div>
                        {selectedProject && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository *</label>
                                {loadingRepos ? (
                                    <div className="flex items-center gap-2 text-slate-500 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading repos...</div>
                                ) : repos.length === 0 ? (
                                    <p className="text-sm text-slate-500 dark:text-slate-400 py-2">No repositories found in this project.</p>
                                ) : (
                                    <Select value={selectedRepo} onChange={setSelectedRepo}
                                        options={[{ value: '', label: 'Select a repository...' }, ...repos.map(r => ({ value: r.name, label: `${r.name}${r.isDisabled ? ' (disabled)' : ''}` }))]} />
                                )}
                                {selectedRepoObj && (
                                    <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs text-slate-600 dark:text-slate-400">
                                        Size: {(selectedRepoObj.size / 1024).toFixed(1)} MB
                                        {selectedRepoObj.defaultBranch && ` · Default: ${selectedRepoObj.defaultBranch.replace('refs/heads/', '')}`}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setStep(0)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => setStep(2)} disabled={!selectedProject || !selectedRepo} className="flex-1">Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Target config */}
                {currentStep === 'target' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Configure the target GitHub repository.</p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">GitHub Owner</label>
                            <Select value={targetOrg} onChange={setTargetOrg}
                                options={[{ value: '', label: 'My personal account' }, ...(orgs?.map(o => ({ value: o.login, label: o.login })) || [])]} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository Name</label>
                            <input type="text" value={targetName} onChange={e => setTargetName(e.target.value)}
                                placeholder={selectedRepo || 'Same as source'}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={makePrivate} onChange={e => setMakePrivate(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Make repository private</span>
                        </label>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setStep(1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => setStep(3)} className="flex-1">Review <ArrowRight className="w-4 h-4 ml-1" /></Button>
                        </div>
                    </div>
                )}

                {/* Step 4: Review */}
                {currentStep === 'review' && (
                    <div className="space-y-4">
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                                <strong>Note:</strong> This imports Git code and history only. PRs, Work Items, and Pipelines are not migrated.
                            </p>
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Source</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100">{azureOrg}/{selectedProject}/{selectedRepo}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Target</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100">{targetOrg || 'personal'}/{targetName || selectedRepo}</span>
                            </div>
                            <div className="flex justify-between py-1">
                                <span className="text-slate-500 dark:text-slate-400">Visibility</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100">{makePrivate ? 'Private' : 'Public'}</span>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setStep(2)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={startImport} disabled={importing} className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500">
                                {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Start Import'}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 5: Progress */}
                {currentStep === 'progress' && (
                    <div className="space-y-4">
                        {jobStatus?.status === 'complete' ? (
                            <div className="text-center py-4">
                                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-2">Import Complete!</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    Repository imported to <strong>{jobStatus.targetFullName}</strong>
                                    {jobStatus.metadata?.branchCount && ` with ${jobStatus.metadata.branchCount} branch(es)`}
                                </p>
                                {jobStatus.metadata?.repoUrl && (
                                    <a href={jobStatus.metadata.repoUrl} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-sm">
                                        View on GitHub <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                        ) : jobStatus?.status === 'failed' ? (
                            <div className="text-center py-4">
                                <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                                <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-2">Import Failed</h3>
                                <p className="text-sm text-red-600 dark:text-red-400 mb-4">{jobStatus.errorMessage}</p>
                            </div>
                        ) : (
                            <div className="py-4">
                                <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
                                <h3 className="font-bold text-center text-slate-900 dark:text-slate-100 mb-2">Importing...</h3>
                                <p className="text-sm text-center text-slate-600 dark:text-slate-400 mb-4">{jobStatus?.progressMessage || 'Starting import...'}</p>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${jobStatus?.progressPct || 0}%` }} />
                                </div>
                                <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-1">{jobStatus?.progressPct || 0}%</p>
                            </div>
                        )}
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={onClose} className="flex-1">
                                {jobStatus?.status === 'complete' || jobStatus?.status === 'failed' ? 'Close' : 'Run in Background'}
                            </Button>
                            {jobStatus?.status === 'failed' && (
                                <Button onClick={() => { setStep(3); setJobId(null); setJobStatus(null) }} className="flex-1">
                                    <ArrowLeft className="w-4 h-4 mr-1" /> Retry
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </Card>
        </div>
    )
}
