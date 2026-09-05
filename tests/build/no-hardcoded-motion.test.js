/*
 * One duration/easing vocabulary, not 28 hardcoded values.
 *
 * 168 hardcoded Framer durations across 28 distinct values, plus 29
 * hardcoded easing strings (`easeInOut` x17, `easeOut` x12), sat next to a
 * `motion.js` that already exported DURATION/EASE and is imported by 60+
 * files — even primitives drifted (SectionPanel, Modal, Tooltip)
 * (2026-09-04 panel, F13). Springs got the same gate years ago and stayed at
 * zero hardcoded `stiffness:` ever since; this mirrors it for duration/ease.
 *
 * Scope decision — looping decorative animations are NOT covered. A
 * `repeat:` sibling on the same line marks an ambient/looping animation
 * (hero blobs, pricing background halos, 2s-12s durations) — a different
 * category from the one-shot micro-interaction scale DURATION names.
 * motion.js's own doc comment calls this out ("a long looping decorative
 * gradient" needs different handling than the fade/move presets). Forcing
 * e.g. a 9-second hero loop onto DURATION.ambient (0.6s) would be a
 * regression dressed up as a fix, so those numeric durations are allowed;
 * their `ease:` strings are still tokenized since a bezier curve is
 * duration-independent.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MOTION_VOCAB = 'src/components/ui/motion.js'

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(p)) out.push(p)
    }
    return out
}

// Settings/**, Audit/** and WorkBoard/filters/** carry pre-existing
// hardcoded motion outside this pass's scope — a concurrent 2026-09-04
// panel pass owns those paths so this gate does not race it.
const ALLOWED_PREFIXES = ['src/components/Settings/', 'src/components/Audit/', 'src/components/WorkBoard/filters/']

const FILES = walk('src/components').filter(
    (f) => f !== MOTION_VOCAB && !ALLOWED_PREFIXES.some((prefix) => f.startsWith(prefix)),
)

const DURATION_RE = /duration:\s*([0-9]*\.?[0-9]+)/
const EASE_STRING_RE = /ease:\s*['"](easeOut|easeInOut|easeIn|linear|circOut|circIn|circInOut|backOut|backIn|backInOut|anticipate)['"]/

describe('motion durations and eases come from DURATION.*/EASE.*, not literals', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no numeric duration: outside a repeat:Infinity loop', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (/\brepeat:/.test(line)) return // ambient/looping decorative motion
                const hit = line.match(DURATION_RE)
                if (!hit) return
                if (hit[1] === '0') return // explicit no-animation branch (reduced motion)
                offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use DURATION.* from ui/motion.js:\n${offenders.slice(0, 20).join('\n')}`).toEqual([])
    })

    it('has no string ease: literal — use EASE.standard / EASE.emphasized', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (EASE_STRING_RE.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use EASE.* from ui/motion.js:\n${offenders.join('\n')}`).toEqual([])
    })
})
