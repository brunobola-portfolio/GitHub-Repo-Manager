import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageGeneratorModal } from '../../../src/components/AI/ImageGeneratorModal.jsx'

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        images: {
            capability: vi.fn(),
            generate: vi.fn(),
            commit: vi.fn(),
        },
    },
}))

vi.mock('../../../src/utils/appEvents', () => ({
    openAISettings: vi.fn(),
}))

import { aiApi } from '../../../src/api/ai'
import { openAISettings } from '../../../src/utils/appEvents'

const REPO = { id: 1, name: 'lib', full_name: 'acme/lib', owner: { login: 'acme' }, language: 'JavaScript' }

const AVAILABLE_CAPABILITY = {
    available: true,
    provider: 'gemini',
    model: 'gemini-2.5-flash-image',
    reason: null,
    presets: {
        social: { label: 'Social preview', dimensions: '1280x640', path: 'docs/images/social-preview.png', cost: { costCents: 4, estimated: false } },
        hero: { label: 'README hero', dimensions: '1200x400', path: 'docs/images/readme-hero.png', cost: { costCents: 4, estimated: false } },
        logo: { label: 'Logo draft', dimensions: '512x512', path: 'docs/images/logo-draft.png', cost: { costCents: 4, estimated: false } },
    },
}

const UNAVAILABLE_CAPABILITY = {
    available: false,
    provider: 'anthropic',
    model: null,
    reason: 'provider_not_image_capable',
    presets: {
        social: { label: 'Social preview', dimensions: '1280x640', path: 'docs/images/social-preview.png', cost: null },
        hero: { label: 'README hero', dimensions: '1200x400', path: 'docs/images/readme-hero.png', cost: null },
        logo: { label: 'Logo draft', dimensions: '512x512', path: 'docs/images/logo-draft.png', cost: null },
    },
}

const GENERATE_RESULT = {
    success: true,
    preset: 'social',
    path: 'docs/images/social-preview.png',
    dimensions: '1280x640',
    base64: 'ZmFrZXBuZw==',
    mimeType: 'image/png',
    provider: 'gemini',
    model: 'gemini-2.5-flash-image',
    costCents: 4,
    estimatedCost: false,
}

beforeEach(() => {
    aiApi.images.capability.mockReset()
    aiApi.images.generate.mockReset()
    aiApi.images.commit.mockReset()
    openAISettings.mockReset()
})

describe('ImageGeneratorModal — capability gate', () => {
    it('shows a loading state while the capability check is in flight', async () => {
        aiApi.images.capability.mockReturnValue(new Promise(() => {})) // never resolves
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)
        expect(screen.getByText(/checking image generation availability/i)).toBeInTheDocument()
    })

    it('shows a static "not available" state — never a spinner-then-fail — when the provider cannot generate images', async () => {
        aiApi.images.capability.mockResolvedValue(UNAVAILABLE_CAPABILITY)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        expect(await screen.findByTestId('image-generator-unavailable')).toBeInTheDocument()
        expect(screen.getByText(/anthropic/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^generate$/i })).not.toBeInTheDocument()
    })

    it('links the unavailable state to AI Settings', async () => {
        const user = userEvent.setup()
        aiApi.images.capability.mockResolvedValue(UNAVAILABLE_CAPABILITY)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        await user.click(await screen.findByRole('button', { name: /open ai settings/i }))
        expect(openAISettings).toHaveBeenCalledTimes(1)
    })

    it('offers a "Generate a diagram instead" fallback that closes this modal and opens the diagram generator', async () => {
        const user = userEvent.setup()
        aiApi.images.capability.mockResolvedValue(UNAVAILABLE_CAPABILITY)
        const onClose = vi.fn()
        const onFallbackToDiagram = vi.fn()
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={onClose} onFallbackToDiagram={onFallbackToDiagram} />)

        await user.click(await screen.findByRole('button', { name: /generate a diagram instead/i }))
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(onFallbackToDiagram).toHaveBeenCalledTimes(1)
    })

    it('shows a retryable error state when the capability check itself fails', async () => {
        aiApi.images.capability.mockRejectedValue(new Error('network down'))
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)
        expect(await screen.findByRole('alert')).toBeInTheDocument()
    })
})

describe('ImageGeneratorModal — configure → generate → preview', () => {
    beforeEach(() => {
        aiApi.images.capability.mockResolvedValue(AVAILABLE_CAPABILITY)
    })

    it('shows the preset picker and a cost estimate once capability resolves', async () => {
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)
        expect(await screen.findByRole('combobox', { name: /image type/i })).toBeInTheDocument()
        expect(screen.getByText(/\$0\.04/)).toBeInTheDocument()
    })

    it('generates the selected preset and renders an inline preview — never writes to the repo yet', async () => {
        const user = userEvent.setup()
        aiApi.images.generate.mockResolvedValue(GENERATE_RESULT)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.images.generate).toHaveBeenCalledTimes(1))
        const [repoArg, config] = aiApi.images.generate.mock.calls[0]
        expect(repoArg).toEqual(REPO)
        expect(config.preset).toBe('social')

        expect(await screen.findByTestId('image-generator-preview')).toBeInTheDocument()
        expect(screen.getByTestId('image-generator-path')).toHaveTextContent('docs/images/social-preview.png')
        expect(aiApi.images.commit).not.toHaveBeenCalled()
    })

    it('passes the user-typed style hint as promptExtras', async () => {
        const user = userEvent.setup()
        aiApi.images.generate.mockResolvedValue(GENERATE_RESULT)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        const hintField = await screen.findByPlaceholderText(/teal and navy palette/i)
        fireEvent.change(hintField, { target: { value: 'warm sunset colors' } })
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.images.generate).toHaveBeenCalledTimes(1))
        expect(aiApi.images.generate.mock.calls[0][1].promptExtras).toBe('warm sunset colors')
    })

    it('shows a refusal error inline via the shared AI error primitive and does not advance to the preview stage', async () => {
        const user = userEvent.setup()
        const err = new Error('The AI provider declined to generate this image.')
        err.code = 'IMAGE_REFUSAL'
        aiApi.images.generate.mockRejectedValue(err)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        expect(await screen.findByText(/image generation declined/i)).toBeInTheDocument()
        expect(screen.queryByTestId('image-generator-preview')).not.toBeInTheDocument()
    })

    it('shows a quota-exceeded error with an upgrade action', async () => {
        const user = userEvent.setup()
        const err = new Error('Image generation limit reached')
        err.code = 'QUOTA_EXCEEDED'
        err.status = 429
        aiApi.images.generate.mockRejectedValue(err)
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        expect(await screen.findByText(/quota exceeded/i)).toBeInTheDocument()
    })

    // r5 §4.7: "On any image-generation failure... the feature must never
    // hard-fail the surrounding flow." The fallback must appear for every
    // runtime failure mode, not just the pre-flight capability-absent stage.
    it('offers the diagram fallback alongside a quota-exceeded runtime error', async () => {
        const user = userEvent.setup()
        const err = new Error('Image generation limit reached')
        err.code = 'QUOTA_EXCEEDED'
        err.status = 429
        aiApi.images.generate.mockRejectedValue(err)
        const onFallbackToDiagram = vi.fn()
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} onFallbackToDiagram={onFallbackToDiagram} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        await screen.findByText(/quota exceeded/i)
        await user.click(screen.getByRole('button', { name: /generate a diagram instead/i }))
        expect(onFallbackToDiagram).toHaveBeenCalledTimes(1)
    })

    it('offers the diagram fallback alongside a refusal runtime error', async () => {
        const user = userEvent.setup()
        const err = new Error('The AI provider declined to generate this image.')
        err.code = 'IMAGE_REFUSAL'
        aiApi.images.generate.mockRejectedValue(err)
        const onFallbackToDiagram = vi.fn()
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} onFallbackToDiagram={onFallbackToDiagram} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        await screen.findByText(/image generation declined/i)
        expect(screen.getByRole('button', { name: /generate a diagram instead/i })).toBeInTheDocument()
    })

    it('offers the diagram fallback alongside a generic provider-error runtime failure', async () => {
        const user = userEvent.setup()
        aiApi.images.generate.mockRejectedValue(new Error('Provider request failed'))
        const onFallbackToDiagram = vi.fn()
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} onFallbackToDiagram={onFallbackToDiagram} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        await screen.findByRole('alert')
        expect(screen.getByRole('button', { name: /generate a diagram instead/i })).toBeInTheDocument()
    })

    it('omits the diagram fallback on a runtime error when no onFallbackToDiagram prop is provided', async () => {
        const user = userEvent.setup()
        aiApi.images.generate.mockRejectedValue(new Error('Provider request failed'))
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)

        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        await screen.findByRole('alert')
        expect(screen.queryByRole('button', { name: /generate a diagram instead/i })).not.toBeInTheDocument()
    })
})

describe('ImageGeneratorModal — preview → commit', () => {
    beforeEach(() => {
        aiApi.images.capability.mockResolvedValue(AVAILABLE_CAPABILITY)
        aiApi.images.generate.mockResolvedValue(GENERATE_RESULT)
    })

    async function toPreview(user) {
        render(<ImageGeneratorModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(await screen.findByRole('button', { name: /^generate$/i }))
        await screen.findByTestId('image-generator-preview')
    }

    it('commits the exact accepted base64 (never re-generates server-side) on Apply', async () => {
        const user = userEvent.setup()
        aiApi.images.commit.mockResolvedValue({ success: true, preset: 'social', path: 'docs/images/social-preview.png', mode: 'direct', branch: 'main', sha: 'abc123' })
        await toPreview(user)

        await user.click(screen.getByRole('button', { name: /^apply$/i }))

        await waitFor(() => expect(aiApi.images.commit).toHaveBeenCalledTimes(1))
        const payload = aiApi.images.commit.mock.calls[0][0]
        expect(payload.base64).toBe(GENERATE_RESULT.base64)
        expect(payload.preset).toBe('social')
        expect(payload.mode).toBe('direct')

        expect(await screen.findByText(/image committed/i)).toBeInTheDocument()
    })

    it('opens a PR when "Open PR" is used', async () => {
        const user = userEvent.setup()
        aiApi.images.commit.mockResolvedValue({ success: true, preset: 'social', path: 'docs/images/social-preview.png', mode: 'pr', branch: 'chore/image', prUrl: 'https://github.com/acme/lib/pull/9' })
        await toPreview(user)

        await user.click(screen.getByRole('button', { name: /open pr/i }))

        await waitFor(() => expect(aiApi.images.commit).toHaveBeenCalledTimes(1))
        expect(aiApi.images.commit.mock.calls[0][0].mode).toBe('pr')
        expect(await screen.findByRole('link', { name: /view pr/i })).toHaveAttribute('href', 'https://github.com/acme/lib/pull/9')
    })

    it('shows a commit error inline without losing the preview', async () => {
        const user = userEvent.setup()
        aiApi.images.commit.mockRejectedValue(new Error('write failed'))
        await toPreview(user)

        await user.click(screen.getByRole('button', { name: /^apply$/i }))

        expect(await screen.findByRole('alert')).toHaveTextContent(/write failed/i)
        expect(screen.getByTestId('image-generator-preview')).toBeInTheDocument()
    })
})
