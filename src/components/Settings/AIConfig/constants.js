// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEST_COOLDOWN_S = 10

// Providers that lack native embeddings → show embedding override section
export const PROVIDERS_NEEDING_EMBEDDING_OVERRIDE = ['anthropic', 'openrouter']

// ---------------------------------------------------------------------------
// Shared input classes
// ---------------------------------------------------------------------------

export const INPUT_CLS =
    'w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl ' +
    'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 ' +
    'placeholder-slate-400 dark:placeholder-slate-500 ' +
    'focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition'

export const LABEL_CLS = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1'
