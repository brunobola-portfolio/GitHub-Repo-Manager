/**
 * Privacy policy for the HOSTED instance, served at /privacy without auth.
 *
 * Why a page and not a link to docs/privacy-and-data.md: that document is
 * written for whoever deploys this software, and says so — it explicitly
 * refuses the role of a policy for a specific company ("If you are running a
 * hosted instance for other people, you are the data controller"). A visitor
 * who is about to grant GitHub access to repomanager.bolalabs.pt needs the
 * other document: who the controller is, on what basis, for how long, and how
 * to get their data out. Without it this deployment was asking for repository
 * access with no Article 13 notice anywhere.
 *
 * Every factual claim below is taken from the code paths listed in
 * docs/privacy-and-data.md ("Where this is enforced"), not from a template.
 * If a behaviour changes, that document and this page move together.
 */
import { useEffect } from 'react'

const UPDATED = '12 September 2026'
const CONTROLLER_EMAIL = 'bruno@bolalabs.pt'
const SOURCE_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'
const TECHNICAL_DOC_URL = `${SOURCE_URL}/blob/main/docs/privacy-and-data.md`

function Section({ id, title, children }) {
    return (
        <section aria-labelledby={id} className="mt-10">
            <h2 id={id} className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {children}
            </div>
        </section>
    )
}

export default function PrivacyPage() {
    // The shell's <title> names the application, which is right for the app and
    // wrong for a standalone legal document: this is a page people bookmark,
    // print and send to someone, and all three carry the title. Set from the
    // page itself rather than at the route decision in main.jsx, so it is
    // covered by this component's tests.
    useEffect(() => {
        document.title = 'Privacy policy — GitHub Repo Manager'
    }, [])

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
            <article className="mx-auto max-w-3xl">
                <p className="ds-eyebrow text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                    repomanager.bolalabs.pt
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Privacy policy</h1>
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    Last updated {UPDATED}. This policy covers the hosted instance at
                    repomanager.bolalabs.pt. If you run your own copy of this software, you are the
                    controller for your deployment and this policy does not describe it.
                </p>

                <Section id="controller" title="Who is responsible">
                    <p>
                        BolaLabs (Bruno Silva Marques), Portugal, is the data controller for this
                        hosted instance. For anything in this policy — including access, export or
                        erasure requests — write to{' '}
                        <a className="underline ds-focus-ring rounded" href={`mailto:${CONTROLLER_EMAIL}`}>
                            {CONTROLLER_EMAIL}
                        </a>
                        .
                    </p>
                </Section>

                <Section id="data" title="What this service stores, and why">
                    <ul className="list-disc space-y-2 pl-5">
                        <li>
                            <strong>Your GitHub account identity</strong> — numeric id, username,
                            display name, avatar URL and the e-mail GitHub exposes. Needed to have an
                            account at all; the legal basis is performance of the contract you enter
                            by signing in.
                        </li>
                        <li>
                            <strong>Your GitHub OAuth token</strong>, encrypted at rest with
                            AES-256-GCM. It is what lets the app read and write the repositories you
                            ask it to. The browser only ever holds an <code>httpOnly</code> session
                            cookie, never the token.
                        </li>
                        <li>
                            <strong>AI provider keys and Azure DevOps tokens you choose to add</strong>,
                            encrypted the same way. This is a bring-your-own-key product: your
                            provider bills you directly and this service never proxies or resells
                            inference.
                        </li>
                        <li>
                            <strong>Product data scoped to your account</strong> — cached repository
                            metadata, work-board state, migration plans, pull-request review records,
                            team memberships, AI usage counters, and API keys stored as hashes rather
                            than secrets.
                        </li>
                        <li>
                            <strong>A security audit log</strong> that records sign-ins, credential
                            changes, exports, erasures and administrative actions, together with the
                            IP address and user-agent of the request. The basis is legitimate interest
                            in detecting abuse and being able to prove what happened; the log is an
                            append-only hash chain, which is why erasure cannot selectively remove
                            entries from it (see below).
                        </li>
                        <li>
                            <strong>An optional digest e-mail</strong>, off unless you turn it on in
                            Settings. That one is consent, and every digest carries a one-click
                            unsubscribe link.
                        </li>
                    </ul>
                    <p>
                        There is no analytics script, no advertising pixel and no tracking of your
                        usage for any third party.
                    </p>
                </Section>

                <Section id="processors" title="What leaves the server, and to whom">
                    <ul className="list-disc space-y-2 pl-5">
                        <li>
                            <strong>GitHub</strong> — API calls made on your behalf with your own
                            token.
                        </li>
                        <li>
                            <strong>Your own AI provider</strong> (Anthropic, OpenAI, Gemini,
                            OpenRouter, or a local endpoint you configure) — only the content you ask
                            an AI feature to process. Pull-request diffs pass through
                            credential-shaped redaction first, so a committed token is stripped while
                            the surrounding code stays readable.
                        </li>
                        <li>
                            <strong>Resend</strong> — the recipient address and body of transactional
                            e-mail: licence keys, retention warnings, account notices, and the digest
                            if you enabled it.
                        </li>
                        <li>
                            <strong>Sentry</strong> — error telemetry. Events are sent with
                            credentials, cookies, request bodies and OAuth codes stripped, and your
                            identity reduced to a pseudonymous identifier, never your login or
                            e-mail.
                        </li>
                        <li>
                            <strong>Stripe</strong> — only if you buy a paid plan, and only what its
                            own hosted checkout requires. Card details never reach this service.
                        </li>
                    </ul>
                </Section>

                <Section id="retention" title="How long it is kept">
                    <ul className="list-disc space-y-2 pl-5">
                        <li>
                            Account and product data: while your account exists, and until you erase
                            it.
                        </li>
                        <li>
                            Unused AI provider credentials and Azure tokens: erased automatically
                            after 365 days without use, with a warning e-mail 30 days before.
                        </li>
                        <li>
                            Repository and pull-request event data used for dashboards and DORA
                            metrics: 365 days.
                        </li>
                        <li>
                            Security audit log: retained for the life of the deployment, for the
                            reason given above.
                        </li>
                    </ul>
                </Section>

                <Section id="rights" title="Your rights, and how to use them today">
                    <p>
                        You can exercise the two that matter most without asking anyone, from{' '}
                        <strong>Settings → Danger Zone</strong>:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>
                            <strong>Export my data</strong> — a JSON download of every row tied to
                            your account. Secrets are never included, only the fact that they exist.
                        </li>
                        <li>
                            <strong>Erase my data</strong> — wipes every table carrying your user id
                            and tombstones your account row. Two honest limits: an active
                            subscription must be cancelled first, and the security audit log
                            survives, because removing one row from a hash chain would destroy its
                            verifiability for everyone.
                        </li>
                    </ul>
                    <p>
                        You also have the rights to access, rectification, restriction, objection and
                        portability, and to complain to the Portuguese supervisory authority (CNPD).
                        Write to {CONTROLLER_EMAIL} and you will get an answer within 30 days.
                    </p>
                </Section>

                <Section id="cookies" title="Cookies and browser storage">
                    <p>
                        One cookie: the session cookie that keeps you signed in
                        (<code>httpOnly</code>, <code>Secure</code>, <code>SameSite=Lax</code>). It is
                        strictly necessary, so there is no consent banner to click. The app also keeps
                        a few preferences in your browser's local storage — theme, whether you have
                        seen the product tour, dismissed notices — which never leave your device.
                    </p>
                </Section>

                <Section id="self-host" title="If you self-host this software">
                    <p>
                        The software is Apache-2.0 and free to run yourself. A deployment you operate
                        stores its data on your infrastructure; BolaLabs has no access to it and is
                        not its controller. The technical inventory of what the software stores, and
                        the file that enforces each guarantee, is published at{' '}
                        <a
                            className="underline ds-focus-ring rounded"
                            href={TECHNICAL_DOC_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            docs/privacy-and-data.md
                        </a>
                        .
                    </p>
                </Section>

                <p className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <a className="underline ds-focus-ring rounded" href="/">
                        Back to GitHub Repo Manager
                    </a>
                </p>
            </article>
        </main>
    )
}
