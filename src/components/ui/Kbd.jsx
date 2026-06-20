/**
 * Keyboard shortcut hint pill. Renders the OS-specific modifier prefix
 * when `modifier="mod"` (⌘ on macOS, Ctrl+ elsewhere).
 *
 * Example:
 *   <Kbd>Esc</Kbd>
 *   <Kbd modifier="mod">K</Kbd>          // renders "⌘K" on Mac, "Ctrl+K" on Windows
 *   <Kbd tone="onSolid">↵</Kbd>          // inside a solid-coloured button
 *
 * Note: only `modifier="mod"` is platform-aware; any other value is ignored.
 *
 * `tone`:
 *   - "default" — muted slate pill, for neutral surfaces (modal footers, ghost
 *     buttons, the command-palette help bar).
 *   - "onSolid" — translucent-white pill, for placement INSIDE a solid-coloured
 *     button (primary / danger / warning), which always renders white text. The
 *     default tone keeps its grey background there and reads as a clashing chip
 *     that "isn't themed"; onSolid blends into the button instead.
 */
const TONE_CLASSES = {
  default:
    'text-[color:var(--ds-fg-muted)] dark:text-[color:var(--ds-fg-muted-dark)] ' +
    'bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] ' +
    'border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)]',
  onSolid: 'text-white/90 bg-white/20 border-white/30',
}

function isMac() {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform)
}

export function Kbd({ children, modifier, tone = 'default' }) {
  const prefix = modifier === 'mod' ? (isMac() ? '⌘' : 'Ctrl+') : ''
  return (
    // Decorative: the keyboard glyph is a visual hint, not part of an element's
    // accessible name. aria-hidden keeps button names clean (e.g. "Cancel", not
    // "Cancel Esc") for screen readers.
    <kbd aria-hidden="true" className={`inline-flex items-center px-1.5 py-0.5 ds-text-meta font-medium border rounded-[var(--ds-radius-sm)] font-mono leading-none ${TONE_CLASSES[tone] || TONE_CLASSES.default}`}>
      {prefix}{children}
    </kbd>
  )
}
