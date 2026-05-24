/**
 * PanelHeader — editorial-style header used at the top of marquee Settings
 * panels (AI Workspace, Work Board) and similar full-width feature
 * surfaces. The pattern was duplicated verbatim across AIConfigSection
 * and WorkBoardSettingsSection; extracting it here so the two stay in
 * lockstep and any new "premium" panel header can drop it in.
 *
 *   <PanelHeader
 *     eyebrowIcon={Sparkles}
 *     eyebrow="AI Workspace"
 *     title="Bring your own AI"
 *     description="Connect your own provider API key…"
 *   />
 *
 * Visual contract:
 *  - Thin vertical indigo accent on the left
 *  - 10px uppercase tracking-[0.22em] eyebrow with optional icon
 *  - Bold display h2 (lg) below
 *  - Optional muted description, max-w-lg
 *
 * Use the simpler `PageHeader` for page-level h1s. PanelHeader is for
 * nested sections inside an already-titled view (e.g. inside the
 * SettingsModal tab body).
 */
export function PanelHeader({
    eyebrowIcon: EyebrowIcon,
    eyebrow,
    title,
    description,
    actions,
    className = '',
}) {
    return (
        <header className={`relative flex items-start gap-4 pb-1 ${className}`.trim()}>
            <span
                aria-hidden="true"
                className="absolute -left-1 top-1 bottom-1 w-0.5 rounded-full bg-indigo-500 opacity-80"
            />
            <div className="pl-3 flex-1 min-w-0">
                {eyebrow && (
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
                        {EyebrowIcon && <EyebrowIcon className="w-3 h-3" aria-hidden="true" />}
                        <span>{eyebrow}</span>
                    </div>
                )}
                {title && (
                    <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 ds-font-display">
                        {title}
                    </h2>
                )}
                {description && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 max-w-lg">
                        {description}
                    </p>
                )}
            </div>
            {actions && (
                <div className="shrink-0 flex items-center gap-2">
                    {actions}
                </div>
            )}
        </header>
    )
}
