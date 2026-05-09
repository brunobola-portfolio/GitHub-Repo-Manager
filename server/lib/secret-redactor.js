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
