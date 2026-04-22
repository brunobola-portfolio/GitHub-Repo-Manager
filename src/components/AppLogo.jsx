/**
 * AppLogo — "The Nexus" branded logo for GitHub Repo Manager.
 * A central hub (the manager) with orbital repo nodes connected by glowing paths.
 * Communicates: centralized management, connectivity, premium quality.
 *
 * Brand colors are sourced from CSS custom properties (--ds-logo-*) defined in
 * `src/design-system.css`. The logo's palette is intentionally static
 * (not theme-aware) to preserve brand identity in both light and dark mode.
 */
export function AppLogo({ className = 'w-6 h-6', style }) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Repo Manager logo"
    >
      <defs>
        <linearGradient id="al-bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--ds-logo-bg-start)" />
          <stop offset="45%" stopColor="var(--ds-logo-bg-mid)" />
          <stop offset="100%" stopColor="var(--ds-logo-bg-end)" />
        </linearGradient>
        <linearGradient id="al-shine" x1="0" y1="0" x2="512" y2="300" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="al-glow" cx="256" cy="240" r="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--ds-logo-accent)" stopOpacity="0.4" />
          <stop offset="50%" stopColor="var(--ds-logo-accent-bold)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--ds-logo-accent-bold)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="al-node" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--ds-logo-accent-light)" />
          <stop offset="100%" stopColor="var(--ds-logo-accent)" />
        </linearGradient>
        <linearGradient id="al-ring" x1="100" y1="100" x2="400" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--ds-logo-accent-bold)" stopOpacity="0.3" />
          <stop offset="50%" stopColor="var(--ds-logo-secondary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--ds-logo-tertiary)" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect width="512" height="512" rx="108" fill="url(#al-bg)" />
      <rect width="512" height="512" rx="108" fill="url(#al-shine)" />

      {/* Central ambient glow */}
      <circle cx="256" cy="240" r="140" fill="url(#al-glow)" />

      {/* Orbital ring */}
      <ellipse cx="256" cy="248" rx="145" ry="130" stroke="url(#al-ring)" strokeWidth="1.5" fill="none" opacity="0.6" />

      {/* Connection lines */}
      <line x1="256" y1="240" x2="370" y2="142" stroke="var(--ds-logo-accent)" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      <line x1="256" y1="240" x2="148" y2="152" stroke="var(--ds-logo-tertiary)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <line x1="256" y1="240" x2="155" y2="358" stroke="var(--ds-logo-tertiary-soft)" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <line x1="256" y1="240" x2="368" y2="348" stroke="var(--ds-logo-secondary)" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />

      {/* Node-to-node arcs */}
      <path d="M370 142 Q 410 245, 368 348" stroke="var(--ds-logo-secondary)" strokeWidth="1.5" fill="none" opacity="0.25" strokeLinecap="round" />
      <path d="M148 152 Q 100 250, 155 358" stroke="var(--ds-logo-tertiary)" strokeWidth="1.5" fill="none" opacity="0.2" strokeLinecap="round" />

      {/* Outer nodes */}
      {/* Top-right: cyan (primary) */}
      <circle cx="370" cy="142" r="24" fill="none" stroke="var(--ds-logo-secondary)" strokeWidth="2" opacity="0.3" />
      <circle cx="370" cy="142" r="16" fill="var(--ds-logo-secondary)" />
      <circle cx="370" cy="142" r="8" fill="white" opacity="0.7" />

      {/* Top-left: indigo */}
      <circle cx="148" cy="152" r="20" fill="none" stroke="var(--ds-logo-tertiary)" strokeWidth="1.5" opacity="0.25" />
      <circle cx="148" cy="152" r="13" fill="var(--ds-logo-accent-light)" />
      <circle cx="148" cy="152" r="6" fill="white" opacity="0.6" />

      {/* Bottom-left: purple */}
      <circle cx="155" cy="358" r="18" fill="none" stroke="var(--ds-logo-tertiary-soft)" strokeWidth="1.5" opacity="0.2" />
      <circle cx="155" cy="358" r="11" fill="var(--ds-logo-tertiary-soft)" />
      <circle cx="155" cy="358" r="5" fill="white" opacity="0.5" />

      {/* Bottom-right: teal */}
      <circle cx="368" cy="348" r="19" fill="none" stroke="var(--ds-logo-secondary-deep)" strokeWidth="1.5" opacity="0.25" />
      <circle cx="368" cy="348" r="12" fill="var(--ds-logo-secondary)" />
      <circle cx="368" cy="348" r="5.5" fill="white" opacity="0.6" />

      {/* CENTRAL HUB */}
      <circle cx="256" cy="240" r="34" fill="none" stroke="white" strokeWidth="2.5" opacity="0.25" />
      <circle cx="256" cy="240" r="28" fill="url(#al-node)" />
      <circle cx="256" cy="240" r="20" fill="white" opacity="0.15" />
      {/* Folder icon inside */}
      <g transform="translate(256,240)" opacity="0.95">
        <path d="M-12,-10 L-5,-10 L-2,-14 L8,-14 L8,-10 L12,-10 L12,10 L-12,10 Z" fill="white" opacity="0.9" />
        <line x1="-12" y1="-6" x2="12" y2="-6" stroke="var(--ds-logo-accent-bold)" strokeWidth="1.5" opacity="0.4" />
      </g>

      {/* Sparkle atmosphere */}
      <circle cx="310" cy="190" r="2" fill="white" opacity="0.4" />
      <circle cx="200" cy="300" r="1.5" fill="white" opacity="0.3" />
      <circle cx="330" cy="290" r="1.5" fill="var(--ds-logo-secondary)" opacity="0.4" />
      <circle cx="190" cy="200" r="1.5" fill="var(--ds-logo-tertiary)" opacity="0.35" />
    </svg>
  )
}

/**
 * AppLogoIcon — Monochrome icon marks (uses currentColor) for use on gradient backgrounds.
 * Shows the nexus pattern: central hub with 4 connected repo nodes.
 */
export function AppLogoIcon({ className = 'w-6 h-6', style }) {
  return (
    <svg
      viewBox="80 80 360 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Repo Manager icon"
    >
      {/* Connection lines */}
      <line x1="256" y1="240" x2="370" y2="142" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity="0.5" />
      <line x1="256" y1="240" x2="148" y2="152" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity="0.45" />
      <line x1="256" y1="240" x2="155" y2="358" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
      <line x1="256" y1="240" x2="368" y2="348" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.45" />

      {/* Outer repo nodes */}
      <circle cx="370" cy="142" r="16" fill="currentColor" opacity="0.75" />
      <circle cx="370" cy="142" r="7" fill="currentColor" opacity="0.4" />
      <circle cx="148" cy="152" r="13" fill="currentColor" opacity="0.65" />
      <circle cx="148" cy="152" r="5.5" fill="currentColor" opacity="0.35" />
      <circle cx="155" cy="358" r="11" fill="currentColor" opacity="0.55" />
      <circle cx="155" cy="358" r="4.5" fill="currentColor" opacity="0.3" />
      <circle cx="368" cy="348" r="12" fill="currentColor" opacity="0.65" />
      <circle cx="368" cy="348" r="5" fill="currentColor" opacity="0.35" />

      {/* Central hub */}
      <circle cx="256" cy="240" r="30" fill="currentColor" opacity="0.2" />
      <circle cx="256" cy="240" r="24" fill="currentColor" opacity="0.85" />
      {/* Folder shape inside */}
      <g transform="translate(256,240)">
        <path d="M-10,-8 L-4,-8 L-1.5,-12 L7,-12 L7,-8 L10,-8 L10,9 L-10,9 Z" fill="currentColor" opacity="0.3" />
      </g>
    </svg>
  )
}
