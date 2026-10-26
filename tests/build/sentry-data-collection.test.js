/*
 * Sentry 11 made data collection permissive by default: with dataCollection
 * unset it sends cookies (the session cookie), whole request and response
 * bodies (prompts, API keys), database query data and user info. Both Sentry
 * inits must state the restrictive baseline explicitly, so a Dependabot bump
 * of @sentry/node or @sentry/react can never widen what leaves the box.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const INITS = ['server/lib/monitoring.js', 'src/main.jsx']

function initBlock(file) {
    const src = readFileSync(file, 'utf8')
    const start = src.indexOf('Sentry.init({')
    expect(start, `${file} calls Sentry.init`).toBeGreaterThan(-1)
    return src.slice(start, src.indexOf('beforeSend', start))
}

describe('Sentry collects nothing personal, whatever the SDK default', () => {
    for (const file of INITS) {
        it(`${file} sets the restrictive dataCollection baseline`, () => {
            const block = initBlock(file)
            expect(block).toMatch(/sendDefaultPii: false/)
            expect(block).toMatch(/dataCollection: \{/)
            for (const rule of [/userInfo: false/, /cookies: false/, /httpBodies: \[\]/, /databaseQueryData: false/, /genAI: \{ inputs: false, outputs: false \}/, /queues: false/]) {
                expect(block, `${file}: ${rule}`).toMatch(rule)
            }
            expect(block).toMatch(/deny: \[[^\]]*'authorization'[^\]]*'cookie'/)
        })
    }
})
