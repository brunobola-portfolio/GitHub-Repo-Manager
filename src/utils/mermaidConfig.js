// One Mermaid configuration for every diagram surface (README reader, Deep
// Review walkthrough, Diagram Generator). Mermaid's stock "default" theme is
// lavender on white and its "dark" theme is a different purple again; both
// read as a foreign widget inside a brand that only has one accent ramp. The
// "base" theme takes explicit variables, so the diagram reads from the same
// slate and brand values the rest of the UI uses.
//
// The security settings live here on purpose: parseAndSanitizeSvg strips
// <foreignObject> as an XSS defence, so htmlLabels must stay false or every
// flowchart label disappears, and securityLevel is pinned so a Mermaid major
// cannot flip it silently.

const FONT = 'var(--ds-font-sans, ui-sans-serif, system-ui, sans-serif)'

// Entity attribute rows. Mermaid 11+ reads rowOdd/rowEven, not the older
// attributeBackgroundColor* pair, so without these the dark theme drew light
// rows under light text: the attribute names were unreadable.
const ER_ROWS = {
    light: { rowOdd: '#ffffff', rowEven: '#f8fafc' },
    dark: { rowOdd: '#1e293b', rowEven: '#111a2e' },
}

// gitGraph branch lanes. The base theme derives git0..git7 from the primary
// fill, which in the dark theme is the canvas colour: branch lines vanished
// into the background. Brand first, then the status hues the design system
// already uses (slate, amber, emerald, rose); each label reads on its lane.
const GIT_LANES = {
    light: ['#55831b', '#64748b', '#b45309', '#047857', '#be123c', '#334155', '#6ba522', '#94a3b8'],
    dark: ['#6ba522', '#94a3b8', '#f59e0b', '#10b981', '#fb7185', '#cbd5e1', '#a3d65c', '#64748b'],
}
const gitVars = (lanes, labelOn) => Object.fromEntries(lanes.flatMap((hex, i) => [
    [`git${i}`, hex],
    [`gitBranchLabel${i}`, labelOn(i)],
]))
const GIT = {
    light: {
        ...gitVars(GIT_LANES.light, (i) => (i === 7 ? '#0f172a' : '#ffffff')),
        commitLabelColor: '#0f172a',
        commitLabelBackground: '#f1f5f9',
        tagLabelColor: '#0f172a',
        tagLabelBackground: '#eff5e8',
        tagLabelBorder: '#55831b',
    },
    dark: {
        ...gitVars(GIT_LANES.dark, (i) => (i === 7 ? '#f1f5f9' : '#0f172a')),
        commitLabelColor: '#f1f5f9',
        commitLabelBackground: '#334155',
        tagLabelColor: '#f1f5f9',
        tagLabelBackground: '#304a0f',
        tagLabelBorder: '#6ba522',
    },
}

const LIGHT = {
    fontFamily: FONT,
    background: '#ffffff',
    mainBkg: '#eff5e8',
    primaryColor: '#eff5e8',
    primaryTextColor: '#0f172a',
    primaryBorderColor: '#55831b',
    nodeBorder: '#55831b',
    nodeTextColor: '#0f172a',
    secondaryColor: '#f1f5f9',
    secondaryTextColor: '#0f172a',
    secondaryBorderColor: '#cbd5e1',
    tertiaryColor: '#f8fafc',
    tertiaryTextColor: '#0f172a',
    tertiaryBorderColor: '#e2e8f0',
    lineColor: '#64748b',
    textColor: '#0f172a',
    titleColor: '#0f172a',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f8fafc',
    clusterBorder: '#e2e8f0',
    defaultLinkColor: '#64748b',
    actorBkg: '#eff5e8',
    actorBorder: '#55831b',
    actorTextColor: '#0f172a',
    actorLineColor: '#94a3b8',
    signalColor: '#0f172a',
    signalTextColor: '#0f172a',
    labelBoxBkgColor: '#f1f5f9',
    labelBoxBorderColor: '#cbd5e1',
    labelTextColor: '#0f172a',
    loopTextColor: '#0f172a',
    activationBkgColor: '#e1ebd5',
    activationBorderColor: '#55831b',
    sequenceNumberColor: '#ffffff',
    noteBkgColor: '#fffbeb',
    noteBorderColor: '#fcd34d',
    noteTextColor: '#0f172a',
    errorBkgColor: '#fff1f2',
    errorTextColor: '#9f1239',
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#f8fafc',
    ...ER_ROWS.light,
    ...GIT.light,
}

const DARK = {
    fontFamily: FONT,
    background: '#0f172a',
    mainBkg: '#1e293b',
    primaryColor: '#1e293b',
    primaryTextColor: '#f1f5f9',
    primaryBorderColor: '#6ba522',
    nodeBorder: '#6ba522',
    nodeTextColor: '#f1f5f9',
    secondaryColor: '#334155',
    secondaryTextColor: '#f1f5f9',
    secondaryBorderColor: '#475569',
    tertiaryColor: '#1e293b',
    tertiaryTextColor: '#f1f5f9',
    tertiaryBorderColor: '#334155',
    lineColor: '#94a3b8',
    textColor: '#f1f5f9',
    titleColor: '#f1f5f9',
    edgeLabelBackground: '#0f172a',
    clusterBkg: '#111a2e',
    clusterBorder: '#334155',
    defaultLinkColor: '#94a3b8',
    actorBkg: '#1e293b',
    actorBorder: '#6ba522',
    actorTextColor: '#f1f5f9',
    actorLineColor: '#64748b',
    signalColor: '#e2e8f0',
    signalTextColor: '#e2e8f0',
    labelBoxBkgColor: '#334155',
    labelBoxBorderColor: '#475569',
    labelTextColor: '#f1f5f9',
    loopTextColor: '#f1f5f9',
    activationBkgColor: '#304a0f',
    activationBorderColor: '#6ba522',
    sequenceNumberColor: '#0f172a',
    noteBkgColor: '#451a03',
    noteBorderColor: '#b45309',
    noteTextColor: '#fef3c7',
    errorBkgColor: '#4c0519',
    errorTextColor: '#fecdd3',
    attributeBackgroundColorOdd: '#1e293b',
    attributeBackgroundColorEven: '#0f172a',
    ...ER_ROWS.dark,
    ...GIT.dark,
}

/**
 * @param {'dark'|'default'|string} theme — the value the three diagram
 *   surfaces already track from <html class="dark">.
 */
export function mermaidInitConfig(theme) {
    const dark = theme === 'dark'
    return {
        startOnLoad: false,
        theme: 'base',
        darkMode: dark,
        securityLevel: 'strict',
        htmlLabels: false,
        fontFamily: FONT,
        themeVariables: dark ? DARK : LIGHT,
        flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis', padding: 12 },
        sequence: { useMaxWidth: true },
    }
}
