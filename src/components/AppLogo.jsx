/**
 * AppLogo — Custom branded SVG logo for GitHub Repo Manager.
 * Renders a Git branch tree with cyan accent nodes and a management chevron.
 * Use instead of the generic Github lucide icon for app branding.
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
        <linearGradient id="logo-bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="logo-shine" x1="0" y1="0" x2="256" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="logo-accent" x1="280" y1="140" x2="400" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      {/* Rounded square background */}
      <rect width="512" height="512" rx="112" fill="url(#logo-bg)" />
      <rect width="512" height="512" rx="112" fill="url(#logo-shine)" />
      {/* Main vertical line */}
      <line x1="190" y1="130" x2="190" y2="382" stroke="white" strokeWidth="32" strokeLinecap="round" />
      {/* Branch lines */}
      <path d="M190 220 C230 220, 260 180, 300 180" stroke="white" strokeWidth="32" strokeLinecap="round" fill="none" />
      <path d="M190 310 C230 310, 260 340, 310 340" stroke="white" strokeWidth="32" strokeLinecap="round" fill="none" />
      {/* Main line nodes */}
      <circle cx="190" cy="140" r="26" fill="white" />
      <circle cx="190" cy="220" r="22" fill="white" />
      <circle cx="190" cy="310" r="22" fill="white" />
      <circle cx="190" cy="382" r="26" fill="white" />
      {/* Branch endpoint nodes (cyan accent) */}
      <circle cx="310" cy="180" r="26" fill="url(#logo-accent)" stroke="white" strokeWidth="8" />
      <circle cx="320" cy="340" r="26" fill="url(#logo-accent)" stroke="white" strokeWidth="8" />
      {/* Management chevron */}
      <path d="M355 240 L390 270 L355 300" stroke="white" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
    </svg>
  )
}

/**
 * AppLogoIcon — Just the icon marks (no background), for use on colored backgrounds.
 * White-only version for use inside gradient containers.
 */
export function AppLogoIcon({ className = 'w-6 h-6', style }) {
  return (
    <svg
      viewBox="100 80 330 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Repo Manager icon"
    >
      {/* Main vertical line */}
      <line x1="190" y1="130" x2="190" y2="382" stroke="currentColor" strokeWidth="32" strokeLinecap="round" />
      {/* Branch lines */}
      <path d="M190 220 C230 220, 260 180, 300 180" stroke="currentColor" strokeWidth="32" strokeLinecap="round" fill="none" />
      <path d="M190 310 C230 310, 260 340, 310 340" stroke="currentColor" strokeWidth="32" strokeLinecap="round" fill="none" />
      {/* Main line nodes */}
      <circle cx="190" cy="140" r="26" fill="currentColor" />
      <circle cx="190" cy="220" r="22" fill="currentColor" />
      <circle cx="190" cy="310" r="22" fill="currentColor" />
      <circle cx="190" cy="382" r="26" fill="currentColor" />
      {/* Branch endpoint nodes */}
      <circle cx="310" cy="180" r="26" fill="currentColor" opacity="0.8" />
      <circle cx="320" cy="340" r="26" fill="currentColor" opacity="0.8" />
      {/* Management chevron */}
      <path d="M355 240 L390 270 L355 300" stroke="currentColor" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.6" />
    </svg>
  )
}
