import { useReducer, useEffect, useRef, useCallback } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import {
    GitBranch, Globe, Cloud, CheckCircle2, XCircle, Loader2,
    ArrowRight, ArrowLeft, ExternalLink, Lock, Unlock, Link2,
    KeyRound, User, AlertTriangle, Download, Eye, EyeOff, Info,
    Search, Check, Clock, FolderGit2
} from 'lucide-react'
import { parseAzureUrl } from '../utils/azureUrlParser'
import { useFocusTrap } from '../hooks/useFocusTrap'

const SOURCE_TYPES = [
    { value: 'url', label: 'Git URL', icon: Globe, desc: 'Any public or private Git repository' },
    { value: 'azure', label: 'Azure DevOps', icon: Cloud, desc: 'Import from Azure DevOps with PAT' },
    { value: 'github', label: 'GitHub', icon: GitBranch, desc: 'Clone/mirror between GitHub orgs' }
]

const STEPS_URL = ['source-type', 'url-input', 'target', 'review', 'progress']
const STEPS_AZURE = ['source-type', 'azure-smart', 'azure-repo', 'azure-confirm', 'progress']
const STEPS_GITHUB = ['source-type', 'github-source', 'target', 'review', 'progress']

function getSteps(sourceType) {
    switch (sourceType) {
        case 'azure': return STEPS_AZURE
        case 'github': return STEPS_GITHUB
        default: return STEPS_URL
    }
}

const INITIAL_STATE = {
    step: 0,
    sourceType: '',
    // URL source state
    sourceUrl: '',
    urlValidation: null, // null | 'validating' | 'valid' | 'invalid'
    urlError: '',
    authType: 'none', // none | token | basic
    authToken: '',
    authUsername: '',
    authPassword: '',
    // Azure smart import state
    azureUrl: '',
    azureParsed: { org: null, project: null, repo: null, error: null, suggestion: null },
    azureOrg: '',
    azurePat: '',
    patStatus: null, // null | 'validating' | 'valid' | 'invalid'
    patError: '',
    envAuthAvailable: null, // null | true | false
    showManualPat: false,
    showPatText: false,
    selectedProject: '',
    repos: [],
    selectedRepos: {}, // { [repoName]: targetName } for multi-select
    repoSearch: '',
    duplicates: {}, // { [targetName]: boolean } — true if exists on GitHub
    checkingDuplicates: false,
    loadingRepos: false,
    validating: false,
    // TFVC state
    versionControlType: null, // 'Git' | 'Tfvc' | null
    tfvcItems: [],
    loadingTfvcItems: false,
    // GitHub source state
    githubSourceUrl: '',
    // Target state
    targetOrg: '',
    targetName: '',
    makePrivate: true,
    description: '',
    // Import state — single
    jobId: null,
    jobStatus: null,
    importing: false,
    // Import state — batch
    batchJobs: [], // [{ repoName, targetName, jobId, skipped, error }]
    batchStatuses: {}, // { [jobId]: statusObj }
    // Git availability
    gitAvailable: null,
}

function wizardReducer(state, action) {
    switch (action.type) {
        case 'RESET':
            return { ...INITIAL_STATE, gitAvailable: state.gitAvailable }
        case 'SET_FIELD':
            return { ...state, [action.field]: action.value }
        case 'SET_FIELDS':
            return { ...state, ...action.fields }
        case 'PARSE_AZURE_URL':
            return {
                ...state,
                azureParsed: action.parsed,
                ...(action.parsed.org ? { azureOrg: action.parsed.org } : {}),
                ...(action.parsed.project ? { selectedProject: action.parsed.project } : {}),
            }
        case 'TOGGLE_REPO': {
            const next = { ...state.selectedRepos }
            if (next[action.repoName] !== undefined) {
                delete next[action.repoName]
            } else {
                next[action.repoName] = action.repoName
            }
            return { ...state, selectedRepos: next }
        }
        case 'SELECT_ALL_REPOS': {
            const next = {}
            action.repos.forEach(r => { next[r.name] = r.name })
            return { ...state, selectedRepos: next }
        }
        case 'DESELECT_ALL_REPOS':
            return { ...state, selectedRepos: {} }
        case 'SET_REPO_TARGET': {
            return { ...state, selectedRepos: { ...state.selectedRepos, [action.repoName]: action.targetName } }
        }
        case 'UPDATE_BATCH_STATUSES': {
            const merged = { ...state.batchStatuses, ...action.updates }
            const allDone = state.batchJobs.length > 0 && state.batchJobs.every(j => {
                if (j.skipped || !j.jobId) return true
                const s = merged[j.jobId]
                return s?.status === 'complete' || s?.status === 'failed'
            })
            return { ...state, batchStatuses: merged, ...(allDone ? { importing: false } : {}) }
        }
        default:
            return state
    }
}

export function ImportWizard({ isOpen, onClose, orgs }) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE)

    const set = (field, value) => dispatch({ type: 'SET_FIELD', field, value })
    const setFields = (fields) => dispatch({ type: 'SET_FIELDS', fields })
    const pendingAutoConnect = useRef(false)

    const {
        step, sourceType,
        sourceUrl, urlValidation, urlError,
        authType, authToken, authUsername, authPassword,
        azureUrl, azureParsed, azureOrg, azurePat,
        patStatus, patError, envAuthAvailable, showManualPat, showPatText,
        selectedProject, repos, selectedRepos, repoSearch, duplicates, checkingDuplicates,
        loadingRepos, validating,
        versionControlType, tfvcItems, loadingTfvcItems,
        githubSourceUrl,
        targetOrg, targetName, makePrivate, description,
        jobId, jobStatus, importing,
        batchJobs, batchStatuses,
        gitAvailable,
    } = state

    // Derived batch helpers
    const selectedRepoNames = Object.keys(selectedRepos)
    const selectedCount = selectedRepoNames.length
    const isBatch = selectedCount > 1

    // Check git on open
    useEffect(() => {
        if (isOpen && gitAvailable === null) {
            fetch('/api/import/git-status', { credentials: 'include' })
                .then(r => r.json())
                .then(data => set('gitAvailable', data.installed))
                .catch(() => set('gitAvailable', false))
        }
    }, [isOpen, gitAvailable])

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            dispatch({ type: 'RESET' })
        }
    }, [isOpen])

    // Check if server has AZURE_PAT configured
    useEffect(() => {
        if (isOpen && envAuthAvailable === null) {
            fetch('/api/azure/env-auth', { credentials: 'include' })
                .then(r => r.json())
                .then(data => set('envAuthAvailable', data.available))
                .catch(() => set('envAuthAvailable', false))
        }
    }, [isOpen, envAuthAvailable])

    // Auto-detect Azure DevOps URLs pasted in the generic URL field
    useEffect(() => {
        if (sourceType !== 'url' || !sourceUrl) return
        const parsed = parseAzureUrl(sourceUrl)
        if (parsed.org && !parsed.error) {
            // It's a valid Azure URL — switch to Azure flow with URL pre-filled
            pendingAutoConnect.current = true
            const stps = getSteps('azure')
            dispatch({ type: 'SET_FIELDS', fields: {
                sourceType: 'azure',
                azureUrl: sourceUrl,
                sourceUrl: '',
                urlValidation: null,
                urlError: '',
                step: stps.indexOf('azure-smart'),
            }})
        }
    }, [sourceUrl, sourceType])

    // Parse Azure URL on change
    useEffect(() => {
        const parsed = parseAzureUrl(azureUrl)
        dispatch({ type: 'PARSE_AZURE_URL', parsed })
    }, [azureUrl])

    const connectAzure = async () => {
        const { org, project, repo } = azureParsed
        if (!org) return

        setFields({ validating: true, patStatus: 'validating', patError: '' })

        try {
            // Build PAT payload — omit if using env auth
            const patPayload = showManualPat || !envAuthAvailable ? azurePat : undefined

            // Validate PAT
            const valRes = await fetch('/api/azure/validate', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org, pat: patPayload })
            })
            const valData = await valRes.json()

            if (!valData.valid) {
                setFields({
                    patStatus: 'invalid',
                    patError: valData.error || 'Invalid credentials',
                    // If env auth failed, show manual PAT field
                    ...(envAuthAvailable && !showManualPat ? { showManualPat: true } : {}),
                    validating: false,
                })
                return
            }

            set('patStatus', 'valid')

            // If we have a specific repo from URL, skip to confirm
            if (repo) {
                const reposRes = await fetch('/api/azure/repos', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ org, project, pat: patPayload })
                })
                const reposData = await reposRes.json()
                if (reposRes.ok) {
                    const repoList = reposData.repos || []
                    const found = repoList.find(r => r.name.toLowerCase() === repo.toLowerCase())
                    const stps = getSteps('azure')
                    setFields({
                        repos: repoList,
                        ...(found ? { selectedRepos: { [found.name]: found.name } } : {}),
                        ...(found && !targetName ? { targetName: found.name } : {}),
                        validating: false,
                        step: stps.indexOf('azure-confirm'),
                    })
                } else {
                    const stps = getSteps('azure')
                    setFields({
                        validating: false,
                        step: stps.indexOf('azure-confirm'),
                    })
                }
                return
            }

            // Project-level: fetch repos
            set('loadingRepos', true)
            const reposRes = await fetch('/api/azure/repos', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org, project, pat: patPayload })
            })
            const reposData = await reposRes.json()
            if (reposRes.ok) {
                const repoList = reposData.repos || []

                // TFVC detection: if no Git repos and project uses TFVC, fetch TFVC items
                if (repoList.length === 0 && reposData.versionControlType === 'Tfvc') {
                    setFields({ versionControlType: 'Tfvc', loadingRepos: false, loadingTfvcItems: true, validating: false })
                    try {
                        const tfvcRes = await fetch('/api/azure/tfvc/items', {
                            method: 'POST', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ org, project, pat: patPayload })
                        })
                        const tfvcData = await tfvcRes.json()
                        const items = (tfvcData.items || []).filter(i => i.isFolder)
                        const stps = getSteps('azure')
                        setFields({
                            tfvcItems: items,
                            loadingTfvcItems: false,
                            step: stps.indexOf('azure-repo'),
                        })
                    } catch {
                        const stps = getSteps('azure')
                        setFields({ tfvcItems: [], loadingTfvcItems: false, step: stps.indexOf('azure-repo') })
                    }
                    return
                }

                // Auto-select if only 1 non-disabled repo
                if (repoList.length === 1 && !repoList[0].isDisabled) {
                    const stps = getSteps('azure')
                    setFields({
                        repos: repoList,
                        selectedRepos: { [repoList[0].name]: repoList[0].name },
                        ...(!targetName ? { targetName: repoList[0].name } : {}),
                        loadingRepos: false,
                        validating: false,
                        versionControlType: null,
                        step: stps.indexOf('azure-confirm'),
                    })
                    return
                }
                const stps = getSteps('azure')
                setFields({
                    repos: repoList,
                    loadingRepos: false,
                    validating: false,
                    versionControlType: null,
                    step: stps.indexOf('azure-repo'),
                })
            } else {
                const stps = getSteps('azure')
                setFields({
                    loadingRepos: false,
                    validating: false,
                    step: stps.indexOf('azure-repo'),
                })
            }
        } catch {
            setFields({
                patStatus: 'invalid',
                patError: 'Could not reach Azure DevOps. Check your connection.',
                validating: false,
            })
        }
    }

    // Auto-connect after Azure URL auto-detection when env auth is available
    useEffect(() => {
        if (!pendingAutoConnect.current) return
        if (sourceType !== 'azure' || !azureParsed.org) return
        // Wait for envAuthAvailable to resolve (null = still loading)
        if (envAuthAvailable === null) return
        pendingAutoConnect.current = false
        if (envAuthAvailable && !validating) {
            connectAzure()
        }
    }, [sourceType, azureParsed, envAuthAvailable, validating])

    // Poll job status
    useEffect(() => {
        if (!jobId) return
        const controller = new AbortController()
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/import/status/${jobId}`, {
                    credentials: 'include',
                    signal: controller.signal
                })
                if (controller.signal.aborted) return
                if (res.status === 401) {
                    clearInterval(interval)
                    set('importing', false)
                    return
                }
                const data = await res.json()
                if (controller.signal.aborted) return
                set('jobStatus', data)
                if (data.status === 'complete' || data.status === 'failed') {
                    clearInterval(interval)
                    set('importing', false)
                }
            } catch (e) {
                if (e.name === 'AbortError') return
                // ignore other errors
            }
        }, 2000)
        return () => {
            controller.abort()
            clearInterval(interval)
        }
    }, [jobId])

    // Poll batch job statuses
    useEffect(() => {
        const activeJobs = batchJobs.filter(j => j.jobId && !j.skipped)
        if (activeJobs.length === 0) return
        const controller = new AbortController()
        const completed = new Set()

        const interval = setInterval(async () => {
            const pending = activeJobs.filter(j => !completed.has(j.jobId))
            if (pending.length === 0) {
                clearInterval(interval)
                return
            }
            const updates = {}
            await Promise.all(pending.map(async (job) => {
                try {
                    const res = await fetch(`/api/import/status/${job.jobId}`, {
                        credentials: 'include', signal: controller.signal
                    })
                    if (res.ok) {
                        const data = await res.json()
                        updates[job.jobId] = data
                        if (data.status === 'complete' || data.status === 'failed') {
                            completed.add(job.jobId)
                        }
                    }
                } catch (e) { if (e.name === 'AbortError') return }
            }))
            if (!controller.signal.aborted && Object.keys(updates).length > 0) {
                dispatch({ type: 'UPDATE_BATCH_STATUSES', updates })
            }
        }, 2000)

        return () => { controller.abort(); clearInterval(interval) }
    }, [batchJobs.length]) // eslint-disable-line react-hooks/exhaustive-deps

    // Check duplicates when entering confirm step or org changes
    useEffect(() => {
        const stepName = getSteps(sourceType)[step]
        if (stepName !== 'azure-confirm' || selectedCount === 0 || !targetOrg) return
        const targetNames = selectedRepoNames.map(n => selectedRepos[n] || n)
        checkDuplicates(targetNames, targetOrg)
    }, [step, sourceType, targetOrg]) // eslint-disable-line react-hooks/exhaustive-deps

    const validateUrl = async () => {
        setFields({ urlValidation: 'validating', urlError: '' })
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
                setFields({
                    urlValidation: 'valid',
                    // Auto-fill target name from URL
                    ...(!targetName ? { targetName: sourceUrl.replace(/\.git$/, '').split('/').pop() || '' } : {}),
                })
            } else {
                setFields({
                    urlValidation: 'invalid',
                    urlError: data.error || 'Cannot access repository',
                })
            }
        } catch (e) {
            setFields({
                urlValidation: 'invalid',
                urlError: e.message,
            })
        }
    }

    function buildCredentials() {
        if (authType === 'token') return { type: 'token', token: authToken }
        if (authType === 'basic') return { type: 'basic', username: authUsername, password: authPassword }
        return undefined
    }

    function getSourceDisplayName() {
        if (sourceType === 'azure') {
            if (selectedCount > 1) return `${azureOrg}/${selectedProject} (${selectedCount} repos)`
            const name = selectedRepoNames[0] || ''
            return `${azureOrg}/${selectedProject}/${name}`
        }
        if (sourceType === 'github') return githubSourceUrl.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
        return sourceUrl
    }

    function getEffectiveSourceUrl() {
        if (sourceType === 'azure') {
            const name = selectedRepoNames[0]
            const repo = repos.find(r => r.name === name)
            return repo?.remoteUrl || ''
        }
        if (sourceType === 'github') return githubSourceUrl
        return sourceUrl
    }

    const startImport = async () => {
        const steps = getSteps(sourceType)
        setFields({ importing: true, step: steps.length - 1 })

        try {
            const patPayload = showManualPat || !envAuthAvailable ? azurePat : undefined

            // TFVC batch import
            if (sourceType === 'azure' && versionControlType === 'Tfvc' && isBatch) {
                const itemsList = selectedRepoNames.map(name => {
                    const item = tfvcItems.find(i => i.path.split('/').pop() === name)
                    return { tfvcPath: item?.path || `$/${selectedProject}/${name}`, targetName: selectedRepos[name] || name }
                })
                const res = await fetch('/api/import/azure-tfvc/batch', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        azureOrg, azureProject: selectedProject, azurePat: patPayload,
                        targetOrg: targetOrg || undefined, makePrivate, items: itemsList,
                    })
                })
                const data = await res.json()
                if (data.success) { set('batchJobs', data.jobs) }
                else { setFields({ jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 }, importing: false }) }
                return
            }

            // TFVC single import
            if (sourceType === 'azure' && versionControlType === 'Tfvc') {
                const name = selectedRepoNames[0]
                const item = tfvcItems.find(i => i.path.split('/').pop() === name)
                const res = await fetch('/api/import/azure-tfvc', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        azureOrg, azureProject: selectedProject,
                        tfvcPath: item?.path || `$/${selectedProject}/${name}`,
                        azurePat: patPayload,
                        targetOrg: targetOrg || undefined,
                        targetName: selectedRepos[name] || targetName || name,
                        makePrivate, description
                    })
                })
                const data = await res.json()
                if (data.success) { set('jobId', data.jobId) }
                else { setFields({ jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 }, importing: false }) }
                return
            }

            // Azure Git batch import (2+ repos selected)
            if (sourceType === 'azure' && isBatch) {
                const reposList = selectedRepoNames.map(name => ({
                    azureRepo: name,
                    targetName: selectedRepos[name] || name,
                }))
                const res = await fetch('/api/import/azure/batch', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        azureOrg,
                        azureProject: selectedProject,
                        azurePat: patPayload,
                        targetOrg: targetOrg || undefined,
                        makePrivate,
                        repos: reposList,
                    })
                })
                const data = await res.json()
                if (data.success) {
                    set('batchJobs', data.jobs)
                } else {
                    setFields({
                        jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
                        importing: false,
                    })
                }
                return
            }

            // Single import (Azure Git single, URL, or GitHub)
            let endpoint, body

            if (sourceType === 'azure') {
                const singleRepo = selectedRepoNames[0]
                endpoint = '/api/import/azure'
                body = {
                    azureOrg,
                    azureProject: selectedProject,
                    azureRepo: singleRepo,
                    azurePat: patPayload,
                    targetOrg: targetOrg || undefined,
                    targetName: selectedRepos[singleRepo] || targetName || singleRepo,
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
                set('jobId', data.jobId)
            } else {
                setFields({
                    jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
                    importing: false,
                })
            }
        } catch (e) {
            setFields({
                jobStatus: { status: 'failed', errorMessage: e.message, progressPct: 0 },
                importing: false,
            })
        }
    }

    // Check for duplicate repos on GitHub
    const checkDuplicates = useCallback(async (repoNames, owner) => {
        if (!owner || repoNames.length === 0) return
        set('checkingDuplicates', true)
        try {
            const res = await fetch('/api/import/check-duplicates', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: repoNames, targetOwner: owner })
            })
            const data = await res.json()
            if (data.duplicates) set('duplicates', data.duplicates)
        } catch { /* ignore */ }
        set('checkingDuplicates', false)
    }, [])

    if (!isOpen) return null

    const steps = getSteps(sourceType)
    const currentStep = steps[step]

    // Filtering & selection helpers for azure-repo step
    const selectableRepos = repos.filter(r => !r.isDisabled && r.size > 0)
    const filteredRepos = repos.filter(r =>
        !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase())
    )
    const allSelectableSelected = selectableRepos.length > 0 && selectableRepos.every(r => selectedRepos[r.name] !== undefined)
    const formatSize = (sizeKb) => {
        if (sizeKb === 0) return '0 MB'
        if (sizeKb < 1024) return `${sizeKb} KB`
        if (sizeKb < 1024 * 1024) return `${(sizeKb / 1024).toFixed(1)} MB`
        return `${(sizeKb / (1024 * 1024)).toFixed(1)} GB`
    }
    const totalSelectedSize = selectedRepoNames.reduce((sum, name) => {
        const r = repos.find(repo => repo.name === name)
        return sum + (r?.size || 0)
    }, 0)

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <Card ref={modalRef} className={`w-full p-6 max-h-[90vh] overflow-y-auto ${currentStep === 'azure-repo' ? 'max-w-xl' : 'max-w-lg'}`} role="dialog" aria-modal="true" aria-labelledby="import-wizard-title">
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
                                        onClick={() => setFields({ sourceType: st.value, step: 1 })}
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
                                <input type="url" value={sourceUrl} onChange={e => setFields({ sourceUrl: e.target.value, urlValidation: null })}
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
                                    <button key={a.value} onClick={() => set('authType', a.value)}
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
                                    <input type="password" value={authToken} onChange={e => set('authToken', e.target.value)}
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
                                        <input type="text" value={authUsername} onChange={e => set('authUsername', e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                                    <input type="password" value={authPassword} onChange={e => set('authPassword', e.target.value)}
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
                            <Button variant="secondary" onClick={() => setFields({ step: 0, sourceType: '' })} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            {urlValidation !== 'valid' ? (
                                <Button onClick={validateUrl} disabled={!sourceUrl || urlValidation === 'validating'} className="flex-1">
                                    {urlValidation === 'validating' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking...</> : 'Validate URL'}
                                </Button>
                            ) : (
                                <Button onClick={() => set('step', 2)} className="flex-1">
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Azure Smart URL Step */}
                {currentStep === 'azure-smart' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Paste any Azure DevOps URL — project page, repo, clone URL, or shorthand.</p>

                        {/* URL Input */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Azure DevOps URL *</label>
                            <div className="relative">
                                <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input type="text" value={azureUrl} onChange={e => set('azureUrl', e.target.value)}
                                    placeholder="https://dev.azure.com/org/project"
                                    className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
                            </div>
                        </div>

                        {/* Parse Feedback */}
                        {azureUrl && (
                            <div className="space-y-1 text-xs">
                                {azureParsed.org && (
                                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Organization: <strong>{azureParsed.org}</strong></span>
                                    </div>
                                )}
                                {azureParsed.project && (
                                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Project: <strong>{azureParsed.project}</strong></span>
                                    </div>
                                )}
                                {azureParsed.repo && (
                                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Repository: <strong>{azureParsed.repo}</strong></span>
                                    </div>
                                )}
                                {azureParsed.error && (
                                    <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                        <div>
                                            <span>{azureParsed.error}</span>
                                            {azureParsed.suggestion && <p className="text-slate-500 dark:text-slate-400 mt-0.5">{azureParsed.suggestion}</p>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* PAT Section */}
                        {azureParsed.org && !azureParsed.error && envAuthAvailable !== null && (
                            <>
                                {envAuthAvailable && !showManualPat ? (
                                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                        <KeyRound className="w-4 h-4 shrink-0" />
                                        <span>Authenticated via server configuration</span>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                            Personal Access Token *
                                        </label>
                                        <div className="relative">
                                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type={showPatText ? 'text' : 'password'}
                                                value={azurePat}
                                                onChange={e => setFields({ azurePat: e.target.value, patStatus: null })}
                                                placeholder="Paste your Personal Access Token"
                                                className="w-full pl-9 pr-10 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => set('showPatText', !showPatText)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                            >
                                                {showPatText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                            <span>Scope: Code (Read)</span>
                                            <a href={`https://dev.azure.com/${encodeURIComponent(azureParsed.org)}/_usersSettings/tokens`}
                                                target="_blank" rel="noopener noreferrer"
                                                className="text-indigo-500 hover:text-indigo-400 flex items-center gap-1">
                                                Create PAT <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Validation status */}
                        {patStatus === 'invalid' && (
                            <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
                                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <span>{patError}</span>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setFields({ step: 0, sourceType: '' })} className="flex-1">
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back
                            </Button>
                            <Button
                                onClick={connectAzure}
                                disabled={!azureParsed.org || !azureParsed.project || azureParsed.error !== null || validating || (!envAuthAvailable && !azurePat) || (showManualPat && !azurePat)}
                                className="flex-1"
                            >
                                {validating ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting...</> : <>Continue <ArrowRight className="w-4 h-4 ml-1" /></>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Azure Repo Selection — multi-select with rich cards */}
                {currentStep === 'azure-repo' && (
                    <div className="space-y-3">
                        {/* Source banner */}
                        <div className="p-3 bg-gradient-to-r from-indigo-950/80 to-indigo-900/30 rounded-xl border border-indigo-800/40">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-indigo-900/50 shrink-0">
                                    <Cloud className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-indigo-200 truncate">{azureParsed.org} / {selectedProject}</div>
                                    <div className="text-xs text-indigo-400/80 flex items-center gap-3 mt-0.5">
                                        {versionControlType === 'Tfvc' ? (
                                            <>
                                                <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3 h-3" /> TFVC</span>
                                                <span className="flex items-center gap-1"><FolderGit2 className="w-3 h-3" /> {tfvcItems.length} folders</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="flex items-center gap-1"><FolderGit2 className="w-3 h-3" /> {repos.length} repos</span>
                                                <span>{formatSize(repos.reduce((s, r) => s + (r.size || 0), 0))}</span>
                                            </>
                                        )}
                                        <span className="flex items-center gap-1"><KeyRound className="w-3 h-3" /> PAT</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {(loadingRepos || loadingTfvcItems) ? (
                            <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
                                <Loader2 className="w-4 h-4 animate-spin" /> {versionControlType === 'Tfvc' ? 'Loading TFVC items...' : 'Loading repositories...'}
                            </div>
                        ) : versionControlType === 'Tfvc' ? (
                            /* TFVC folder browser */
                            tfvcItems.length === 0 ? (
                                <div className="text-center py-6">
                                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                                    <p className="text-sm font-medium text-slate-200">This TFVC project has no folders</p>
                                    <p className="text-xs text-slate-400 mt-1">Check that your PAT has Code (Read) permission.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="p-2.5 bg-amber-900/20 border border-amber-700/30 rounded-lg">
                                        <p className="text-xs text-amber-300">
                                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                                            This project uses TFVC. Select folders to migrate as Git repositories.
                                            Each folder will be converted to a separate Git repo and pushed to GitHub.
                                        </p>
                                    </div>

                                    {/* Search */}
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                        <input
                                            type="text" value={repoSearch}
                                            onChange={e => set('repoSearch', e.target.value)}
                                            placeholder="Filter folders..."
                                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-indigo-500"
                                        />
                                    </div>

                                    {/* Selection counter */}
                                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                        <span>
                                            <span className={selectedCount > 0 ? 'text-indigo-400 font-medium' : ''}>{selectedCount} selected</span>
                                            {' '}of {tfvcItems.length}
                                        </span>
                                    </div>

                                    {/* TFVC folder list */}
                                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                                        {tfvcItems
                                            .filter(item => !repoSearch || item.path.toLowerCase().includes(repoSearch.toLowerCase()))
                                            .map(item => {
                                                const folderName = item.path.split('/').pop()
                                                const isSelected = selectedRepos[folderName] !== undefined
                                                return (
                                                    <button
                                                        key={item.path}
                                                        onClick={() => dispatch({ type: 'TOGGLE_REPO', repoName: folderName })}
                                                        className={`w-full text-left p-3 rounded-xl border transition-all text-sm
                                                            ${isSelected
                                                                ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm shadow-indigo-500/10'
                                                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                            }`}
                                                    >
                                                        <div className="flex items-start gap-2.5">
                                                            <div className={`w-[18px] h-[18px] mt-0.5 rounded flex items-center justify-center shrink-0 border-2 transition-colors
                                                                ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-400 dark:border-slate-600'}`}>
                                                                {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <FolderGit2 className="w-3.5 h-3.5 text-amber-400" />
                                                                    <span className="font-semibold text-slate-900 dark:text-slate-100">{folderName}</span>
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 font-semibold uppercase tracking-wide">TFVC</span>
                                                                </div>
                                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">{item.path}</div>
                                                                {isSelected && (
                                                                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50" onClick={e => e.stopPropagation()}>
                                                                        <label className="text-[11px] text-slate-500 whitespace-nowrap">Target:</label>
                                                                        <input
                                                                            type="text"
                                                                            value={selectedRepos[folderName] || ''}
                                                                            onChange={e => dispatch({ type: 'SET_REPO_TARGET', repoName: folderName, targetName: e.target.value })}
                                                                            className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                    </div>
                                </>
                            )
                        ) : repos.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-sm text-slate-500 dark:text-slate-400">This project has no repositories.</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Check that your PAT has the correct permissions.</p>
                            </div>
                        ) : (
                            <>
                                {/* Search + Select all */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                        <input
                                            type="text" value={repoSearch}
                                            onChange={e => set('repoSearch', e.target.value)}
                                            placeholder="Filter repos..."
                                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (allSelectableSelected) dispatch({ type: 'DESELECT_ALL_REPOS' })
                                            else dispatch({ type: 'SELECT_ALL_REPOS', repos: selectableRepos })
                                        }}
                                        className="text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors whitespace-nowrap"
                                    >
                                        {allSelectableSelected ? 'Deselect all' : `Select all (${selectableRepos.length})`}
                                    </button>
                                </div>

                                {/* Selection counter */}
                                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span>
                                        <span className={selectedCount > 0 ? 'text-indigo-400 font-medium' : ''}>{selectedCount} selected</span>
                                        {' '}of {repos.length}
                                    </span>
                                    {selectedCount > 0 && <span>{formatSize(totalSelectedSize)}</span>}
                                </div>

                                {/* Repo list */}
                                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                                    {filteredRepos.map(repo => {
                                        const isSelected = selectedRepos[repo.name] !== undefined
                                        const isEmpty = !repo.isDisabled && repo.size === 0
                                        const isLarge = repo.size > 512000
                                        return (
                                            <button
                                                key={repo.id}
                                                disabled={repo.isDisabled}
                                                onClick={() => {
                                                    if (repo.isDisabled) return
                                                    dispatch({ type: 'TOGGLE_REPO', repoName: repo.name })
                                                }}
                                                className={`w-full text-left p-3 rounded-xl border transition-all text-sm
                                                    ${repo.isDisabled
                                                        ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700'
                                                        : isSelected
                                                            ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm shadow-indigo-500/10'
                                                            : isEmpty
                                                                ? 'opacity-60 border-slate-200 dark:border-slate-700/50 hover:border-indigo-400/40'
                                                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                    }`}
                                            >
                                                <div className="flex items-start gap-2.5">
                                                    {/* Checkbox */}
                                                    <div className={`w-[18px] h-[18px] mt-0.5 rounded flex items-center justify-center shrink-0 border-2 transition-colors
                                                        ${isSelected
                                                            ? 'bg-indigo-500 border-indigo-500'
                                                            : 'border-slate-400 dark:border-slate-600'
                                                        }`}>
                                                        {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        {/* Name + badges */}
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-semibold text-slate-900 dark:text-slate-100">{repo.name}</span>
                                                            {repo.isDisabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 font-semibold uppercase tracking-wide">Disabled</span>}
                                                            {isEmpty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 font-semibold uppercase tracking-wide">Empty</span>}
                                                            {isLarge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400 font-semibold uppercase tracking-wide">Large</span>}
                                                            {repo.isFork && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400 font-semibold uppercase tracking-wide">Fork</span>}
                                                        </div>

                                                        {/* Metadata row */}
                                                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            {repo.defaultBranch && (
                                                                <span className="flex items-center gap-1 text-cyan-500">
                                                                    <GitBranch className="w-3 h-3" />
                                                                    {repo.defaultBranch.replace('refs/heads/', '')}
                                                                </span>
                                                            )}
                                                            <span className="text-slate-400">{formatSize(repo.size)}</span>
                                                        </div>

                                                        {/* Inline rename for selected repos */}
                                                        {isSelected && (
                                                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50" onClick={e => e.stopPropagation()}>
                                                                <label className="text-[11px] text-slate-500 whitespace-nowrap">Target:</label>
                                                                <input
                                                                    type="text"
                                                                    value={selectedRepos[repo.name] || ''}
                                                                    onChange={e => dispatch({ type: 'SET_REPO_TARGET', repoName: repo.name, targetName: e.target.value })}
                                                                    className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                                                />
                                                                {duplicates[selectedRepos[repo.name]] && (
                                                                    <span className="flex items-center gap-1 text-[10px] text-amber-400 whitespace-nowrap">
                                                                        <AlertTriangle className="w-3 h-3" /> Exists
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </>
                        )}

                        <div className="flex gap-3 pt-1">
                            <Button variant="secondary" onClick={() => { const stps = getSteps('azure'); set('step', stps.indexOf('azure-smart')) }} className="flex-1">
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back
                            </Button>
                            <Button onClick={() => { const stps = getSteps('azure'); set('step', stps.indexOf('azure-confirm')) }} disabled={selectedCount === 0} className="flex-1">
                                {selectedCount > 1 ? `Import ${selectedCount} Repos` : 'Next'} <ArrowRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Azure Confirm (combined target + review) */}
                {currentStep === 'azure-confirm' && (
                    <div className="space-y-4">
                        {/* Source summary */}
                        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between">
                                <div className="text-xs text-slate-500 dark:text-slate-400">Source</div>
                                <button onClick={() => { const stps = getSteps('azure'); set('step', stps.indexOf('azure-smart')) }}
                                    className="text-xs text-indigo-500 hover:text-indigo-400">Change</button>
                            </div>
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                                Azure DevOps · {getSourceDisplayName()}
                            </div>
                            {versionControlType === 'Tfvc' && (
                                <div className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> TFVC — will be converted to Git before import
                                </div>
                            )}
                            {selectedCount === 1 && !versionControlType && (() => {
                                const repoObj = repos.find(r => r.name === selectedRepoNames[0])
                                if (!repoObj) return null
                                return (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-3">
                                        {repoObj.size > 0 && <span>{formatSize(repoObj.size)}</span>}
                                        {repoObj.defaultBranch && <span>{repoObj.defaultBranch.replace('refs/heads/', '')}</span>}
                                        {repoObj.size > 512000 && (
                                            <span className="text-amber-500 flex items-center gap-1">
                                                <AlertTriangle className="w-3 h-3" /> Large repo — import may take a while
                                            </span>
                                        )}
                                    </div>
                                )
                            })()}
                            {/* Batch summary */}
                            {isBatch && (
                                <div className="mt-2 space-y-1">
                                    {selectedRepoNames.map(name => {
                                        const target = selectedRepos[name]
                                        const repo = repos.find(r => r.name === name)
                                        const isDuplicate = duplicates[target]
                                        return (
                                            <div key={name} className="flex items-center justify-between text-xs py-1 border-t border-slate-200/50 dark:border-slate-700/50 first:border-t-0">
                                                <span className="text-slate-300 font-medium truncate">{name}</span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {name !== target && <span className="text-slate-500">→ {target}</span>}
                                                    <span className="text-slate-500">{formatSize(repo?.size || 0)}</span>
                                                    {isDuplicate && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                                                </div>
                                            </div>
                                        )
                                    })}
                                    <div className="text-xs text-slate-500 pt-1 border-t border-slate-700/50">
                                        Total: {formatSize(totalSelectedSize)} · {selectedCount} repositories
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Target config */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">GitHub Owner</label>
                            <Select value={targetOrg} onChange={v => set('targetOrg', v)}
                                options={[{ value: '', label: 'My personal account' }, ...(orgs?.map(o => ({ value: o.login, label: o.login })) || [])]} />
                        </div>

                        {/* Single repo: show name + description inputs */}
                        {!isBatch && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository Name</label>
                                    <input type="text" value={selectedRepos[selectedRepoNames[0]] || targetName}
                                        onChange={e => {
                                            if (selectedRepoNames[0]) dispatch({ type: 'SET_REPO_TARGET', repoName: selectedRepoNames[0], targetName: e.target.value })
                                            else set('targetName', e.target.value)
                                        }}
                                        placeholder="my-imported-repo"
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description (optional)</label>
                                    <input type="text" value={description} onChange={e => set('description', e.target.value)}
                                        placeholder={`Imported from Azure DevOps: ${azureOrg}/${selectedProject}/${selectedRepoNames[0] || ''}`}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                                </div>
                            </>
                        )}

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={makePrivate} onChange={e => set('makePrivate', e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                {makePrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                {makePrivate ? 'Private' : 'Public'} {isBatch ? 'repositories' : 'repository'}
                            </span>
                        </label>

                        {/* Duplicate warnings */}
                        {checkingDuplicates && (
                            <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> Checking for duplicates...</div>
                        )}
                        {Object.values(duplicates).some(Boolean) && (
                            <div className="flex items-start gap-2 p-2.5 bg-amber-900/20 rounded-lg text-xs text-amber-400 border border-amber-800/40">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span>Some target names already exist on GitHub. Importing will fail for duplicates — rename them in the previous step.</span>
                            </div>
                        )}

                        {/* Info note */}
                        <div className="flex items-start gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>
                                Imports Git code and history{isBatch ? ' (2 repos at a time)' : ''}. Issues, PRs, and pipelines are not migrated.
                            </span>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => set('step', step - 1)} className="flex-1">
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back
                            </Button>
                            <Button onClick={startImport} disabled={importing || gitAvailable === false || (selectedCount === 0)} className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500">
                                {importing
                                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</>
                                    : isBatch ? `Import ${selectedCount} Repos` : 'Import'
                                }
                            </Button>
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
                                <input type="url" value={githubSourceUrl} onChange={e => set('githubSourceUrl', e.target.value)}
                                    placeholder="https://github.com/owner/repo"
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Public repos can be cloned directly. Your GitHub OAuth token will be used for push.
                            </p>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setFields({ step: 0, sourceType: '' })} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => {
                                if (!targetName) {
                                    const parts = githubSourceUrl.replace(/\.git$/, '').split('/')
                                    set('targetName', parts[parts.length - 1] || '')
                                }
                                set('step', 2)
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
                            <Select value={targetOrg} onChange={v => set('targetOrg', v)}
                                options={[{ value: '', label: 'My personal account' }, ...(orgs?.map(o => ({ value: o.login, label: o.login })) || [])]} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository Name</label>
                            <input type="text" value={targetName} onChange={e => set('targetName', e.target.value)}
                                placeholder="my-imported-repo"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description (optional)</label>
                            <input type="text" value={description} onChange={e => set('description', e.target.value)}
                                placeholder="Imported repository"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={makePrivate} onChange={e => set('makePrivate', e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                {makePrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                Make repository {makePrivate ? 'private' : 'public'}
                            </span>
                        </label>
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={() => set('step', step - 1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={() => set('step', step + 1)} disabled={!targetName} className="flex-1">Review <ArrowRight className="w-4 h-4 ml-1" /></Button>
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
                            <Button variant="secondary" onClick={() => set('step', step - 1)} className="flex-1"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                            <Button onClick={startImport} disabled={importing || gitAvailable === false} className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500">
                                {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Start Import'}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Progress Step */}
                {currentStep === 'progress' && (
                    <div className="space-y-4">
                        {/* Batch progress */}
                        {batchJobs.length > 0 ? (() => {
                            const activeJobs = batchJobs.filter(j => j.jobId && !j.skipped)
                            const completedCount = activeJobs.filter(j => batchStatuses[j.jobId]?.status === 'complete').length
                            const failedCount = activeJobs.filter(j => batchStatuses[j.jobId]?.status === 'failed').length
                            const skippedCount = batchJobs.filter(j => j.skipped).length
                            const totalActive = activeJobs.length
                            const allDone = completedCount + failedCount >= totalActive
                            const overallPct = totalActive > 0
                                ? Math.round(activeJobs.reduce((sum, j) => sum + (batchStatuses[j.jobId]?.progressPct || 0), 0) / totalActive)
                                : 0

                            return (
                                <>
                                    {/* Overall header */}
                                    <div className="text-center pb-2">
                                        {allDone ? (
                                            failedCount === 0 ? (
                                                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                                            ) : (
                                                <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
                                            )
                                        ) : (
                                            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-2" />
                                        )}
                                        <h3 className="font-bold text-slate-900 dark:text-slate-100">
                                            {allDone
                                                ? failedCount > 0
                                                    ? `${completedCount} of ${totalActive} imported`
                                                    : 'All imports complete!'
                                                : `Importing ${totalActive} repositories...`
                                            }
                                        </h3>
                                        {!allDone && (
                                            <div className="mt-2">
                                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                                    <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-1.5 rounded-full transition-all duration-500"
                                                        style={{ width: `${overallPct}%` }} />
                                                </div>
                                                <p className="text-xs text-slate-500 mt-1">{completedCount} of {totalActive} complete · {overallPct}%</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Per-repo status */}
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {batchJobs.map(job => {
                                            const status = batchStatuses[job.jobId]
                                            const isDone = status?.status === 'complete'
                                            const isFailed = status?.status === 'failed' || job.skipped
                                            const isRunning = status?.status === 'running'
                                            const isPending = !status || status.status === 'pending'

                                            return (
                                                <div key={job.repoName} className={`p-2.5 rounded-lg border text-sm
                                                    ${isDone ? 'border-green-800/40 bg-green-950/20' :
                                                      isFailed ? 'border-red-800/40 bg-red-950/20' :
                                                      isRunning ? 'border-indigo-800/40 bg-indigo-950/20' :
                                                      'border-slate-700/50 bg-slate-800/30'}`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            {isDone && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                                                            {isFailed && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                                                            {isRunning && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />}
                                                            {isPending && !job.skipped && <Clock className="w-4 h-4 text-slate-500 shrink-0" />}
                                                            <span className="font-medium text-slate-200 truncate">{job.repoName}</span>
                                                            {job.repoName !== job.targetName && (
                                                                <span className="text-xs text-slate-500">→ {job.targetName}</span>
                                                            )}
                                                        </div>
                                                        {isDone && status?.metadata?.repoUrl && (
                                                            <a href={status.metadata.repoUrl} target="_blank" rel="noopener noreferrer"
                                                                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 shrink-0">
                                                                View <ExternalLink className="w-3 h-3" />
                                                            </a>
                                                        )}
                                                    </div>
                                                    {isRunning && (
                                                        <div className="mt-1.5">
                                                            <div className="w-full bg-slate-700 rounded-full h-1">
                                                                <div className="bg-indigo-500 h-1 rounded-full transition-all duration-500"
                                                                    style={{ width: `${status?.progressPct || 0}%` }} />
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">{status?.progressMessage || 'Starting...'}</p>
                                                        </div>
                                                    )}
                                                    {isFailed && (
                                                        <p className="text-[11px] text-red-400 mt-1">{job.error || status?.errorMessage || 'Import failed'}</p>
                                                    )}
                                                    {isDone && status?.metadata?.branchCount && (
                                                        <p className="text-[10px] text-green-400/70 mt-0.5">{status.metadata.branchCount} branch(es) imported</p>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {skippedCount > 0 && (
                                        <p className="text-xs text-slate-500">{skippedCount} repo(s) skipped (already importing or error)</p>
                                    )}
                                </>
                            )
                        })() : (
                            /* Single repo progress (existing) */
                            <>
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
                            </>
                        )}
                        <div className="flex gap-3 pt-2">
                            <Button variant="secondary" onClick={onClose} className="flex-1">
                                {batchJobs.length > 0
                                    ? (!importing ? 'Close' : 'Run in Background')
                                    : (jobStatus?.status === 'complete' || jobStatus?.status === 'failed' ? 'Close' : 'Run in Background')
                                }
                            </Button>
                            {batchJobs.length === 0 && jobStatus?.status === 'failed' && (
                                <Button onClick={() => setFields({ step: steps.indexOf(sourceType === 'azure' ? 'azure-confirm' : 'review'), jobId: null, jobStatus: null })} className="flex-1">
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
