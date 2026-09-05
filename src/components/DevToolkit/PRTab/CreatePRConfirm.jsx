import { motion } from 'framer-motion'
import { Button } from '../../ui/Button'

export function CreatePRConfirm({ action = 'create', onConfirm, onCancel, loading }) {
    const labels = {
        create: { title: 'Create Pull Request?', btn: 'Create PR', color: 'text-white bg-emerald-600 hover:bg-emerald-700' },
        update: { title: 'Update PR Description?', btn: 'Update PR', color: 'ds-brand-solid' },
    }
    const cfg = labels[action] || labels.create

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
        >
            <span className="text-xs text-slate-600 dark:text-slate-300">{cfg.title}</span>
            <Button type="button" variant="ghost" size="xs" onClick={onCancel} disabled={loading}>Cancel</Button>
            <button type="button" onClick={onConfirm} disabled={loading} className={`px-3 py-1 text-xs font-medium rounded-md ${cfg.color} disabled:opacity-50 ds-focus-ring`}>
                {loading ? 'Working...' : cfg.btn}
            </button>
        </motion.div>
    )
}
