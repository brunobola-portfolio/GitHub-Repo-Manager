import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, Circle, ChevronRight } from 'lucide-react'
import { SpinnerIcon } from '../../ui/Spinner'
import { classifyProvider, PROVIDERS } from '../../../utils/azureProvider'

/**
 * Step-by-step connection status. Replaces ad-hoc status messages with a
 * single canonical surface that always tells the user exactly where the
 * validation is and what failed (if anything).
 *
 * Step order:
 *   1. Parse URL              (sync, succeeds once host+org set)
 *   2. Validate host          (allowlist + DNS)
 *   3. Authenticate           (PAT vs server)
 *   4. List projects          (REST call)
 *
 * Props expose only the bits the parent already tracks; the panel itself
 * is stateless and derives each step's status from them.
 */
export default function ConnectionStatusPanel({
  host,
  org,
  credentialReady,
  validating,
  validated,
  validationError,
  projectsCount,
}) {
  const provider = classifyProvider(host)

  // Derive step states from the parent's primary fields. Order matters —
  // a later step is "pending" until all earlier steps have succeeded.
  const parseStep = (host && org) ? 'ok' : 'pending'
  const credStep = !credentialReady ? 'pending' : 'ok'

  let validateStep = 'pending'
  let projectsStep = 'pending'
  if (parseStep === 'ok' && credStep === 'ok') {
    if (validating) {
      validateStep = 'loading'
    } else if (validationError) {
      validateStep = 'error'
    } else if (validated) {
      validateStep = 'ok'
      projectsStep = (projectsCount > 0) ? 'ok' : (projectsCount === 0 ? 'warn' : 'pending')
    }
  }

  // Don't render anything when there's nothing meaningful to show — keeps
  // the form clean before the user pastes a URL.
  const hasAnything = host || org || credentialReady || validating || validated || validationError
  if (!hasAnything) return null

  const steps = [
    {
      key: 'parse',
      label: 'URL detectada',
      detail: (host && org) ? `${provider.label} · ${host}/${org}` : 'À espera do paste…',
      status: parseStep,
    },
    {
      key: 'creds',
      label: 'Credenciais prontas',
      detail: credentialReady ? 'Pronto a autenticar' : 'Configura PAT ou OAuth abaixo',
      status: credStep,
    },
    {
      key: 'validate',
      label: 'Autenticar contra o servidor',
      detail: validateStep === 'loading'
        ? `A contactar ${host}…`
        : validateStep === 'error'
          ? validationError
          : validateStep === 'ok'
            ? 'PAT aceite'
            : 'Aguarda passo anterior',
      status: validateStep,
    },
    {
      key: 'projects',
      label: 'Listar projectos',
      detail: projectsStep === 'ok'
        ? `${projectsCount} projecto${projectsCount === 1 ? '' : 's'} carregado${projectsCount === 1 ? '' : 's'}`
        : projectsStep === 'warn'
          ? 'Zero projectos visíveis (scope insuficiente?)'
          : 'Aguarda autenticação',
      status: projectsStep,
    },
  ]

  const overall = deriveOverall(steps)

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`rounded-2xl border ${overall.bg} ${overall.border}`}
    >
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${overall.border}`}>
        <div className="w-2 h-2 rounded-full bg-current opacity-70" />
        <span className={`text-xs font-semibold uppercase tracking-wider ${overall.text}`}>
          {overall.label}
        </span>
        {provider.type === PROVIDERS.ON_PREM && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-violet-500 dark:text-violet-400">
            on-premises
          </span>
        )}
      </div>
      <ol className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
        {steps.map((step, idx) => (
          <StepRow key={step.key} step={step} index={idx + 1} />
        ))}
      </ol>
    </motion.div>
  )
}

function StepRow({ step, index }) {
  const tone = stepToneClasses(step.status)
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${tone.bg} ${tone.text} text-[10px] font-bold`}>
        <StepIcon status={step.status} index={index} />
      </div>
      <div className="min-w-0 flex-1 -mt-0.5">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          {step.label}
          {step.status === 'pending' && (
            <ChevronRight className="w-3 h-3 text-slate-400" />
          )}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={step.detail}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`text-xs mt-0.5 ${tone.detailText}`}
          >
            {step.detail}
          </motion.div>
        </AnimatePresence>
      </div>
    </li>
  )
}

function StepIcon({ status, index }) {
  if (status === 'pending') return <span>{index}</span>
  if (status === 'ok') return <CheckCircle2 className="w-3.5 h-3.5" />
  if (status === 'error') return <XCircle className="w-3.5 h-3.5" />
  if (status === 'warn') return <AlertTriangle className="w-3.5 h-3.5" />
  if (status === 'loading') return <SpinnerIcon className="w-3.5 h-3.5" />
  return <Circle className="w-3.5 h-3.5" />
}

function stepToneClasses(status) {
  switch (status) {
    case 'ok':
      return {
        bg: 'bg-emerald-100 dark:bg-emerald-900/30',
        text: 'text-emerald-600 dark:text-emerald-400',
        detailText: 'text-emerald-700 dark:text-emerald-300',
      }
    case 'error':
      return {
        bg: 'bg-red-100 dark:bg-red-900/30',
        text: 'text-red-600 dark:text-red-400',
        detailText: 'text-red-700 dark:text-red-300',
      }
    case 'warn':
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        text: 'text-amber-600 dark:text-amber-400',
        detailText: 'text-amber-700 dark:text-amber-300',
      }
    case 'loading':
      return {
        bg: 'bg-indigo-100 dark:bg-indigo-900/30',
        text: 'text-indigo-600 dark:text-indigo-400',
        detailText: 'text-indigo-700 dark:text-indigo-300',
      }
    default:
      return {
        bg: 'bg-slate-100 dark:bg-slate-800',
        text: 'text-slate-500 dark:text-slate-400',
        detailText: 'text-slate-500 dark:text-slate-400',
      }
  }
}

function deriveOverall(steps) {
  if (steps.some((s) => s.status === 'error')) {
    return {
      label: 'Conexão falhou',
      bg: 'bg-red-50/50 dark:bg-red-950/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-700 dark:text-red-300',
    }
  }
  if (steps.some((s) => s.status === 'loading')) {
    return {
      label: 'A validar conexão…',
      bg: 'bg-indigo-50/50 dark:bg-indigo-950/20',
      border: 'border-indigo-200 dark:border-indigo-800',
      text: 'text-indigo-700 dark:text-indigo-300',
    }
  }
  if (steps.every((s) => s.status === 'ok')) {
    return {
      label: 'Conexão pronta',
      bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
      border: 'border-emerald-200 dark:border-emerald-800',
      text: 'text-emerald-700 dark:text-emerald-300',
    }
  }
  if (steps.some((s) => s.status === 'warn')) {
    return {
      label: 'Conectado com avisos',
      bg: 'bg-amber-50/50 dark:bg-amber-950/20',
      border: 'border-amber-200 dark:border-amber-800',
      text: 'text-amber-700 dark:text-amber-300',
    }
  }
  return {
    label: 'A preparar conexão',
    bg: 'bg-slate-50 dark:bg-slate-900/40',
    border: 'border-slate-200 dark:border-slate-700',
    text: 'text-slate-600 dark:text-slate-400',
  }
}
