import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE } from './motion'

/**
 * PageMount — Canonical mount animation for page-level surfaces.
 *
 * Replaces ad-hoc `animate-in fade-in duration-500` and bespoke Framer
 * stagger blocks across Dashboard / RepoDetail / WorkBoard. Pick this as
 * the single source of truth for "page just rendered" motion.
 *
 * Honors `prefers-reduced-motion`: when reduced, we drop the stagger and
 * y-offset and just fade in quickly so the surface is usable.
 *
 * Use:
 *   <PageMount>
 *     <PageMount.Item>...</PageMount.Item>
 *     <PageMount.Item>...</PageMount.Item>
 *   </PageMount>
 *
 * The wrapper alone (no .Item children) still fades + lifts the whole tree.
 */
const VARIANTS_NORMAL = {
    hidden: { opacity: 0, y: 8 },
    show: {
        opacity: 1,
        y: 0,
        transition: { staggerChildren: 0.04, delayChildren: 0.04 },
    },
}

const VARIANTS_REDUCED = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: DURATION.fast } },
}

const ITEM_NORMAL = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE.emphasized } },
}

const ITEM_REDUCED = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: DURATION.fast } },
}

export function PageMount({ children, className = '', ...rest }) {
    const reduced = useReducedMotion()
    return (
        <motion.div
            initial="hidden"
            animate="show"
            variants={reduced ? VARIANTS_REDUCED : VARIANTS_NORMAL}
            className={className}
            {...rest}
        >
            {children}
        </motion.div>
    )
}

PageMount.Item = function PageMountItem({ children, className = '', ...rest }) {
    const reduced = useReducedMotion()
    return (
        <motion.div variants={reduced ? ITEM_REDUCED : ITEM_NORMAL} className={className} {...rest}>
            {children}
        </motion.div>
    )
}
