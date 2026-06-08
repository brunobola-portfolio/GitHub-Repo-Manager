import { useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Height/opacity collapse wrapper that releases `overflow` once it has fully
 * opened. Floating children (dropdowns, popovers) positioned `absolute` would
 * otherwise be clipped by the `overflow: hidden` that the height animation
 * needs while it runs — making a menu read as part of the card rather than a
 * panel floating above it.
 *
 * The behaviour mirrors `CollapsiblePanel`: clip while animating, reveal when
 * settled. Drop-in replacement for the common
 *   <motion.section initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={...} className="overflow-hidden …">
 * pattern whenever the collapsible contains a dropdown.
 *
 * @param {'section'|'div'} [props.as='section'] - Motion element tag.
 * @param {number} [props.duration=0.2] - Animation duration in seconds.
 */
export function RevealSection({ as = 'section', children, className = '', duration = 0.2, ...rest }) {
    const MotionTag = motion[as]
    // 'hidden' while collapsed/animating; 'visible' once fully open so an
    // absolutely-positioned dropdown can spill past the card edge.
    const [overflow, setOverflow] = useState('hidden')

    return (
        <MotionTag
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration }}
            onAnimationStart={() => setOverflow('hidden')}
            onAnimationComplete={(def) => {
                // Only reveal when settling into the open state (height: 'auto').
                // The collapse/exit target is height: 0 → stay clipped.
                if (def && def.height === 'auto') setOverflow('visible')
            }}
            style={{ overflow }}
            className={className}
            {...rest}
        >
            {children}
        </MotionTag>
    )
}
