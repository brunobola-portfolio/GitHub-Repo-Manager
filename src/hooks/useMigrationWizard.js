import { useState, useCallback, useMemo } from 'react'

/**
 * Compute the active step sequence based on source type and feature toggles.
 */
function getStepsForSourceType(sourceType, workItemsEnabled, wikiEnabled) {
  switch (sourceType) {
    case 'azure':
      return [
        'sourceType',
        'azureConnect',
        'repoSelect',
        'repoConfig',
        ...(workItemsEnabled ? ['workItems'] : []),
        ...(wikiEnabled ? ['wiki'] : []),
        'aiReview',
        'schedule',
        'progress',
        'summary',
      ]
    case 'url':
      return ['sourceType', 'urlInput', 'targetConfig', 'progress', 'summary']
    case 'github':
      return ['sourceType', 'githubSource', 'targetConfig', 'progress', 'summary']
    default:
      return ['sourceType']
  }
}

const INITIAL_SOURCE = {
  sourceType: '',             // 'azure' | 'url' | 'github'
  // Azure fields
  org: '',
  project: '',
  pat: '',
  validated: false,
  versionControlType: null,   // 'Git' | 'Tfvc' | null
  // URL import fields
  sourceUrl: '',
  urlValidation: null,        // null | 'validating' | 'valid' | 'invalid'
  urlError: '',
  authType: 'none',           // 'none' | 'token' | 'basic'
  authToken: '',
  authUsername: '',
  authPassword: '',
  // GitHub import fields
  githubSourceUrl: '',
  // Target fields (URL/GitHub flows)
  targetOrg: '',
  targetName: '',
  makePrivate: true,
  description: '',
  // System
  gitAvailable: null,
  envAuthAvailable: null,
  // URL paste fields
  urlParsedRepo: '',        // repo name extracted from URL paste
  urlParsedProject: '',     // project name extracted from URL paste (pre-selects dropdown)
  // Credential mode
  credentialMode: '',       // 'serverPat' | 'personalPat' | 'oauth' | ''
}

const INITIAL_WORK_ITEMS = {
  enabled: false,
  types: [],
  counts: {},
  includeComments: true,
  includeAttachments: true,
}

const INITIAL_WIKI = {
  enabled: false,
  wikis: [],
  destinations: {},
}

const INITIAL_AI_PLAN = {
  analyzed: false,
  risks: [],
  suggestions: [],
  executionOrder: [],
}

const INITIAL_SCHEDULE = {
  mode: 'now',
  scheduledAt: null,
  isDryRun: false,
}

const INITIAL_IMPORT_JOBS = {
  jobId: null,
  jobStatus: null,
  importing: false,
  batchJobs: [],
  batchStatuses: {},
}

const validators = {
  sourceType: (state) => {
    if (!state.source.sourceType) return 'Select a source type'
    return null
  },
  azureConnect: (state) => {
    if (!state.source.org) return 'Organization is required'
    if (!state.source.project) return 'Project is required'
    if (!state.source.validated) return 'Please validate your credentials'
    return null
  },
  urlInput: (state) => {
    if (!state.source.sourceUrl.trim()) return 'Repository URL is required'
    if (state.source.urlValidation !== 'valid') return 'Please validate the URL first'
    return null
  },
  githubSource: (state) => {
    if (!state.source.githubSourceUrl.trim()) return 'GitHub repository URL is required'
    return null
  },
  targetConfig: (state) => {
    if (!state.source.targetName.trim()) return 'Repository name is required'
    return null
  },
  repoSelect: (state) => {
    if (!state.repos.some((r) => r.selected)) return 'Select at least one repository'
    return null
  },
  repoConfig: (state) => {
    const selected = state.repos.filter((r) => r.selected)
    if (selected.some((r) => !r.targetName?.trim())) return 'All repositories need a target name'
    const names = selected.map((r) => r.targetName)
    if (new Set(names).size !== names.length) return 'Target names must be unique'
    return null
  },
  workItems: (state) => {
    if (state.workItems.enabled && state.workItems.types.length === 0)
      return 'Select at least one work item type'
    return null
  },
  wiki: (state) => {
    if (state.wiki.enabled) {
      const unset = state.wiki.wikis.filter((w) => !state.wiki.destinations[w.id])
      if (unset.length > 0) return 'Set destination for all wikis'
    }
    return null
  },
  aiReview: () => null,
  schedule: (state) => {
    if (state.schedule.mode === 'scheduled' && !state.schedule.scheduledAt)
      return 'Select a date and time'
    return null
  },
  progress: () => null,
  summary: () => null,
}

/**
 * Derive the source type implied by a step ID.
 * Returns 'azure' for any step that only exists in the Azure flow,
 * otherwise returns '' (unknown / no pre-selection).
 */
function sourceTypeForStep(stepId) {
  const AZURE_ONLY_STEPS = ['azureConnect', 'repoSelect', 'repoConfig', 'workItems', 'wiki', 'aiReview']
  if (AZURE_ONLY_STEPS.includes(stepId)) return 'azure'
  return ''
}

/**
 * State machine hook that powers the unified Migration/Import Wizard.
 * Manages step navigation, validation, and all wizard state.
 * Steps are computed dynamically based on source type.
 *
 * @param {object} [options]
 * @param {boolean} [options.initialDryRun=false] - Seed schedule.isDryRun on mount
 * @param {string|null} [options.initialStep=null] - Jump directly to this step ID on mount
 */
export function useMigrationWizard({ initialDryRun = false, initialStep = null } = {}) {
  // If initialStep implies a specific source type, pre-seed source so the steps
  // array is computed correctly on the very first render.
  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    if (!initialStep) return 0
    const impliedSourceType = sourceTypeForStep(initialStep)
    if (!impliedSourceType) return 0
    const stepList = getStepsForSourceType(impliedSourceType, false, false)
    const idx = stepList.indexOf(initialStep)
    return idx >= 0 ? idx : 0
  })
  const [source, setSource] = useState(() => {
    if (!initialStep) return INITIAL_SOURCE
    const impliedSourceType = sourceTypeForStep(initialStep)
    if (!impliedSourceType) return INITIAL_SOURCE
    return { ...INITIAL_SOURCE, sourceType: impliedSourceType }
  })
  const [repos, setRepos] = useState([])
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS)
  const [wiki, setWiki] = useState(INITIAL_WIKI)
  const [aiPlan, setAiPlan] = useState(INITIAL_AI_PLAN)
  const [schedule, setSchedule] = useState(() => ({ ...INITIAL_SCHEDULE, isDryRun: initialDryRun }))
  const [planId, setPlanId] = useState(null)
  const [importJobs, setImportJobs] = useState(INITIAL_IMPORT_JOBS)
  const [error, setError] = useState(null)

  // Dynamic step list based on source type
  const steps = useMemo(
    () => getStepsForSourceType(source.sourceType, workItems.enabled, wiki.enabled),
    [source.sourceType, workItems.enabled, wiki.enabled]
  )

  const currentStep = steps[currentStepIndex] || 'sourceType'

  const canGoBack = currentStepIndex > 0
  const canGoNext = currentStepIndex < steps.length - 1

  const isDirty = useMemo(() => {
    if (!source.sourceType) return false
    if (source.pat || source.authToken || source.authUsername || source.authPassword) return true
    if (source.org || source.project) return true
    if (source.sourceUrl || source.githubSourceUrl) return true
    if (source.targetName || source.targetOrg) return true
    if (repos.some((r) => r.selected)) return true
    if (workItems.enabled || wiki.enabled) return true
    if (currentStepIndex > 1) return true
    return false
  }, [source, repos, workItems.enabled, wiki.enabled, currentStepIndex])

  const nextStep = useCallback(() => {
    const validate = validators[steps[currentStepIndex]]
    if (validate) {
      const validationError = validate({ source, repos, workItems, wiki, aiPlan, schedule, planId, importJobs })
      if (validationError) {
        setError(validationError)
        return
      }
    }

    setError(null)

    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setCurrentStepIndex(nextIndex)
    }
  }, [currentStepIndex, steps, source, repos, workItems, wiki, aiPlan, schedule, planId, importJobs])

  const prevStep = useCallback(() => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setError(null)
      setCurrentStepIndex(prevIndex)
    }
  }, [currentStepIndex])

  const goToStep = useCallback(
    (step) => {
      const targetIndex = steps.indexOf(step)
      if (targetIndex < 0) return
      // Allow navigating to completed steps (before current)
      if (targetIndex < currentStepIndex) {
        setError(null)
        setCurrentStepIndex(targetIndex)
      }
    },
    [currentStepIndex, steps]
  )

  const updateSource = useCallback((updates) => {
    setSource((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateRepo = useCallback((index, updates) => {
    setRepos((prev) => prev.map((repo, i) => (i === index ? { ...repo, ...updates } : repo)))
  }, [])

  const updateWorkItems = useCallback((updates) => {
    setWorkItems((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateWiki = useCallback((updates) => {
    setWiki((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateAiPlan = useCallback((updates) => {
    setAiPlan((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateSchedule = useCallback((updates) => {
    setSchedule((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateImportJobs = useCallback((updatesOrFn) => {
    setImportJobs((prev) => {
      const updates = typeof updatesOrFn === 'function' ? updatesOrFn(prev) : updatesOrFn
      return { ...prev, ...updates }
    })
  }, [])

  const resetWizard = useCallback(() => {
    setCurrentStepIndex(0)
    setSource(INITIAL_SOURCE)
    setRepos([])
    setWorkItems(INITIAL_WORK_ITEMS)
    setWiki(INITIAL_WIKI)
    setAiPlan(INITIAL_AI_PLAN)
    setSchedule(INITIAL_SCHEDULE)
    setPlanId(null)
    setImportJobs(INITIAL_IMPORT_JOBS)
    setError(null)
  }, [])

  return {
    // Step navigation
    steps,
    currentStep,
    currentStepIndex,
    nextStep,
    prevStep,
    goToStep,
    canGoNext,
    canGoBack,

    // State
    isDirty,
    source,
    repos,
    workItems,
    wiki,
    aiPlan,
    schedule,
    planId,
    importJobs,
    error,

    // State updaters
    updateSource,
    setRepos,
    updateRepo,
    updateWorkItems,
    updateWiki,
    updateAiPlan,
    updateSchedule,
    setPlanId,
    updateImportJobs,

    // Actions
    resetWizard,
  }
}
