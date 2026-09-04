/*
 * Native `title=` on an interactive control is unstyled, ignores dark mode,
 * has an OS-dependent delay, and never fires on touch (src/components/ui/Tooltip.jsx's
 * own doc block forbids it for exactly this reason). The 2026-09-04 panel
 * found 31 native `title=` on <button>/<a>/<input> across ~20 files; the
 * ui-consistency lens (F07) migrated the ones in OrgSidebar, SlimSidebar,
 * AIAssistant, MigrationHistory, CodeReviewToolbar, ReviewToolbar,
 * IssueDetailPanel and DevToolkitPanel to <Tooltip>.
 *
 * The rest are grandfathered in ALLOWED below so this gate does not fail on
 * work outside that migration's scope — it exists to stop the count from
 * growing, not to silently relitigate every file in one pass. Migrating a
 * file out of ALLOWED (and off native title=) should remove it from the set
 * in the same change.
 *
 * What stays legitimately un-migrated forever: native `title=` on static /
 * truncated TEXT (a <span>, <div>, <td>, …) that is not itself a button, a,
 * or input — the convention this gate enforces is scoped to interactive
 * controls only, so truncated-text titles never need an entry here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Files that still carry at least one native `title=` on an interactive
// element, as of the 2026-09-04 F07 migration pass. Pending migration by a
// future change — not truncated-text exceptions.
const ALLOWED = new Set([
    'src/components/AI/RepoHealthBadge.jsx',
    'src/components/AI/SuggestNameDescriptionModal.jsx',
    'src/components/Admin/DLQTable.jsx',
    'src/components/CreateRepoModal.jsx',
    'src/components/Dashboard/AIPromoStrip.jsx',
    'src/components/DevToolkit/CommitTab/SessionHistory.jsx',
    'src/components/DevToolkit/shared/RepoBadge.jsx',
    'src/components/Landing/LandingPage.jsx',
    'src/components/MigrationWizard/Steppers.jsx',
    'src/components/MigrationWizard/steps/RepoConfigStep/DescriptionField.jsx',
    'src/components/MigrationWizard/steps/RepoConfigStep/RepoCard.jsx',
    'src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx',
    'src/components/MigrationWizard/steps/SourceStep/ServerPicker.jsx',
    'src/components/MigrationWizard/steps/SourceStep/SourceUrlForm.jsx',
    'src/components/MigrationWizard/steps/SummaryStep.jsx',
    'src/components/OrgPanel.jsx',
    'src/components/PRReview/AIDeepReview/AIReviewPanel.jsx',
    'src/components/PRReview/AIInsights/AISummaryPanel.jsx',
    'src/components/PRReview/DiffPanel/HunkRiskRail.jsx',
    'src/components/PRReview/FileTree/FileTree.jsx',
    'src/components/PRReview/FileTree/RiskRail.jsx',
    'src/components/PRReview/PRReviewView.jsx',
    // CommitsTab.jsx: this migration's scope was explicitly kbd-only (F15) —
    // the "Open on GitHub" link's title= belongs to a future F07 pass.
    'src/components/RepoDetail/CommitsTab.jsx',
    'src/components/RepoDetail/PRDetailPanel.jsx',
    'src/components/RepoDetail/SettingsTab.jsx',
    'src/components/RepoList/RepoFilterBar.jsx',
    'src/components/RepoList/RepoStates.jsx',
    'src/components/RepoList/SelectionBar.jsx',
    'src/components/Settings/ApiKeysSection.jsx',
    'src/components/Settings/AzureCredentialsSection.jsx',
    'src/components/Settings/AzureHostsAllowlistSection.jsx',
    'src/components/Teams/TeamDetails.jsx',
])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(p)) out.push(p)
    }
    return out
}

// Interactive-tag opening angle brackets: <button, <a followed by space/>/,
// <input. Excludes things like <article> or <abbr> via the lookahead.
const TAG_START = /<(button|a|input)(?=[\s>/])/g

// Finds the index of a JSX opening tag's closing `>`, tracking string
// literals and brace depth so a `>` inside an attribute expression (a
// comparator, an arrow function body, …) or a quoted string doesn't end the
// tag early, and `=>` is never mistaken for the tag's own close.
function findTagEnd(src, start) {
    let i = start
    let braceDepth = 0
    let inString = null
    while (i < src.length) {
        const c = src[i]
        if (inString) {
            if (c === '\\') { i += 2; continue }
            if (c === inString) inString = null
            i++
            continue
        }
        if (c === '"' || c === "'" || c === '`') { inString = c; i++; continue }
        if (c === '{') { braceDepth++; i++; continue }
        if (c === '}') { braceDepth--; i++; continue }
        if (c === '>' && braceDepth === 0) {
            if (src[i - 1] === '=') { i++; continue } // arrow `=>`, not a tag close
            return i
        }
        i++
    }
    return -1
}

function findOffenders(files) {
    const offenders = []
    for (const file of files) {
        const src = readFileSync(file, 'utf8')
        let m
        TAG_START.lastIndex = 0
        while ((m = TAG_START.exec(src))) {
            const end = findTagEnd(src, m.index)
            if (end === -1) continue
            const tag = src.slice(m.index, end + 1)
            if (/\btitle=/.test(tag)) {
                const lineNum = src.slice(0, m.index).split('\n').length
                offenders.push(`${file}:${lineNum}`)
            }
        }
    }
    return offenders
}

const ALL_FILES = walk('src/components')

describe('interactive controls use <Tooltip>, not native title=', () => {
    it('finds source files at all (guards the walker itself)', () => {
        expect(ALL_FILES.length).toBeGreaterThan(200)
    })

    it('carries no NEW native title= on button/a/input outside the grandfathered list', () => {
        const files = ALL_FILES.filter((f) => !ALLOWED.has(f))
        const offenders = findOffenders(files)
        expect(offenders, `wrap in <Tooltip label="…"> instead of title=:\n${offenders.join('\n')}`).toEqual([])
    })

    it('the grandfathered list only names files that still need migrating', () => {
        // Catches the ALLOWED set going stale in the direction that hides
        // regressions: an entry that no longer exists, or a file that no
        // longer has any interactive title=, should be removed so it starts
        // being checked again.
        const stale = []
        for (const file of ALLOWED) {
            if (!ALL_FILES.includes(file)) { stale.push(`${file} (no longer exists)`); continue }
            if (findOffenders([file]).length === 0) stale.push(`${file} (already migrated — remove from ALLOWED)`)
        }
        expect(stale).toEqual([])
    })
})
