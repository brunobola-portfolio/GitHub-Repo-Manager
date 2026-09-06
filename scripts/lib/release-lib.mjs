// Pure transforms behind scripts/release.mjs, kept free of I/O so they can be
// unit-tested against fixtures. Every function takes text in and returns text
// out; the script decides what to read and write.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export function bumpVersion(current, kind) {
    if (SEMVER.test(kind)) return kind
    const m = SEMVER.exec(current)
    if (!m) throw new Error(`Current version "${current}" is not MAJOR.MINOR.PATCH`)
    const [major, minor, patch] = m.slice(1).map(Number)
    switch (kind) {
        case 'major': return `${major + 1}.0.0`
        case 'minor': return `${major}.${minor + 1}.0`
        case 'patch': return `${major}.${minor}.${patch + 1}`
        default: throw new Error(`Unknown bump "${kind}" — use major, minor, patch or an explicit X.Y.Z`)
    }
}

/** GitHub's heading anchor for "## [4.24.0] - 2026-09-06" is "4240---2026-09-06". */
export function changelogAnchor(version, date) {
    return `${version.replace(/\./g, '')}---${date}`
}

/**
 * Promote the [Unreleased] section to a dated release heading and refresh the
 * compare links at the bottom. Refuses an empty Unreleased section: a release
 * with nothing to say is a mistake, not a no-op.
 */
export function promoteUnreleased(changelog, { version, previous, date, repoUrl }) {
    const lines = changelog.split(/\r?\n/)
    const head = lines.findIndex((l) => /^## \[Unreleased\]/.test(l))
    if (head === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading')
    const next = lines.findIndex((l, i) => i > head && /^## \[/.test(l))
    const body = lines.slice(head + 1, next === -1 ? lines.length : next)
    if (!body.some((l) => l.trim() !== '')) throw new Error('The [Unreleased] section is empty — nothing to release')
    if (lines.some((l) => l.startsWith(`## [${version}]`))) throw new Error(`CHANGELOG.md already has a ${version} section`)

    lines.splice(head + 1, 0, '', `## [${version}] - ${date}`)

    const unreleasedLink = lines.findIndex((l) => /^\[Unreleased\]:\s/.test(l))
    if (unreleasedLink === -1) throw new Error('CHANGELOG.md has no "[Unreleased]:" compare link')
    lines.splice(
        unreleasedLink,
        1,
        `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`,
        `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`,
    )
    return lines.join('\n')
}

/** Rewrite the top-level "version" of package.json / package-lock.json text
 *  without re-serialising the file, so formatting and key order survive. */
export function setPackageVersion(text, version, { lockfile = false } = {}) {
    let count = 0
    let out = text.replace(/^(\s*"version":\s*")[^"]+(")/m, (_, a, b) => { count += 1; return `${a}${version}${b}` })
    if (lockfile) {
        // The root package entry ("": { "name": ..., "version": ... }) is the
        // second occurrence; npm keeps both in sync.
        out = out.replace(/("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]+(")/, (_, a, b) => { count += 1; return `${a}${version}${b}` })
    }
    if (count === 0) throw new Error('No "version" field found')
    return out
}

/**
 * Prepend the release to the "Recent releases" digest in docs/index.md.
 * tests/build/readme-honesty.test.js requires the digest to lead with the
 * newest CHANGELOG version, so a release that skips this step fails CI on
 * the very commit that cut it. The body is the title plus the bold lead of
 * every bullet in the new CHANGELOG section, joined into one sentence.
 */
export function addRecentRelease(indexMd, { version, date, title, changelogSection = '' }) {
    const lines = indexMd.split(/\r?\n/)
    const heading = lines.findIndex((l) => /^## Recent releases/.test(l))
    if (heading === -1) throw new Error('docs/index.md has no "## Recent releases" heading')
    const first = lines.findIndex((l, i) => i > heading && /^- \*\*v\d+\.\d+\.\d+/.test(l))
    if (first === -1) throw new Error('docs/index.md digest has no release entries to prepend to')
    if (lines.some((l) => l.startsWith(`- **v${version} `))) return indexMd

    const leads = [...changelogSection.matchAll(/^- \*\*([^*]+?)\*\*/gm)]
        .map((m) => m[1].trim().replace(/[.:]$/, ''))
    const body = leads.length ? leads.join('; ') + '.' : 'See the changelog.'
    const label = title ? `${title}.` : 'release.'
    const entry = wrap(`- **v${version} (${date}) — ${label}** ${body}`)
    lines.splice(first, 0, ...entry)
    return lines.join('\n')
}

function wrap(text, width = 76) {
    const words = text.split(' ')
    const out = []
    let line = ''
    for (const w of words) {
        const candidate = line ? `${line} ${w}` : w
        if (candidate.length > width && line) {
            out.push(line)
            line = `  ${w}`
        } else {
            line = candidate
        }
    }
    if (line) out.push(line)
    return out
}

/** Point the README's "What's new" link at the release just cut. */
export function updateWhatsNew(readme, { version, date, title }) {
    const short = version.replace(/\.0$/, '')
    const re = /\[What's new in v[^\]]*\]\(CHANGELOG\.md#[^)]*\)/
    if (!re.test(readme)) return readme
    const label = title ? `What's new in v${short} — ${title}` : `What's new in v${short}`
    return readme.replace(re, `[${label}](CHANGELOG.md#${changelogAnchor(version, date)})`)
}
