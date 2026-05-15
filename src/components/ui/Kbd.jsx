function isMac() {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform)
}

export function Kbd({ children, modifier }) {
  const prefix = modifier === 'mod' ? (isMac() ? '⌘' : 'Ctrl+') : ''
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--ds-fg-muted)] dark:text-[color:var(--ds-fg-muted-dark)] bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] border border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] rounded-[var(--ds-radius-sm)] font-mono leading-none">
      {prefix}{children}
    </kbd>
  )
}
