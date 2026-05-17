/**
 * Animated SVG checkmark with stroke-draw fill on mount.
 * Used by Toast success variant and any "action complete" confirmation.
 * Animation: 240ms via `.ds-animated-check-path` class.
 *
 * Example:
 *   <AnimatedCheck size={20} color="currentColor" />
 */
export function AnimatedCheck({ size = 16, color = 'currentColor' }) {
  const length = 21
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      role="img"
      aria-label="completed"
    >
      <path
        d="M4 9 l4 4 l8 -8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={length}
        className="ds-animated-check-path"
        style={{ '--ds-stroke-length': length }}
      />
    </svg>
  )
}
