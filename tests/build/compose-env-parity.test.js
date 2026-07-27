import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// docker-compose.yml passes an explicit allowlist into the container — there is
// no `env_file:`. Anything documented in .env.example but absent from that list
// is silently dropped, which is how a paying self-host customer ends up with a
// degraded deployment and no error: LICENSE_KEY (fixed in #227) and the
// STRIPE_PRICE_* IDs (fixed 2026-07-27, checkout 400'd after the customer had
// already committed to buying) were both this exact defect.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Variables that legitimately never reach the container. Each needs a reason:
// adding a name here is how the guard gets weakened, so it must be justified.
const EXEMPT = new Map([
    ['PORT', 'compose publishes the fixed container port 3001 in `ports:`'],
    ['HOST', 'container always binds 0.0.0.0; the loopback default is desktop-only'],
    ['DATA_DIR', 'container path is fixed by the app-data volume mount'],
    ['VITE_API_BASE_URL', 'build-time frontend variable, baked into the image'],
    ['VITE_MOCK_MODE', 'build-time frontend variable, baked into the image'],
    ['DATABASE_URL', 'PostgreSQL is intentionally unsupported and rejected at boot; forwarding it would imply otherwise'],
])

// Commented declarations count. `.env.example` documents optional knobs as
// `# GRM_DISABLE_WEB_SETUP=false` — a real instruction to the operator, and
// invisible to a matcher that only accepts uncommented lines. Fourteen
// documented variables were outside this gate's view, nine of which genuinely
// never reached the container.
function documentedVars() {
    const text = readFileSync(join(ROOT, '.env.example'), 'utf8')
    return [...new Set(
        text.split(/\r?\n/)
            .map(line => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim()))
            .filter(Boolean)
            .map(m => m[1])
    )]
}

function forwardedVars() {
    const text = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')
    return new Set(
        [...text.matchAll(/^\s+- "([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1])
    )
}

describe('docker-compose env parity', () => {
    it('forwards every variable documented in .env.example', () => {
        const forwarded = forwardedVars()
        const missing = documentedVars().filter(v => !forwarded.has(v) && !EXEMPT.has(v))
        expect(missing, `Documented in .env.example but not forwarded by docker-compose.yml.
Add them to the \`environment:\` block as "\${NAME:-}", or add them to EXEMPT with a reason:
  ${missing.join('\n  ')}`).toEqual([])
    })

    it('every exemption names a variable that is actually documented', () => {
        const documented = new Set(documentedVars())
        const stale = [...EXEMPT.keys()].filter(v => !documented.has(v))
        expect(stale, `EXEMPT lists variables no longer in .env.example — delete them: ${stale.join(', ')}`).toEqual([])
    })

    it('forwards the Stripe price IDs checkout needs', () => {
        const forwarded = forwardedVars()
        for (const v of ['STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY']) {
            expect(forwarded.has(v), `${v} must reach the container or checkout 400s at the moment of purchase`).toBe(true)
        }
    })

    it('forwards the multi-tenant AI safety switch', () => {
        // Without this the server-side provider key is billed for every tenant,
        // which is the outcome README tells operators the flag prevents.
        expect(forwardedVars().has('AI_REQUIRE_USER_CONFIG')).toBe(true)
    })
})
