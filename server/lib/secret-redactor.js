/*
 * GitHub Repo Manager - Secret Redactor
 *
 * Line-by-line redaction of obviously-secret-looking content. Runs over
 * every fetched file before it leaves the server toward the AI provider.
 * Conservative on purpose: false-positive a few legitimate lines rather
 * than leak a real key.
 *
 * Returns { content, count } — count is the number of redacted lines (not
 * matches), so a single line with three "secret" hits counts as one.
 */

export const SECRET_REGEX = /(api[_-]?key|secret|token|password|aws_access|bearer\s+\w+|sk-[\w-]{20,}|ghp_\w{36}|github_pat_\w+|xox[baprs]-\w+)/i;

const REDACTED = '[REDACTED — possible secret]';

export function redact(content) {
    if (typeof content !== 'string' || content.length === 0) {
        return { content: '', count: 0 };
    }
    let count = 0;
    const lines = content.split(/\r?\n/);
    const out = lines.map((line) => {
        if (SECRET_REGEX.test(line)) {
            count += 1;
            return REDACTED;
        }
        return line;
    });
    return { content: out.join('\n'), count };
}

/*
 * Value-shaped redaction for DIFFS.
 *
 * The line-kill above is right for repository files (README context, config
 * excerpts): losing a line costs little. It is wrong for a pull-request diff:
 * a PR that touches auth code mentions "token" and "password" on half its
 * meaningful lines, and a reviewer model reading [REDACTED] × 40 reviews
 * nothing. Here the LINE survives and only the credential-shaped VALUE inside
 * it is replaced, so `const token = req.headers.authorization` passes
 * untouched while `const token = "ghp_abc…"` loses only the literal.
 *
 * Patterns are value-shaped (the shape of the secret itself), not name-shaped,
 * so precision stays high enough to run on every diff unconditionally.
 */

const VALUE_PATTERNS = [
    // Provider-issued tokens with unmistakable prefixes.
    { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
    { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
    { name: 'openai-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'stripe-key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
    { name: 'aws-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    // Explicit assignments where the NAME says secret and the VALUE is a
    // quoted literal — code expressions (dots, parens, spaces) never match.
    {
        name: 'assigned-literal',
        re: /\b((?:api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*)(["'])(?!\2)(?![$#{])[^"'\s.()]{8,}\2/gi,
        keepGroup: 1,
    },
]

const BLOCK_RE = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|PRIVATE KEY BLOCK)-----[\s\S]*?(?:-----END [A-Z0-9 ]*(?:PRIVATE KEY|PRIVATE KEY BLOCK)-----|$)/g

/**
 * @param {string} content — unified diff (or any text bound for a provider)
 * @returns {{ content: string, count: number }} count = replaced values
 */
export function redactValues(content) {
    if (typeof content !== 'string' || content.length === 0) {
        return { content: '', count: 0 };
    }
    let count = 0;
    let out = content.replace(BLOCK_RE, () => {
        count += 1;
        return '[REDACTED:private-key-block]';
    });
    for (const { name, re, keepGroup } of VALUE_PATTERNS) {
        out = out.replace(re, (...args) => {
            count += 1;
            const marker = `[REDACTED:${name}]`;
            if (keepGroup) {
                // args: match, g1, g2, ..., offset, string
                return `${args[keepGroup]}${marker}`;
            }
            return marker;
        });
    }
    return { content: out, count };
}
