# Wizard Full-Screen Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal-based MigrationWizard with a full-screen takeover panel featuring restore/maximize toggle, sidebar navigation, dirty-state confirmation, and responsive mobile layout.

**Architecture:** New `WizardPanel` component replaces `Modal` as the wizard container. The `MigrationWizard` component is restructured with a sidebar stepper for desktop full-screen, horizontal stepper for restored mode, and progress bar for mobile. State safety via dirty detection and `ConfirmModal`.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, lucide-react icons

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/ui/WizardPanel.jsx` | Create | Full-screen/restored panel container with title bar, maximize/restore toggle, focus trap, animations |
| `src/hooks/useFocusTrap.js` | Modify | Add `disableEscape` option for progress/summary steps |
| `src/hooks/useMigrationWizard.js` | Modify | Add `isDirty` computed property |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Rewrite | Use WizardPanel, sidebar stepper, mobile progress bar, dirty-state confirmation |

---

### Task 1: Update useFocusTrap — Add Conditional Escape

**Files:**

- Modify: `src/hooks/useFocusTrap.js`

- [ ] **Step 1: Update useFocusTrap to accept options object**

Replace the current `useFocusTrap` signature to accept an options parameter with `disableEscape`:

```jsx
// src/hooks/useFocusTrap.js
import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(isOpen, onClose, options = {}) {
    const { disableEscape = false } = options
    const ref = useRef(null)
    const previouslyFocusedRef = useRef(null)

    useEffect(() => {
        if (!isOpen) return

        previouslyFocusedRef.current = document.activeElement

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (!disableEscape) onClose()
                return
            }
            if (e.key !== 'Tab') return

            const modal = ref.current
            if (!modal) return

            const focusable = Array.from(modal.querySelectorAll(FOCUSABLE))
            if (!focusable.length) return

            const first = focusable[0]
            const last = focusable[focusable.length - 1]

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault()
                    last.focus()
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        const timer = setTimeout(() => {
            const firstFocusable = ref.current?.querySelector(FOCUSABLE)
            if (firstFocusable) {
                firstFocusable.focus()
            } else if (ref.current) {
                ref.current.setAttribute('tabindex', '-1')
                ref.current.focus()
            }
        }, 50)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            clearTimeout(timer)
            if (previouslyFocusedRef.current?.focus) {
                previouslyFocusedRef.current.focus()
            }
        }
    }, [isOpen, onClose, disableEscape])

    return ref
}
```

The existing callers (`Modal`, `ConfirmModal`) pass no third argument, so the default `{}` keeps them working unchanged.

- [ ] **Step 2: Verify no lint warnings**

Run: `npx eslint src/hooks/useFocusTrap.js --no-error-on-unmatched-pattern`
Expected: No errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFocusTrap.js
git commit -m "feat(a11y): add disableEscape option to useFocusTrap"
```

---

### Task 2: Update useMigrationWizard — Add isDirty

**Files:**

- Modify: `src/hooks/useMigrationWizard.js`

- [ ] **Step 1: Add isDirty computed property**

After the `currentStep` derivation (around line 178), add:

```jsx
const isDirty = useMemo(() => {
  if (!source.sourceType) return false
  // Any credentials entered
  if (source.pat || source.authToken || source.authUsername || source.authPassword) return true
  // Azure: org/project filled
  if (source.org || source.project) return true
  // URL flows: URL entered
  if (source.sourceUrl || source.githubSourceUrl) return true
  // Target configured
  if (source.targetName || source.targetOrg) return true
  // Repos selected
  if (repos.some((r) => r.selected)) return true
  // Work items or wiki enabled
  if (workItems.enabled || wiki.enabled) return true
  // Past sourceType step
  if (currentStepIndex > 1) return true
  return false
}, [source, repos, workItems.enabled, wiki.enabled, currentStepIndex])
```

Add `isDirty` to the returned object:

```jsx
return {
  // Step navigation
  steps,
  currentStep,
  currentStepIndex,
  // ... existing properties ...
  isDirty,
  // Actions
  resetWizard,
}
```

- [ ] **Step 2: Verify no lint warnings**

Run: `npx eslint src/hooks/useMigrationWizard.js --no-error-on-unmatched-pattern`
Expected: No errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMigrationWizard.js
git commit -m "feat(wizard): add isDirty computed state for close confirmation"
```

---

### Task 3: Create WizardPanel Component

**Files:**

- Create: `src/components/ui/WizardPanel.jsx`

- [ ] **Step 1: Create WizardPanel with full-screen/restored modes**

```jsx
// src/components/ui/WizardPanel.jsx
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

const panelVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 40 },
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
}

export function WizardPanel({
  isOpen,
  onClose,
  title,
  icon: Icon,
  stepInfo,
  sidebar,
  footer,
  children,
  disableEscape = false,
}) {
  const [isMaximized, setIsMaximized] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const panelRef = useFocusTrap(isOpen, onClose, { disableEscape })

  // Track viewport width for mobile detection
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Mobile keyboard scroll fix
  useEffect(() => {
    if (!isOpen) return
    const handleFocus = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 300)
      }
    }
    const el = panelRef.current
    el?.addEventListener('focusin', handleFocus)
    return () => el?.removeEventListener('focusin', handleFocus)
  }, [isOpen, panelRef])

  const toggleMaximize = useCallback(() => setIsMaximized((v) => !v), [])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const effectiveMaximized = isMobile || isMaximized

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — only in restored mode */}
          {!effectiveMaximized && (
            <motion.div
              key="wizard-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 backdrop-blur-sm"
              aria-hidden="true"
            />
          )}

          {/* Panel */}
          <motion.div
            key="wizard-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-panel-title"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ type: 'spring', duration: 0.45, bounce: 0.18 }}
            className={`
              fixed z-50 flex flex-col
              ${effectiveMaximized
                ? 'inset-0 bg-white dark:bg-slate-950'
                : 'inset-4 md:inset-8 lg:inset-y-[4vh] lg:inset-x-auto lg:w-[min(90vw,1200px)] lg:mx-auto rounded-2xl md:rounded-3xl shadow-2xl border border-white/20 dark:border-slate-700/50 bg-white/98 dark:bg-slate-950/98 backdrop-blur-2xl'
              }
              transition-[border-radius] duration-300
            `}
          >
            {/* Title Bar */}
            <div className="flex-shrink-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center h-12 md:h-14 px-4 md:px-5 gap-3">
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <div className="bg-white/15 p-1.5 md:p-2 rounded-lg backdrop-blur-sm flex-shrink-0">
                    <Icon className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2.5} />
                  </div>
                )}
                <h2 id="wizard-panel-title" className="text-sm md:text-base font-bold truncate">
                  {title}
                </h2>
              </div>

              {/* Center: Step Info */}
              {stepInfo && (
                <div className="hidden md:flex flex-1 justify-center min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={stepInfo.title}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="text-center"
                    >
                      <p className="text-sm font-semibold text-white/95 truncate">{stepInfo.title}</p>
                      {stepInfo.subtitle && (
                        <p className="text-[11px] text-white/65 truncate">{stepInfo.subtitle}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}

              {/* Right: Controls */}
              <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                {!isMobile && (
                  <button
                    type="button"
                    onClick={toggleMaximize}
                    className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors"
                    aria-label={isMaximized ? 'Restore wizard size' : 'Maximize wizard'}
                  >
                    <motion.div
                      animate={{ rotate: isMaximized ? 0 : 180 }}
                      transition={{ duration: 0.3 }}
                    >
                      {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </motion.div>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors"
                  aria-label="Close wizard"
                >
                  <X className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Sidebar — desktop fullscreen only */}
              {sidebar && effectiveMaximized && !isMobile && (
                <motion.aside
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: 0.1 }}
                  className="flex-shrink-0 w-60 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/60 dark:border-slate-800/50 overflow-y-auto custom-scrollbar"
                >
                  {sidebar}
                </motion.aside>
              )}

              {/* Main content area */}
              <div className="flex flex-1 flex-col min-w-0 min-h-0">
                {/* Content scrollable area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {children}
                </div>

                {/* Footer — pinned to bottom of content area */}
                {footer && (
                  <div className="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-700/40 safe-area-bottom">
                    {footer}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Verify no lint warnings**

Run: `npx eslint src/components/ui/WizardPanel.jsx --no-error-on-unmatched-pattern`
Expected: No errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/WizardPanel.jsx
git commit -m "feat(ui): create WizardPanel full-screen container component"
```

---

### Task 4: Rewrite MigrationWizard to Use WizardPanel

**Files:**

- Rewrite: `src/components/MigrationWizard/MigrationWizard.jsx`

This is the largest task. The component is restructured to:
1. Use `WizardPanel` instead of `Modal`
2. Render a sidebar stepper (desktop fullscreen) or horizontal stepper (restored) or mobile progress bar
3. Show a `ConfirmModal` on close/cancel when dirty
4. Disable Escape during progress/summary

- [ ] **Step 1: Rewrite MigrationWizard.jsx**

```jsx
import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WizardPanel } from '../ui/WizardPanel'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useMigrationWizard } from '../../hooks/useMigrationWizard'
import { useAzureOAuth } from '../../hooks/useAzureOAuth'
import { migrationApi } from '../../api/migration'
import SourceTypeStep from './steps/SourceTypeStep'
import SourceStep from './steps/SourceStep'
import UrlInputStep from './steps/UrlInputStep'
import GitHubSourceStep from './steps/GitHubSourceStep'
import TargetConfigStep from './steps/TargetConfigStep'
import RepoSelectStep from './steps/RepoSelectStep'
import RepoConfigStep from './steps/RepoConfigStep'
import WorkItemsStep from './steps/WorkItemsStep'
import WikiStep from './steps/WikiStep'
import AIReviewStep from './steps/AIReviewStep'
import ScheduleStep from './steps/ScheduleStep'
import ProgressStep from './steps/ProgressStep'
import SimpleProgressStep from './steps/SimpleProgressStep'
import SummaryStep from './steps/SummaryStep'
import BreadcrumbNav from './BreadcrumbNav'
import {
  ArrowLeft, ArrowRight, Rocket, Download, AlertCircle,
  Check, Circle,
} from 'lucide-react'

const STEP_LABELS = {
  sourceType: 'Source',
  azureConnect: 'Connect',
  urlInput: 'URL',
  githubSource: 'Source',
  targetConfig: 'Target',
  repoSelect: 'Repos',
  repoConfig: 'Configure',
  workItems: 'Work Items',
  wiki: 'Wiki',
  aiReview: 'AI Review',
  schedule: 'Schedule',
  progress: 'Progress',
  summary: 'Summary',
}

const STEP_META = {
  sourceType:   { title: 'Choose Source',            subtitle: 'Select where to import your repositories from.' },
  azureConnect: { title: 'Connect to Azure DevOps',  subtitle: 'Enter your organization and credentials.' },
  urlInput:     { title: 'Repository URL',            subtitle: 'Enter the clone URL of the Git repository.' },
  githubSource: { title: 'GitHub Repository',         subtitle: 'Enter the GitHub repository to import.' },
  targetConfig: { title: 'Target Configuration',      subtitle: 'Configure where to import the repository.' },
  repoSelect:   { title: 'Select Repositories',       subtitle: 'Choose which repositories to migrate.' },
  repoConfig:   { title: 'Configure Repositories',    subtitle: 'Set target names and options for each repo.' },
  workItems:    { title: 'Work Items',                subtitle: 'Configure work item migration settings.' },
  wiki:         { title: 'Wiki',                      subtitle: 'Configure wiki migration settings.' },
  aiReview:     { title: 'AI Review',                 subtitle: 'Review the migration plan with AI assistance.' },
  schedule:     { title: 'Schedule',                  subtitle: 'Choose when to run the migration.' },
  progress:     { title: 'Migration in Progress',     subtitle: 'Your migration is running.' },
  summary:      { title: 'Migration Complete',        subtitle: 'Review the results of your migration.' },
}

const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -80 : 80, opacity: 0 }),
}

/* ------------------------------------------------------------------ */
/*  Sidebar Stepper (desktop fullscreen)                               */
/* ------------------------------------------------------------------ */
function SidebarStepper({ steps, currentStepIndex, onGoToStep, source, selectedCount, onBreadcrumbNavigate, currentStep }) {
  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb (Azure only) */}
      <div className="px-4 pt-4">
        <BreadcrumbNav
          source={source}
          currentStep={currentStep}
          selectedCount={selectedCount}
          onNavigate={onBreadcrumbNavigate}
        />
      </div>

      {/* Step list */}
      <nav aria-label="Wizard steps" className="flex-1 px-3 py-4 overflow-y-auto custom-scrollbar">
        <ol className="space-y-1">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex
            const isCompleted = index < currentStepIndex
            const label = STEP_LABELS[step] || step

            return (
              <li key={step}>
                <button
                  type="button"
                  onClick={() => onGoToStep(step)}
                  disabled={!isCompleted}
                  aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200
                    ${isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-800/50'
                      : isCompleted
                        ? 'hover:bg-slate-100 dark:hover:bg-slate-800/50 cursor-pointer'
                        : 'opacity-50 cursor-default'
                    }
                  `}
                >
                  {/* Step circle */}
                  <span className={`
                    flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 transition-all
                    ${isActive
                      ? 'w-8 h-8 bg-indigo-500 text-white ring-4 ring-indigo-500/20'
                      : isCompleted
                        ? 'w-6 h-6 bg-emerald-500 text-white'
                        : 'w-6 h-6 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                    }
                  `}>
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : index + 1}
                  </span>

                  {/* Label */}
                  <span className={`
                    text-sm font-medium truncate
                    ${isActive
                      ? 'text-indigo-700 dark:text-indigo-300'
                      : isCompleted
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-slate-400 dark:text-slate-500'
                    }
                  `}>
                    {label}
                  </span>
                </button>

                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <div className={`w-0.5 h-3 rounded-full transition-colors ${isCompleted ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Horizontal Stepper (desktop restored mode)                         */
/* ------------------------------------------------------------------ */
function HorizontalStepper({ steps, currentStepIndex, onGoToStep }) {
  return (
    <nav aria-label="Wizard steps" className="px-6 pt-4 pb-2">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isActive = index === currentStepIndex
          const isCompleted = index < currentStepIndex
          const label = STEP_LABELS[step] || step
          return (
            <li key={step} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => onGoToStep(step)}
                  disabled={!isCompleted}
                  aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    flex items-center justify-center rounded-full text-xs font-bold transition-all
                    ${isActive
                      ? 'w-7 h-7 bg-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                      : isCompleted
                        ? 'w-5 h-5 bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                        : 'w-5 h-5 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                    }
                  `}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : index + 1}
                </button>
                <span className={`mt-1 text-[10px] font-medium truncate max-w-[52px] text-center
                  ${isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${isCompleted ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/*  Mobile Progress Bar                                                */
/* ------------------------------------------------------------------ */
function MobileProgressBar({ steps, currentStepIndex }) {
  const progress = steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 0
  const label = STEP_LABELS[steps[currentStepIndex]] || ''
  return (
    <div className="px-4 pt-3 pb-2">
      {/* Progress bar */}
      <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      </div>
      {/* Step label */}
      <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
        Step {currentStepIndex + 1} of {steps.length} — {label}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Wizard Component                                              */
/* ------------------------------------------------------------------ */
export default function MigrationWizard({ onClose, orgs = [] }) {
  const wizard = useMigrationWizard()

  const {
    steps,
    currentStep,
    currentStepIndex,
    nextStep,
    prevStep,
    goToStep,
    canGoBack,
    canGoNext,
    error,
    source,
    updateSource,
    repos,
    setRepos,
    updateRepo,
    workItems,
    updateWorkItems,
    wiki,
    updateWiki,
    aiPlan,
    updateAiPlan,
    schedule,
    updateSchedule,
    planId,
    importJobs,
    updateImportJobs,
    resetWizard,
    isDirty,
  } = wizard

  const oauthHook = useAzureOAuth()
  const selectedRepos = repos.filter((r) => r.selected)
  const [direction, setDirection] = useState(1)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isMaximizedState, setIsMaximizedState] = useState(true)

  // Track mobile breakpoint
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const handleNext = () => { setDirection(1); nextStep() }
  const handleBack = () => { setDirection(-1); prevStep() }

  // Auto-advance when sourceType is set on the sourceType step.
  const prevSourceType = useRef(source.sourceType)
  useEffect(() => {
    if (source.sourceType && !prevSourceType.current && currentStepIndex === 0) {
      Promise.resolve().then(() => {
        setDirection(1)
        nextStep()
      })
    }
    prevSourceType.current = source.sourceType
  }, [source.sourceType, currentStepIndex, steps.length, nextStep])

  // Breadcrumb navigation for Azure flow
  const handleBreadcrumbNavigate = useCallback((target) => {
    setDirection(-1)
    if (target === 'org') {
      updateSource({ project: '', validated: false })
      setRepos([])
      goToStep('azureConnect')
    } else if (target === 'project') {
      setRepos([])
      goToStep('azureConnect')
    }
  }, [updateSource, setRepos, goToStep])

  // Start import for URL/GitHub flows
  const handleStartImport = useCallback(async () => {
    updateImportJobs({ importing: true })
    setDirection(1)

    try {
      let endpoint, body

      if (source.sourceType === 'github') {
        endpoint = '/api/import/url'
        body = {
          sourceUrl: source.githubSourceUrl,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.githubSourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      } else {
        endpoint = '/api/import/url'
        let credentials
        if (source.authType === 'token') credentials = { type: 'token', token: source.authToken }
        else if (source.authType === 'basic') credentials = { type: 'basic', username: source.authUsername, password: source.authPassword }

        body = {
          sourceUrl: source.sourceUrl,
          credentials,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.sourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.success) {
        updateImportJobs({ jobId: data.jobId })
        nextStep()
      } else {
        updateImportJobs({
          importing: false,
          jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
        })
        nextStep()
      }
    } catch (e) {
      updateImportJobs({
        importing: false,
        jobStatus: { status: 'failed', errorMessage: e.message, progressPct: 0 },
      })
      nextStep()
    }
  }, [source, updateImportJobs, nextStep])

  // Close with dirty-state confirmation
  const handleClose = useCallback(() => {
    if (currentStep === 'summary') {
      onClose()
      return
    }
    if (isDirty) {
      setShowConfirm(true)
    } else {
      onClose()
    }
  }, [isDirty, currentStep, onClose])

  const handleConfirmClose = useCallback(() => {
    setShowConfirm(false)
    onClose()
  }, [onClose])

  function renderStep() {
    switch (currentStep) {
      case 'sourceType':
        return <SourceTypeStep source={source} onChange={updateSource} />
      case 'azureConnect':
        return <SourceStep source={source} onChange={updateSource} oauthHook={oauthHook} />
      case 'urlInput':
        return <UrlInputStep source={source} onChange={updateSource} />
      case 'githubSource':
        return <GitHubSourceStep source={source} onChange={updateSource} />
      case 'targetConfig':
        return (
          <TargetConfigStep
            source={source}
            onChange={updateSource}
            orgs={orgs}
            importJobs={importJobs}
            onUpdateImportJobs={updateImportJobs}
            onStartImport={handleStartImport}
          />
        )
      case 'repoSelect':
        return <RepoSelectStep repos={repos} onSetRepos={setRepos} source={source} onChange={updateSource} />
      case 'repoConfig':
        return (
          <RepoConfigStep
            repos={selectedRepos}
            onUpdateRepo={(selectedIndex, updates) => {
              const originalIndex = repos.findIndex(
                (r) => r.name === selectedRepos[selectedIndex]?.name
              )
              if (originalIndex !== -1) updateRepo(originalIndex, updates)
            }}
            source={source}
          />
        )
      case 'workItems':
        return <WorkItemsStep workItems={workItems} onUpdate={updateWorkItems} source={source} />
      case 'wiki':
        return <WikiStep wiki={wiki} onUpdate={updateWiki} source={source} />
      case 'aiReview':
        return <AIReviewStep aiPlan={aiPlan} onUpdate={updateAiPlan} wizard={wizard} />
      case 'schedule':
        return <ScheduleStep schedule={schedule} onUpdate={updateSchedule} wizard={wizard} />
      case 'progress':
        if (source.sourceType === 'azure') {
          return (
            <ProgressStep
              planId={planId}
              onPause={() => {}}
              onCancel={() => {}}
              onRetryTask={(taskId) => {
                if (planId) migrationApi.retryTask(planId, taskId).catch(() => {})
              }}
            />
          )
        }
        return (
          <SimpleProgressStep
            importJobs={importJobs}
            onUpdate={updateImportJobs}
            source={source}
          />
        )
      case 'summary':
        return (
          <SummaryStep
            planId={planId}
            onNewMigration={resetWizard}
            onViewHistory={onClose}
          />
        )
      default:
        return (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">Unknown Step</p>
          </div>
        )
    }
  }

  const isAzure = source.sourceType === 'azure'
  const wizardTitle = isAzure ? 'Migration Wizard' : 'Import Repository'
  const wizardIcon = isAzure ? Rocket : Download
  const disableEscape = currentStep === 'progress' || currentStep === 'summary'

  const hideNextButton = currentStep === 'sourceType'
    || currentStep === 'targetConfig'
    || currentStep === 'progress'
    || currentStep === 'summary'

  const isProgressOrSummary = currentStep === 'progress' || currentStep === 'summary'
  const confirmMessage = currentStep === 'progress'
    ? 'A migration is in progress. Closing will not stop it, but you will lose visibility of the progress. Are you sure?'
    : 'You have unsaved progress. All entered data will be lost.'

  // Determine if sidebar should show (has sourceType selected)
  const showSidebar = !!source.sourceType
  const effectiveMaximized = isMobile || isMaximizedState

  // Footer
  const footer = (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={canGoBack ? handleBack : handleClose}
        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
          text-slate-600 dark:text-slate-300
          bg-slate-100 dark:bg-slate-800
          hover:bg-slate-200 dark:hover:bg-slate-700
          transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {canGoBack ? 'Back' : 'Cancel'}
      </button>

      {canGoNext && !hideNextButton && (
        <button
          type="button"
          onClick={handleNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl
            text-white
            bg-gradient-to-r from-indigo-500 to-purple-600
            hover:from-indigo-600 hover:to-purple-700
            shadow-lg shadow-indigo-500/25
            transition-all"
        >
          Next
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )

  // Sidebar content
  const sidebar = showSidebar ? (
    <SidebarStepper
      steps={steps}
      currentStepIndex={currentStepIndex}
      onGoToStep={goToStep}
      source={source}
      selectedCount={selectedRepos.length}
      onBreadcrumbNavigate={handleBreadcrumbNavigate}
      currentStep={currentStep}
    />
  ) : null

  return (
    <>
      <WizardPanel
        isOpen={true}
        onClose={handleClose}
        title={wizardTitle}
        icon={wizardIcon}
        stepInfo={STEP_META[currentStep] || null}
        sidebar={sidebar}
        footer={isProgressOrSummary ? null : footer}
        disableEscape={disableEscape}
      >
        <div role="form" aria-label={wizardTitle} className="p-4 md:p-6 lg:p-8">
          {/* Horizontal stepper — desktop restored mode only */}
          {showSidebar && !effectiveMaximized && !isMobile && (
            <HorizontalStepper
              steps={steps}
              currentStepIndex={currentStepIndex}
              onGoToStep={goToStep}
            />
          )}

          {/* Mobile progress bar */}
          {showSidebar && isMobile && (
            <MobileProgressBar steps={steps} currentStepIndex={currentStepIndex} />
          )}

          {/* Step title/subtitle — shown in content area on mobile and restored mode */}
          {STEP_META[currentStep] && (isMobile || !effectiveMaximized) && (
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {STEP_META[currentStep].title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {STEP_META[currentStep].subtitle}
              </p>
            </div>
          )}

          {/* Step title — desktop fullscreen (no subtitle, shown in title bar) */}
          {STEP_META[currentStep] && effectiveMaximized && !isMobile && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {STEP_META[currentStep].title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {STEP_META[currentStep].subtitle}
              </p>
            </div>
          )}

          {/* Breadcrumb — mobile and restored mode (sidebar handles it in fullscreen) */}
          {(isMobile || !effectiveMaximized) && (
            <BreadcrumbNav
              source={source}
              currentStep={currentStep}
              selectedCount={selectedRepos.length}
              onNavigate={handleBreadcrumbNavigate}
            />
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step Content with Animation */}
          <div className={`relative ${effectiveMaximized && !isMobile ? 'max-w-3xl mx-auto' : ''}`}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </WizardPanel>

      {/* Dirty state confirmation modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmClose}
        title="Cancel Migration?"
        message={confirmMessage}
        confirmText="Discard & Close"
        cancelText="Continue Editing"
        variant="warning"
      />
    </>
  )
}
```

- [ ] **Step 2: Verify no lint warnings**

Run: `npx eslint src/components/MigrationWizard/MigrationWizard.jsx --no-error-on-unmatched-pattern`
Expected: No errors or warnings.

- [ ] **Step 3: Verify the app builds without errors**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx
git commit -m "feat(wizard): rewrite as full-screen panel with sidebar stepper and state safety"
```

---

### Task 5: Validate — Lint, Build, Tests

- [ ] **Step 1: Run full ESLint**

Run: `npx eslint src/ --no-error-on-unmatched-pattern`
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Run full build**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass. If the `useMigrationWizard.test.jsx` test needs updating for `isDirty`, update it.

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -A
git commit -m "chore(wizard): fix lint and test issues from panel rewrite"
```
