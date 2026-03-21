import { useState, useCallback, useMemo } from 'react'

const STEPS = [
  'source',
  'repoSelect',
  'repoConfig',
  'workItems',
  'wiki',
  'aiReview',
  'schedule',
  'progress',
  'summary',
]

const INITIAL_SOURCE = {
  type: 'azure',
  org: '',
  project: '',
  pat: '',
  validated: false,
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

const validators = {
  source: (state) => {
    if (!state.source.org) return 'Organization is required'
    if (!state.source.project) return 'Project is required'
    if (!state.source.validated) return 'Please validate your credentials'
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
 * Determines whether a step should be skipped based on current state.
 */
function shouldSkipStep(step, state) {
  if (step === 'workItems' && !state.workItems.enabled) return true
  if (step === 'wiki' && !state.wiki.enabled) return true
  return false
}

/**
 * State machine hook that powers the MigrationWizard component.
 * Manages step navigation, validation, and all wizard state.
 */
export function useMigrationWizard() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [source, setSource] = useState(INITIAL_SOURCE)
  const [repos, setRepos] = useState([])
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS)
  const [wiki, setWiki] = useState(INITIAL_WIKI)
  const [aiPlan, setAiPlan] = useState(INITIAL_AI_PLAN)
  const [schedule, setSchedule] = useState(INITIAL_SCHEDULE)
  const [planId, setPlanId] = useState(null)
  const [error, setError] = useState(null)

  const currentStep = STEPS[currentStepIndex]

  const state = useMemo(
    () => ({ source, repos, workItems, wiki, aiPlan, schedule, planId }),
    [source, repos, workItems, wiki, aiPlan, schedule, planId]
  )

  const canGoBack = currentStepIndex > 0
  const canGoNext = currentStepIndex < STEPS.length - 1

  const nextStep = useCallback(() => {
    const validate = validators[STEPS[currentStepIndex]]
    if (validate) {
      const validationError = validate({ source, repos, workItems, wiki, aiPlan, schedule, planId })
      if (validationError) {
        setError(validationError)
        return
      }
    }

    setError(null)

    let nextIndex = currentStepIndex + 1
    while (
      nextIndex < STEPS.length &&
      shouldSkipStep(STEPS[nextIndex], { source, repos, workItems, wiki, aiPlan, schedule, planId })
    ) {
      nextIndex++
    }

    if (nextIndex < STEPS.length) {
      setCurrentStepIndex(nextIndex)
    }
  }, [currentStepIndex, source, repos, workItems, wiki, aiPlan, schedule, planId])

  const prevStep = useCallback(() => {
    let prevIndex = currentStepIndex - 1
    while (
      prevIndex >= 0 &&
      shouldSkipStep(STEPS[prevIndex], { source, repos, workItems, wiki, aiPlan, schedule, planId })
    ) {
      prevIndex--
    }

    if (prevIndex >= 0) {
      setError(null)
      setCurrentStepIndex(prevIndex)
    }
  }, [currentStepIndex, source, repos, workItems, wiki, aiPlan, schedule, planId])

  const goToStep = useCallback(
    (step) => {
      const targetIndex = STEPS.indexOf(step)
      if (targetIndex < 0) return
      // Only allow navigating to completed steps (before current)
      if (targetIndex < currentStepIndex) {
        setError(null)
        setCurrentStepIndex(targetIndex)
      }
    },
    [currentStepIndex]
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

  const resetWizard = useCallback(() => {
    setCurrentStepIndex(0)
    setSource(INITIAL_SOURCE)
    setRepos([])
    setWorkItems(INITIAL_WORK_ITEMS)
    setWiki(INITIAL_WIKI)
    setAiPlan(INITIAL_AI_PLAN)
    setSchedule(INITIAL_SCHEDULE)
    setPlanId(null)
    setError(null)
  }, [])

  return {
    // Step navigation
    steps: STEPS,
    currentStep,
    currentStepIndex,
    nextStep,
    prevStep,
    goToStep,
    canGoNext,
    canGoBack,

    // State
    source,
    repos,
    workItems,
    wiki,
    aiPlan,
    schedule,
    planId,
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

    // Actions
    resetWizard,
  }
}
