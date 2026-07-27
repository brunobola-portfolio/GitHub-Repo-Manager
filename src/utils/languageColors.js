/**
 * GitHub language → dot colour.
 *
 * Shared by every surface that renders a language: the Dashboard's
 * LanguageChart (pie slices, stacked bar, legend swatches) and RepoList's
 * RepoCard language dot. It lived inline in LanguageChart and was never
 * imported anywhere else, so RepoCard hardcoded `bg-indigo-500` and painted
 * every language the same colour — 15 languages, 1 dot colour, in a GitHub
 * tool.
 *
 * Values are GitHub's own linguist colours, so a repo's dot here matches the
 * dot the same repo shows on github.com.
 */
const LANGUAGE_COLORS = {
    JavaScript: '#f1e05a',
    TypeScript: '#3178c6',
    Python: '#3572A5',
    Java: '#b07219',
    'C#': '#178600',
    'C++': '#f34b7d',
    C: '#555555',
    Go: '#00ADD8',
    Rust: '#dea584',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Scala: '#c22d40',
    R: '#198CE7',
    Shell: '#89e051',
    Lua: '#000080',
    Perl: '#0298c3',
    Haskell: '#5e5086',
    Elixir: '#6e4a7e',
    Clojure: '#db5855',
    Erlang: '#B83998',
    Julia: '#a270ba',
    HTML: '#e34c26',
    CSS: '#563d7c',
    SCSS: '#c6538c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Jupyter: '#DA5B0B',
    Dockerfile: '#384d54',
    HCL: '#844FBA',
    Nix: '#7e7eff',
    Zig: '#ec915c',
    OCaml: '#3be133',
    'Objective-C': '#438eff',
    Groovy: '#4298b8',
    PowerShell: '#012456',
    Vim: '#199f4b',
    // Config/markup languages GitHub reports often enough that falling back
    // would look arbitrary next to the mapped ones.
    YAML: '#cb171e',
    JSON: '#292929',
    Markdown: '#083fa1',
    Makefile: '#427819',
    SQL: '#e38c00',
    Astro: '#ff5a03',
    Solidity: '#AA6746',
    Elm: '#60B5CC',
    'F#': '#b845fc',
    Assembly: '#6E4C13',
}

// Fallback palette for languages GitHub reports that aren't mapped above.
const FALLBACK_COLORS = [
    '#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b',
    '#ef4444', '#06b6d4', '#10b981', '#f97316', '#84cc16',
    '#e879f9', '#22d3ee', '#fb923c', '#a78bfa', '#34d399',
    '#fbbf24', '#f472b6', '#2dd4bf', '#c084fc', '#4ade80',
]

/**
 * Deterministic index from a language name. Hashing the NAME (rather than
 * using the caller's list position) is what makes an unmapped language the
 * same colour in the pie chart, its legend and every repo card — a
 * position-based fallback re-coloured the same language whenever the sort
 * order changed, and could never agree with a card that has no list index.
 */
function hashIndex(name, modulo) {
    let h = 0
    for (let i = 0; i < name.length; i++) {
        h = (h * 31 + name.charCodeAt(i)) | 0
    }
    return Math.abs(h) % modulo
}

/**
 * Resolve a language name to its dot/slice colour.
 *
 * @param {string} name - Language name as GitHub reports it ("TypeScript")
 * @returns {string} Hex colour. Unknown/empty names get a stable fallback.
 */
export function getLanguageColor(name) {
    if (!name) return FALLBACK_COLORS[0]
    return LANGUAGE_COLORS[name] ?? FALLBACK_COLORS[hashIndex(name, FALLBACK_COLORS.length)]
}

export { LANGUAGE_COLORS, FALLBACK_COLORS }
