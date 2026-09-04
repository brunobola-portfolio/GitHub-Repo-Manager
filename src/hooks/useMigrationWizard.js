import { useState, useCallback, useMemo, useEffect, useRef } from 'react'

// Session-scoped draft for wizard recovery across refresh / route change.
// We persist enough to restart where the user left off, but deliberately
// SCRUB credentials (PATs, OAuth tokens, Basic-auth passwords) before
// writing — sessionStorage is not a safe place for secrets. Users will be
// re-prompted for credentials when they return.
const DRAFT_STORAGE_KEY = 'grm-migration-wizard-draft'
const DRAFT_SCHEMA_VERSION = 1

const SENSITIVE_SOURCE_FIELDS = ['pat', 'authToken', 'authPassword']

function scrubSourceForPersistence(source) {
  const copy = { ...source }
  for (const field of SENSITIVE_SOURCE_FIELDS) {
    if (copy[field]) copy[field] = ''
  }
  // validated=true must also drop so the user re-validates with fresh creds.
  if (copy.validated) copy.validated = false
  return copy
}

function loadDraft() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== DRAFT_SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

function saveDraft(draft) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Ignore quota / private-mode failures; the in-memory state is canonical.
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem(DRAFT_STORAGE_KEY) } catch { /* ignore */ }
}

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
      // Before the user picks a source, fall back to the git-URL flow's step
      // list (the wizard's own default entry point — see MigrationWizard's
      // `wizardTitle`) rather than a single-item list. That keeps the
      // progress rail present and meaningful on step 1 instead of it
      // appearing only from step 2 onward (U26).
      return ['sourceType', 'urlInput', 'targetConfig', 'progress', 'summary']
  }
}

const INITIAL_SOURCE = {
  sourceType: '',             // 'azure' | 'url' | 'github'
  // Azure fields
  host: '',                   // 'dev.azure.com' | 'org.visualstudio.com' | 'tfs.corp.com' …
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
  approved: false,
  risks: [],
  suggestions: [],
  executionOrder: [],
}

const INITIAL_SCHEDULE = {
  mode: 'now',
  scheduledAt: null,
  isDryRun: false,
}

const INITIAL_TAGGING_POLICY = {
  enabled: true,
  writeSource: true,
  writeDestination: true,
  writeGitTag: true,
  hideSourceName: false,
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
    // Validate credentials BEFORE checking project — project is only populated
    // (auto-picked from the URL or chosen from the dropdown) once validation
    // succeeds, so a "Project is required" message before that is misleading.
    if (!state.source.validated) return 'Please validate your credentials'
    if (!state.source.project) return 'Project is required'
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
  // Migration is destructive — require an explicit, informed approval of the
  // reviewed plan before advancing. The approve action lives in AIReviewStep
  // (sets aiPlan.approved); re-analyzing resets it so a new plan is re-approved.
  aiReview: (state) =>
    state.aiPlan?.approved ? null : 'Review and approve the migration plan to continue',
  schedule: (state) => {
    if (state.schedule.mode === 'scheduled' && !state.schedule.scheduledAt)
      return 'Select a date and time'
    return null
  },
  progress: () => null,
  summary: () => null,
}

/**
 * State machine hook that powers the unified Migration/Import Wizard.
 * Manages step navigation, validation, and all wizard state.
 * Steps are computed dynamically based on source type.
 *
 * @param {object} [options]
 * @param {boolean} [options.initialDryRun=false] - Seed schedule.isDryRun on mount
 */
export function useMigrationWizard({
  initialDryRun = false,
  initialSource,
  initialRepos,
  initialStep,
  persistDraft = true,
} = {}) {
  // If the caller passes initialSource/initialRepos/initialStep, respect those
  // — the wizard was opened with an explicit pre-fill (e.g. "Run again").
  // Otherwise, rehydrate from sessionStorage so a refresh mid-flow doesn't
  // destroy the user's progress.
  const hydrated = useRef(
    persistDraft && !initialSource && !initialRepos && !initialStep
      ? loadDraft()
      : null,
  )

  /* eslint-disable react-hooks/refs -- hydrated is a one-shot mount-time draft loaded into useRef and only consumed inside the lazy-init callbacks below; never reassigned, never read in render output */
  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    if (hydrated.current?.currentStepIndex != null) return hydrated.current.currentStepIndex
    if (!initialStep) return 0
    const initialSteps = getStepsForSourceType(initialSource?.sourceType, false, false)
    const idx = initialSteps.indexOf(initialStep)
    return idx >= 0 ? idx : 0
  })
  const [source, setSource] = useState(() => ({
    ...INITIAL_SOURCE,
    ...(hydrated.current?.source || {}),
    ...(initialSource || {}),
  }))
  const [repos, setRepos] = useState(() => initialRepos || hydrated.current?.repos || [])
  const [workItems, setWorkItems] = useState(() => ({
    ...INITIAL_WORK_ITEMS,
    ...(hydrated.current?.workItems || {}),
  }))
  const [wiki, setWiki] = useState(() => ({
    ...INITIAL_WIKI,
    ...(hydrated.current?.wiki || {}),
  }))
  const [aiPlan, setAiPlan] = useState(INITIAL_AI_PLAN)
  const [schedule, setSchedule] = useState(() => ({
    ...INITIAL_SCHEDULE,
    isDryRun: initialDryRun,
    ...(hydrated.current?.schedule || {}),
  }))
  const [taggingPolicy, setTaggingPolicy] = useState(() => ({
    ...INITIAL_TAGGING_POLICY,
    ...(hydrated.current?.taggingPolicy || {}),
  }))
  /* eslint-enable react-hooks/refs */
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

  // Clear a stale wizard-level error once the user-visible reason changes —
  // either resolved entirely, or shifted to a different validator complaint
  // (e.g. "Please validate your credentials" should disappear once the PAT
  // auto-validates, even if "Project is required" is now the live problem;
  // that next message will surface when the user clicks Next again).
  useEffect(() => {
    if (!error) return
    const validate = validators[steps[currentStepIndex]]
    if (!validate) return
    const current = validate({ source, repos, workItems, wiki, aiPlan, schedule, planId, importJobs })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears a transient UI error once its precondition shifts; no cascade because the next render sees error=null and exits the effect early.
    if (current !== error) setError(null)
  }, [error, currentStepIndex, steps, source, repos, workItems, wiki, aiPlan, schedule, planId, importJobs])

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

  const updateTaggingPolicy = useCallback((nextOrFn) => {
    setTaggingPolicy((prev) => {
      const next = typeof nextOrFn === 'function' ? nextOrFn(prev) : nextOrFn
      return { ...prev, ...next }
    })
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
    setTaggingPolicy(INITIAL_TAGGING_POLICY)
    setPlanId(null)
    setImportJobs(INITIAL_IMPORT_JOBS)
    setError(null)
    clearDraft()
  }, [])

  // Persist a credential-free draft of wizard state so a refresh doesn't
  // reset the user to step 1. The draft is dropped when they reach the
  // 'summary' step (migration finished) or call resetWizard.
  useEffect(() => {
    if (!persistDraft) return
    // Don't persist an empty pristine state (first render with no source type).
    if (!source.sourceType && currentStepIndex === 0) {
      clearDraft()
      return
    }
    // Don't persist once the flow is complete — leaves nothing stale lurking.
    if (currentStep === 'summary') {
      clearDraft()
      return
    }
    saveDraft({
      schemaVersion: DRAFT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      currentStepIndex,
      source: scrubSourceForPersistence(source),
      repos,
      workItems,
      wiki,
      schedule,
      taggingPolicy,
    })
  }, [persistDraft, currentStepIndex, currentStep, source, repos, workItems, wiki, schedule, taggingPolicy])

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
    taggingPolicy,
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
    updateTaggingPolicy,
    setPlanId,
    updateImportJobs,

    // Actions
    resetWizard,
  }
}
