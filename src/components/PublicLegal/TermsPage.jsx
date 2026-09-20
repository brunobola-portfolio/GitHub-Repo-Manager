/**
 * Subscription terms for the HOSTED instance, served at /terms without auth.
 *
 * The only terms that existed were docs/LICENSE-COMMERCIAL.md on GitHub — a
 * document written for whoever buys a subscription, which says outright at the
 * end: "There is no /license page yet. Until there is, this document is the
 * terms." That is fine for a licence summary and not fine for selling a
 * €19/month service to a consumer in the EU, who is owed the price, the
 * billing period, how to cancel, how to get a refund, and the 14-day right of
 * withdrawal — in writing, before paying.
 *
 * One deliberate choice, and one clause that arrived with the mechanism:
 *
 * - VAT is described only since 20 September 2026, when Stripe Tax gained a
 *   PT registration plus OSS and the checkout began collecting the billing
 *   address and VAT id (STRIPE_AUTOMATIC_TAX). Before that the page said
 *   nothing about tax on purpose, because nothing calculated it.
 * - The 14-day withdrawal right is granted outright rather than waived. It can
 *   be waived for a digital service, but only if the buyer expressly consents
 *   to immediate performance and acknowledges losing the right — and the
 *   checkout collects no such consent. Until it does, the right stands.
 *
 * The warranty, liability and governing-law wording is the same as the one
 * already published on bolalabs.pt (content/legal/terms.ts), adapted from "the
 * site" to "this service": one company, one voice, and no second set of
 * promises to keep in sync.
 */
import { useEffect } from 'react'

const UPDATED = '12 September 2026'
const CONTROLLER_EMAIL = 'bruno@bolalabs.pt'
const SOURCE_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'
const LICENCE_URL = `${SOURCE_URL}/blob/main/LICENSE`
const SUBSCRIPTION_DOC_URL = `${SOURCE_URL}/blob/main/docs/LICENSE-COMMERCIAL.md`

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

export default function TermsPage() {
    useEffect(() => {
        document.title = 'Terms of service — GitHub Repo Manager'
    }, [])

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
            <article className="mx-auto max-w-3xl">
                <p className="ds-eyebrow text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                    repomanager.bolalabs.pt
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Terms of service</h1>
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    Last updated {UPDATED}. These terms cover the hosted instance at
                    repomanager.bolalabs.pt and any paid subscription bought on it. If you run your
                    own copy of this software, they do not apply to you — the{' '}
                    <a href={LICENCE_URL} className="underline" target="_blank" rel="noopener noreferrer">
                        Apache-2.0 licence
                    </a>{' '}
                    is all you need.
                </p>

                <Section id="who" title="Who you are contracting with">
                    <p>
                        BolaLabs (Bruno Silva Marques), Portugal, contactable at{' '}
                        <a href={`mailto:${CONTROLLER_EMAIL}`} className="underline">
                            {CONTROLLER_EMAIL}
                        </a>
                        . Using this service means accepting these terms. If you are buying on behalf
                        of a company, you confirm you may bind it.
                    </p>
                </Section>

                <Section id="software" title="The software is free; the service is what you pay for">
                    <p>
                        GitHub Repo Manager is licensed to everyone under Apache-2.0. That licence
                        already lets you run, modify, redistribute and embed the code, commercially,
                        without asking and without paying, and nothing on this page takes any of it
                        away.
                    </p>
                    <p>
                        What a subscription buys is capacity and service on this instance: higher
                        monthly AI and API ceilings, more API keys, and support. It never buys a
                        product feature that free users do not have, and it never buys AI inference —
                        you configure your own provider key and that provider bills you directly. The
                        tier-by-tier detail lives in the{' '}
                        <a href={SUBSCRIPTION_DOC_URL} className="underline" target="_blank" rel="noopener noreferrer">
                            subscription agreement
                        </a>
                        , which these terms sit alongside; where the two disagree about the service,
                        this page wins.
                    </p>
                </Section>

                <Section id="account" title="Your account and your repositories">
                    <p>
                        Signing in uses GitHub. You are responsible for what happens through your
                        account, and for the access you grant: the app asks GitHub for repository
                        access and read-only organisation membership, and asks again, separately, the
                        first time you delete a repository or change an organisation.
                    </p>
                    <p>
                        Anything that writes to your repositories goes through a preview first — a
                        pull request or a diff you approve — and never commits on your behalf without
                        it. AI features generate suggestions; you decide what to publish, and you
                        remain responsible for what you publish.
                    </p>
                    <p>
                        Access may be suspended for abuse, for activity that puts the service or
                        other users at risk, or for non-payment. Where the reason is not urgent you
                        will be told first.
                    </p>
                </Section>

                <Section id="price" title="Price, billing and renewal">
                    <p>
                        Pro is <strong>€19 per month</strong>, charged in euros, <strong>excluding
                        VAT</strong>. VAT is calculated at checkout from your billing address and
                        shown before you pay: 23% in Portugal, your own country&apos;s rate elsewhere
                        in the EU, and none outside it. A business in another EU country that enters
                        a valid VAT number is invoiced without VAT under the reverse-charge rule.
                        Stripe — not this service — handles the payment and issues the invoice.
                        Card details never reach our servers.
                    </p>
                    <p>
                        A subscription renews automatically each month until you cancel. Each paid
                        renewal issues a fresh licence key for the period you paid for. Enterprise is
                        not sold self-serve: it is agreed by e-mail.
                    </p>
                </Section>

                <Section id="cancelling" title="Cancelling, and what happens next">
                    <p>
                        You can cancel at any time from <strong>Settings → Billing</strong>, which
                        opens Stripe's own portal. Cancelling stops the next renewal; it does not cut
                        off the period you already paid for.
                    </p>
                    <p>
                        When a subscription ends, the ceilings revert to the free tier. Nothing is
                        deleted because you stopped paying, the software keeps working, and your data
                        stays yours to export at any time (Settings → Danger Zone).
                    </p>
                </Section>

                <Section id="withdrawal" title="14-day right of withdrawal, and refunds">
                    <p>
                        If you are a consumer in the EU, you have{' '}
                        <strong>14 days from the day you subscribe to change your mind</strong>, for
                        any reason or none, and get a full refund. Write to{' '}
                        <a href={`mailto:${CONTROLLER_EMAIL}`} className="underline">
                            {CONTROLLER_EMAIL}
                        </a>{' '}
                        and say you are withdrawing; no form, no explanation needed. The refund goes
                        back to the card you paid with.
                    </p>
                    <p>
                        This right is often waived for digital services that start immediately. It is
                        not waived here, because waiving it requires asking you to agree to that at
                        checkout, and we do not ask.
                    </p>
                    <p>
                        Outside those 14 days, a month already started is not refunded by default —
                        but if the service did not do what this page says it does, write to us and
                        say so. Refunds for a service that failed are not a favour.
                    </p>
                </Section>

                <Section id="availability" title="Availability">
                    <p>
                        This is a single-operator service and it carries no uptime guarantee. Current
                        status is published at <a href="/status" className="underline">/status</a>,
                        and planned interruptions are announced there. If you need a service level in
                        writing, that is an Enterprise conversation — or a reason to self-host, which
                        costs nothing.
                    </p>
                </Section>

                <Section id="warranty" title="Disclaimer of warranty">
                    <p>
                        The service is provided &quot;as is&quot;, without warranties of any kind,
                        express or implied, as to its accuracy, timeliness or fitness for a
                        particular purpose. The software's own warranty terms are in the Apache-2.0
                        licence.
                    </p>
                </Section>

                <Section id="liability" title="Limitation of liability">
                    <p>
                        To the maximum extent permitted by law, BolaLabs is not liable for indirect
                        or incidental damages or loss of profits arising from use of this service;
                        total liability is limited to the amount you actually paid for the service in
                        the 12 months preceding the event. Nothing in these terms excludes liability
                        that cannot be excluded or limited by law.
                    </p>
                </Section>

                <Section id="data" title="Your data">
                    <p>
                        What this service stores, who it reaches, for how long, and how to export or
                        erase it is set out in the{' '}
                        <a href="/privacy" className="underline">
                            privacy policy
                        </a>
                        . One thing worth repeating here: erasing your data needs your subscription
                        cancelled first, because deleting the billing record while Stripe is still
                        charging you would leave nobody able to stop it.
                    </p>
                </Section>

                <Section id="law" title="Governing law">
                    <p>
                        These terms are governed by Portuguese law. Any dispute falls under the
                        jurisdiction of the courts of the district of Lisbon, without prejudice to
                        any applicable mandatory consumer-protection rules.
                    </p>
                </Section>

                <Section id="changes" title="Changes to these terms">
                    <p>
                        Should any material change be made, this page is updated and the date at the
                        top changes with it. A change that affects a subscription you already hold
                        does not apply to the period you have paid for.
                    </p>
                </Section>

                <p className="mt-12 border-t border-slate-200 pt-6 text-sm dark:border-slate-800">
                    <a href="/" className="underline">
                        Back to GitHub Repo Manager
                    </a>
                </p>
            </article>
        </main>
    )
}
