import { useState, useEffect, useCallback } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import {
    GitBranch, Globe, Cloud, CheckCircle2, XCircle, Loader2,
    ArrowRight, ArrowLeft, ExternalLink, Lock, Unlock, Link2,
    KeyRound, User, AlertTriangle, Download
} from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const SOURCE_TYPES = [
    { value: 'url', label: 'Git URL', icon: Globe, desc: 'Any public or private Git repository' },
    { value: 'azure', label: 'Azure DevOps', icon: Cloud, desc: 'Import from Azure DevOps with PAT' },
    { value: 'github', label: 'GitHub', icon: GitBranch, desc: 'Clone/mirror between GitHub orgs' }
]

const STEPS_URL = ['source-type', 'url-input', 'target', 'review', 'progress']
const STEPS_AZURE = ['source-type', 'azure-creds', 'azure-source', 'target', 'review', 'progress']
const STEPS_GITHUB = ['source-type', 'github-source', 'target', 'review', 'progress']

function getSteps(sourceType) {
    switch (sourceType) {
        case 'azure': return STEPS_AZURE
        case 'github': return STEPS_GITHUB
        default: return STEPS_URL
    }
}

export function ImportWizard({ isOpen, onClose, orgs }) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [step, setStep] = useState(0)
    const [sourceType, setSourceType] = useState('')

    // URL source state
    const [sourceUrl, setSourceUrl] = useState('')
    const [urlValidation, setUrlValidation] = useState(null) // null | 'validating' | 'valid' | 'invalid'
    const [urlError, setUrlError] = useState('')
    const [authType, setAuthType] = useState('none') // none | token | basic
    const [authToken, setAuthToken] = useState('')
    const [authUsername, setAuthUsername] = useState('')
    const [authPassword, setAuthPassword] = useState('')

    // Azure source state
    const [azureOrg, setAzureOrg] = useState('')
    const [azurePat, setAzurePat] = useState('')
    const [patStatus, setPatStatus] = useState(null)
    const [patError, setPatError] = useState('')
    const [projects, setProjects] = useState([])
    const [selectedProject, setSelectedProject] = useState('')
    const [repos, setRepos] = useState([])
    const [selectedRepo, setSelectedRepo] = useState('')
    const [loadingProjects, setLoadingProjects] = useState(false)
    const [loadingRepos, setLoadingRepos] = useState(false)

    // GitHub source state
    const [githubSourceUrl, setGithubSourceUrl] = useState('')

    // Target state
    const [targetOrg, setTargetOrg] = useState('')
    const [targetName, setTargetName] = useState('')
    const [makePrivate, setMakePrivate] = useState(true)
    const [description, setDescription] = useState('')

    // Import state
    const [jobId, setJobId] = useState(null)
    const [jobStatus, setJobStatus] = useState(null)
    const [importing, setImporting] = useState(false)

    // Git availability
    const [gitAvailable, setGitAvailable] = useState(null)

    // Check git on open
    useEffect(() => {
        if (isOpen && gitAvailable === null) {
            fetch('/api/import/git-status', { credentials: 'include' })
                .then(r => r.json())
                .then(data => setGitAvailable(data.installed))
                .catch(() => setGitAvailable(false))
        }
    }, [isOpen, gitAvailable])

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setStep(0)
            setSourceType('')
            setSourceUrl('')
            setUrlValidation(null)
            setUrlError('')
            setAuthType('none')
            setAuthToken('')
            setAuthUsername('')
            setAuthPassword('')
            setAzureOrg('')
            setAzurePat('')
            setPatStatus(null)
            setPatError('')
            setProjects([])
            setSelectedProject('')
            setRepos([])
            setSelectedRepo('')
            setGithubSourceUrl('')
            setTargetOrg('')
            setTargetName('')
            setMakePrivate(true)
            setDescription('')
            setJobId(null)
            setJobStatus(null)
            setImporting(false)
        }
    }, [isOpen])

    // Fetch Azure projects
    const fetchProjects = useCallback(async () => {
        if (!azureOrg || !azurePat) return
        setLoadingProjects(true)
        try {
            const res = await fetch('/api/azure/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ org: azureOrg, pat: azurePat }) })
            if (res.status === 401) return
            const data = await res.json()
            if (res.ok) setProjects(data.projects || [])
        } catch { /* ignore */ } finally {
            setLoadingProjects(false)
        }
    }, [azureOrg, azurePat])

    // Fetch Azure repos when project selected
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
                if (res.ok) setRepos(data.repos || [])
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
                if (res.status === 401) {
                    clearInterval(interval)
                    setImporting(false)
                    return
                }
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

    const validateUrl = async () => {
        setUrlValidation('validating')
        setUrlError('')
        try {
            const credentials = buildCredentials()
            const res = await fetch('/api/import/validate-url', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: sourceUrl, credentials })
            })
            const data = await res.json()
            if (data.valid) {
                setUrlValidation('valid')
                // Auto-fill target name from URL
                if (!targetName) {
                    const parts = sourceUrl.replace(/\.git$/, '').split('/')
                    setTargetName(parts[parts.length - 1] || '')
                }
            } else {
                setUrlValidation('invalid')
                setUrlError(data.error || 'Cannot access repository')
            }
        } catch (e) {
            setUrlValidation('invalid')
            setUrlError(e.message)
        }
    }

    const validateAzurePat = async () => {
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

    function buildCredentials() {
        if (authType === 'token') return { type: 'token', token: authToken }
        if (authType === 'basic') return { type: 'basic', username: authUsername, password: authPassword }
        return undefined
    }

    function getSourceDisplayName() {
        if (sourceType === 'azure') return `${azureOrg}/${selectedProject}/${selectedRepo}`
        if (sourceType === 'github') return githubSourceUrl.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
        return sourceUrl
    }

    function getEffectiveSourceUrl() {
        if (sourceType === 'azure') {
            const repo = repos.find(r => r.name === selectedRepo)
            return repo?.remoteUrl || ''
        }
        if (sourceType === 'github') return githubSourceUrl
        return sourceUrl
    }

    const startImport = async () => {
        setImporting(true)
        const steps = getSteps(sourceType)
        setStep(steps.length - 1) // Go to progress step

        try {
            let endpoint, body

            if (sourceType === 'azure') {
                endpoint = '/api/import/azure'
                body = {
                    azureOrg,
                    azureProject: selectedProject,
                    azureRepo: selectedRepo,
                    azurePat,
                    targetOrg: targetOrg || undefined,
                    targetName: targetName || selectedRepo,
                    makePrivate,
                    description
                }
            } else {
                endpoint = '/api/import/url'
                const effectiveUrl = getEffectiveSourceUrl()
                body = {
                    sourceUrl: effectiveUrl,
                    credentials: sourceType === 'url' ? buildCredentials() : undefined,
                    targetOrg: targetOrg || undefined,
                    targetName: targetName || effectiveUrl.replace(/\.git$/, '').split('/').pop(),
                    makePrivate,
                    description
                }
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
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

    const steps = getSteps(sourceType)
    const currentStep = steps[step]
    const selectedRepoObj = repos.find(r => r.name === selectedRepo)

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <Card ref={modalRef} className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="import-wizard-title">
                <div className="flex items-center justify-between mb-4">
                    <h2 id="import-wizard-title" className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <Download className="w-6 h-6 text-indigo-500" />
                        Import Repository
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl leading-none">&times;</button>
                </div>

                {/* Git not available warning */}
                {gitAvailable === false && (
                    <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Git is not installed on the server. Import functionality requires Git to be available in PATH.
                        </p>
                    </div>
                )}

                {/* Step indicator */}
                {sourceType && (
                    <div className="flex items-center gap-1 mb-6">
                        {steps.map((s, i) => (
                            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                        ))}
                    </div>
                )}

                {/* Step 1: Source Type */}
                {currentStep === 'source-type' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Choose the source of the repository you want to import.</p>
                        <div className="space-y-2">
                            {SOURCE_TYPES.map(st => {
                                const Icon = st.icon
                                return (
                                    <button
                                        key={st.value}
                                        onClick={() => { setSourceType(st.value); setStep(1) }}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                                            ${sourceType === st.value
                                                ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                                            }`}
                                    >
                                        <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{st.label}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{st.desc}</div>
                                        </div>
                                        <ArrowRight className="w-4 h-4 ml-auto text-slate-400" />
                                    </button>
                                )
                            })}
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
                        </div>
                    </div>
                )}

                {/* URL Input Step */}
                {currentStep === 'url-input' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Enter the Git clone URL of the repository.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository URL *</label>
                            <div className="relative">
                                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input type="url" value={sourceUrl} onChange={e => { setSourceUrl(e.target.value); setUrlValidation(null) }}
                                    placeholder="https://github.com/user/repo.git"
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            </div>
                        </div>

                        {/* Auth type selector */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Authentication</label>
                            <div className="flex gap-2">
                                {[
                                    { value: 'none', label: 'None (Public)' },
                                    { value: 'token', label: 'Token/PAT' },
                                    { value: 'basic', label: 'Username/Password' }
                                ].map(a => (
                                    <button key={a.value} onClick={() => setAuthType(a.value)}
                                        className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-lg border transition-colors
                                            ${authType === a.value
                                                ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                            }`}>
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {authType === 'token' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Access Token</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)}
                                        placeholder="ghp_... or PAT"
                                        className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                                </div>
                            </div>
                        )}

                        {authType === 'basic' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input type="text" value={authUsername} onChange={e => setAuthUsername(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                                    <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                                </div>
                            </div>
                        )}

                        {urlValidation === 'valid' && (
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Repository accessible</div>
                        )}
                        {urlValidation === 'invalid' && (
                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"><XCircle className="w-4 h-4" /> {urlError}</div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => { setStep(0); setSourceType('') }} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            {urlValidation !== 'valid' ? (
                                <Button onClick={validateUrl} disabled={!sourceUrl || urlValidation === 'validating'} className="flex-1">
                                    {urlValidation === 'validating' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking...</> : 'Validate URL'}
                                </Button>
                            ) : (
                                <Button onClick={() => setStep(2)} className="flex-1">
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Azure Credentials Step */}
                {currentStep === 'azure-creds' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Enter your Azure DevOps organization and PAT.</p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Organization *</label>
                            <input type="text" value={azureOrg} onChange={e => { setAzureOrg(e.target.value); setPatStatus(null) }}
                                placeholder="e.g., mycompany"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Personal Access Token *</label>
                            <input type="password" value={azurePat} onChange={e => { setAzurePat(e.target.value); setPatStatus(null) }}
                                placeholder="Azure DevOps PAT with Code (Read) scope"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
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
                            <Button variant="secondary" onClick={() => { setStep(0); setSourceType('') }} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            {patStatus !== 'valid' ? (
                                <Button onClick={validateAzurePat} disabled={!azureOrg || !azurePat || patStatus === 'validating'} className="flex-1">
                                    {patStatus === 'validating' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Validating...</> : 'Validate'}
                                </Button>
                            ) : (
                                <Button onClick={() => setStep(2)} className="flex-1">
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Azure Source Step */}
                {currentStep === 'azure-source' && (
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
                                    <Select value={selectedRepo} onChange={val => { setSelectedRepo(val); if (!targetName) setTargetName(val) }}
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
                            <Button variant="secondary" onClick={() => setStep(1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => setStep(3)} disabled={!selectedProject || !selectedRepo} className="flex-1">Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
                        </div>
                    </div>
                )}

                {/* GitHub Source Step */}
                {currentStep === 'github-source' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Enter the GitHub repository URL to clone/mirror to your account.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Source Repository URL *</label>
                            <div className="relative">
                                <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input type="url" value={githubSourceUrl} onChange={e => setGithubSourceUrl(e.target.value)}
                                    placeholder="https://github.com/owner/repo"
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Public repos can be cloned directly. Your GitHub OAuth token will be used for push.
                            </p>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => { setStep(0); setSourceType('') }} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => {
                                if (!targetName) {
                                    const parts = githubSourceUrl.replace(/\.git$/, '').split('/')
                                    setTargetName(parts[parts.length - 1] || '')
                                }
                                setStep(2)
                            }} disabled={!githubSourceUrl} className="flex-1">
                                Next <ArrowRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Target Configuration */}
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
                                placeholder="my-imported-repo"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description (optional)</label>
                            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                                placeholder="Imported repository"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={makePrivate} onChange={e => setMakePrivate(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                {makePrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                Make repository {makePrivate ? 'private' : 'public'}
                            </span>
                        </label>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setStep(step - 1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => setStep(step + 1)} disabled={!targetName} className="flex-1">Review <ArrowRight className="w-4 h-4 ml-1" /></Button>
                        </div>
                    </div>
                )}

                {/* Review Step */}
                {currentStep === 'review' && (
                    <div className="space-y-4">
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                                <strong>Note:</strong> This imports Git code and history only. Issues, PRs, Wikis, and CI/CD pipelines are not migrated.
                            </p>
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Source Type</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100 capitalize">{sourceType}</span>
                            </div>
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Source</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100 text-right max-w-[250px] truncate">{getSourceDisplayName()}</span>
                            </div>
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Target</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100">{targetOrg || 'personal'}/{targetName}</span>
                            </div>
                            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                                <span className="text-slate-500 dark:text-slate-400">Visibility</span>
                                <span className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1">
                                    {makePrivate ? <><Lock className="w-3 h-3" /> Private</> : <><Unlock className="w-3 h-3" /> Public</>}
                                </span>
                            </div>
                            {description && (
                                <div className="flex justify-between py-1.5">
                                    <span className="text-slate-500 dark:text-slate-400">Description</span>
                                    <span className="font-medium text-slate-900 dark:text-slate-100 text-right max-w-[250px] truncate">{description}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setStep(step - 1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={startImport} disabled={importing || gitAvailable === false} className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500">
                                {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Start Import'}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Progress Step */}
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
                                        className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline text-sm">
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
                                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-3" />
                                <h3 className="font-bold text-center text-slate-900 dark:text-slate-100 mb-2">Importing...</h3>
                                <p className="text-sm text-center text-slate-600 dark:text-slate-400 mb-4">{jobStatus?.progressMessage || 'Starting import...'}</p>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500"
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
                                <Button onClick={() => { setStep(steps.indexOf('review')); setJobId(null); setJobStatus(null) }} className="flex-1">
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
