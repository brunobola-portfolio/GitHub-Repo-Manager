const CONVENTIONAL_RE = /^(feat|fix|chore|refactor|docs|style|perf|test|build|ci|revert)(\(.+?\))?!?:\s/
const GITMOJI_RE = /^:[a-z_]+?:\s/
const JIRA_RE = /^[A-Z]{2,10}-\d+\s/

export function detectCommitStyle(messages) {
    if (!messages || messages.length === 0) {
        return { detected_style: 'descriptive', pattern: '', examples: [], confidence: 0, prefixes: {} }
    }

    let conventionalCount = 0
    let gitmojiCount = 0
    let jiraCount = 0
    const prefixes = {}
    let jiraProject = ''

    for (const msg of messages) {
        const line = msg.split('\n')[0].trim()

        if (CONVENTIONAL_RE.test(line)) {
            conventionalCount++
            const match = line.match(/^(\w+)/)
            if (match) prefixes[match[1]] = (prefixes[match[1]] || 0) + 1
        }

        if (GITMOJI_RE.test(line)) {
            gitmojiCount++
        }

        const jiraMatch = line.match(JIRA_RE)
        if (jiraMatch) {
            jiraCount++
            if (!jiraProject) {
                const projMatch = jiraMatch[0].match(/^([A-Z]{2,10})-/)
                if (projMatch) jiraProject = projMatch[1]
            }
        }
    }

    const total = messages.length
    const scores = [
        { style: 'conventional', count: conventionalCount },
        { style: 'gitmoji', count: gitmojiCount },
        { style: 'jira-prefix', count: jiraCount },
    ]

    scores.sort((a, b) => b.count - a.count)
    const best = scores[0]
    const confidence = best.count / total

    if (confidence < 0.4) {
        return {
            detected_style: 'descriptive',
            pattern: 'free-form',
            examples: messages.slice(0, 3),
            confidence: Math.round(confidence * 100) / 100,
            prefixes,
        }
    }

    const patterns = {
        conventional: 'type(scope): description',
        gitmoji: ':emoji: description',
        'jira-prefix': `${jiraProject || 'PROJ'}-NNN description`,
    }

    return {
        detected_style: best.style,
        pattern: patterns[best.style],
        examples: messages.filter(m => {
            const line = m.split('\n')[0].trim()
            if (best.style === 'conventional') return CONVENTIONAL_RE.test(line)
            if (best.style === 'gitmoji') return GITMOJI_RE.test(line)
            if (best.style === 'jira-prefix') return JIRA_RE.test(line)
            return true
        }).slice(0, 3),
        confidence: Math.round(confidence * 100) / 100,
        prefixes,
    }
}
