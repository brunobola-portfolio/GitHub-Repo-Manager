export function AnimatedCheck({ size = 16, color = 'currentColor', durationMs = 240 }) {
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
        style={{
          animation: `ds-stroke-draw ${durationMs}ms cubic-bezier(0.2,0,0,1) forwards`,
          '--ds-stroke-length': length,
        }}
      />
    </svg>
  )
}
