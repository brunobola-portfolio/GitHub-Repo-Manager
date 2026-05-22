import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ConnectionStatusPanel from '@/components/MigrationWizard/ui/ConnectionStatusPanel'

/**
 * Smoke coverage for the post-Loader2→SpinnerIcon migration. The panel's
 * StepIcon switches between several lucide icons by status — once status
 * is 'loading' the spinner becomes the icon, so we verify the SVG that
 * SpinnerIcon emits actually shows up under those conditions.
 *
 * SpinnerIcon is aria-hidden by design (the status text alongside it carries
 * the announcement) — we still need to know it renders, so we look for the
 * self-animating SVG that the primitive emits.
 */
describe('<ConnectionStatusPanel />', () => {
    afterEach(() => cleanup())

    it('renders nothing when no inputs have been provided yet (clean form)', () => {
        const { container } = render(
            <ConnectionStatusPanel
                host=""
                org=""
                credentialReady={false}
                validating={false}
                validated={false}
                validationError={null}
                projectsCount={0}
            />
        )
        expect(container).toBeEmptyDOMElement()
    })

    it('shows the SpinnerIcon SVG on the validate step while validating is true', () => {
        const { container } = render(
            <ConnectionStatusPanel
                host="dev.azure.com"
                org="acme"
                credentialReady
                validating
                validated={false}
                validationError={null}
                projectsCount={0}
            />
        )

        // The "A contactar" detail message confirms the loading step is active.
        expect(screen.getByText(/A contactar/i)).toBeInTheDocument()

        // SpinnerIcon emits an aria-hidden, animate-spin SVG. There is exactly
        // one such SVG in this state — the validate step.
        const spinners = container.querySelectorAll('svg.animate-spin')
        expect(spinners.length).toBe(1)
        expect(spinners[0].getAttribute('aria-hidden')).toBe('true')
    })

    it('marks the overall panel as "Conexão pronta" when every step is ok', () => {
        render(
            <ConnectionStatusPanel
                host="dev.azure.com"
                org="acme"
                credentialReady
                validating={false}
                validated
                validationError={null}
                projectsCount={3}
            />
        )
        expect(screen.getByText(/Conexão pronta/i)).toBeInTheDocument()
        expect(screen.getByText(/3 projectos carregados/i)).toBeInTheDocument()
    })

    it('marks the overall panel as failed when validationError is set', () => {
        render(
            <ConnectionStatusPanel
                host="dev.azure.com"
                org="acme"
                credentialReady
                validating={false}
                validated={false}
                validationError="HTTP 401: PAT recusado"
                projectsCount={0}
            />
        )
        expect(screen.getByText(/Conexão falhou/i)).toBeInTheDocument()
        expect(screen.getByText(/HTTP 401/)).toBeInTheDocument()
    })

    it('uses "passo" (PT-PT) — not the ES typo "paso" — on pending step copy', () => {
        // Regression guard for the ConnectionStatusPanel typo fix shipped
        // alongside the modal-unification panel review.
        render(
            <ConnectionStatusPanel
                host="dev.azure.com"
                org="acme"
                credentialReady={false}
                validating={false}
                validated={false}
                validationError={null}
                projectsCount={0}
            />
        )
        // 'Aguarda passo anterior' should be present (the validate step pending
        // copy fires once parse=ok but credStep=pending).
        expect(screen.queryByText(/Aguarda paso anterior/)).not.toBeInTheDocument()
        expect(screen.getByText(/Aguarda passo anterior/)).toBeInTheDocument()
    })
})
