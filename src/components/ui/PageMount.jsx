import { motion } from 'framer-motion'

/**
 * PageMount — Canonical mount animation for page-level surfaces.
 *
 * Replaces ad-hoc `animate-in fade-in duration-500` and bespoke Framer
 * stagger blocks across Dashboard / RepoDetail / WorkBoard. Pick this as
 * the single source of truth for "page just rendered" motion.
 *
 * Use:
 *   <PageMount>
 *     <PageMount.Item>...</PageMount.Item>
 *     <PageMount.Item>...</PageMount.Item>
 *   </PageMount>
 *
 * The wrapper alone (no .Item children) still fades + lifts the whole tree.
 */
const VARIANTS = {
    hidden: { opacity: 0, y: 8 },
    show: {
        opacity: 1,
        y: 0,
        transition: { staggerChildren: 0.04, delayChildren: 0.04 },
    },
}

const ITEM = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
}

export function PageMount({ children, className = '', ...rest }) {
    return (
        <motion.div
            initial="hidden"
            animate="show"
            variants={VARIANTS}
            className={className}
            {...rest}
        >
            {children}
        </motion.div>
    )
}

PageMount.Item = function PageMountItem({ children, className = '', ...rest }) {
    return (
        <motion.div variants={ITEM} className={className} {...rest}>
            {children}
        </motion.div>
    )
}
