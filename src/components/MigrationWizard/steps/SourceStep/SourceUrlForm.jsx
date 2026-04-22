import { AnimatePresence, motion } from 'framer-motion'
import { Link2, Cloud, FolderGit2, X } from 'lucide-react'
import { parseAzureUrl } from '../../../../utils/azureUrlParser'

/**
 * Smart Azure DevOps URL paste field with preview confirmation.
 *
 * Presents detected (org / project / repo) slices and lets the user apply
 * or discard. Parsing itself lives in `parseAzureUrl`; this component only
 * renders the input + preview UI.
 */
export default function SourceUrlForm({
  smartPasteValue,
  urlPreview,
  onInput,
  onApply,
  onDismiss,
}) {
  const parsedBadge = smartPasteValue ? parseAzureUrl(smartPasteValue) : null

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
        Paste Azure DevOps URL <span className="text-slate-400 font-normal">(optional)</span>
      </label>
      <div className="relative">
        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={smartPasteValue}
          onChange={(e) => onInput(e.target.value)}
          placeholder="https://dev.azure.com/org/project or org/project/repo"
          className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
        />
      </div>

      <AnimatePresence>
        {urlPreview && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">URL detectada:</span>
              <div className="flex items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                {urlPreview.org && (
                  <span className="flex items-center gap-1">
                    <Cloud className="w-3 h-3" /> {urlPreview.org}
                  </span>
                )}
                {urlPreview.project && (
                  <>
                    <span className="text-slate-400">→</span>
                    <span className="flex items-center gap-1">
                      <FolderGit2 className="w-3 h-3" /> {urlPreview.project}
                    </span>
                  </>
                )}
                {urlPreview.repo && (
                  <>
                    <span className="text-slate-400">→</span>
                    <span>{urlPreview.repo}</span>
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={onApply}
                  className="px-2 py-0.5 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                >
                  Preencher
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  aria-label="Descartar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!urlPreview && parsedBadge?.error && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{parsedBadge.error}</p>
      )}
    </div>
  )
}
