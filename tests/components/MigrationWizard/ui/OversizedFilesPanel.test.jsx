import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { OversizedFilesPanel } from '../../../../src/components/MigrationWizard/ui/OversizedFilesPanel'
import { decodeOversizedError } from '../../../../src/components/MigrationWizard/ui/oversizedError'

describe('decodeOversizedError', () => {
  it('returns null for plain-text errors', () => {
    expect(decodeOversizedError('boring error')).toBeNull()
    expect(decodeOversizedError(null)).toBeNull()
  })

  it('parses sentinel-prefixed payloads', () => {
    const files = [{ path: 'x.dll', sizeBytes: 200 * 1024 ** 2 }]
    const encoded = `OVERSIZED_FILES:${JSON.stringify({ files })}|fallback msg`
    const decoded = decodeOversizedError(encoded)
    expect(decoded).toEqual({ files, fallback: 'fallback msg' })
  })

  it('rejects malformed JSON', () => {
    expect(decodeOversizedError('OVERSIZED_FILES:not-json')).toBeNull()
  })
})

describe('OversizedFilesPanel', () => {
  const files = [
    { path: 'Lib/StdMigrador100.dll', sizeBytes: 214 * 1024 ** 2 },
    { path: 'Bin/extra.pak', sizeBytes: 150 * 1024 ** 2 },
  ]

  it('renders headline with file count and total', () => {
    render(<OversizedFilesPanel files={files} fallback="rejected" />)
    expect(screen.getByText(/2 files exceed GitHub's 100 MB/)).toBeInTheDocument()
  })

  it('renders each offending path with its formatted size', () => {
    render(<OversizedFilesPanel files={files} fallback="" />)
    expect(screen.getByText('Lib/StdMigrador100.dll')).toBeInTheDocument()
    expect(screen.getByText('Bin/extra.pak')).toBeInTheDocument()
    // formatFileSize(214 MiB, 1) → "214 MB"
    expect(screen.getByText(/214 MB/)).toBeInTheDocument()
    expect(screen.getByText(/150 MB/)).toBeInTheDocument()
  })

  it('shows the how-to-fix guidance with LFS instructions', () => {
    render(<OversizedFilesPanel files={files} fallback="" />)
    expect(screen.getByText(/Migrate to Git LFS/)).toBeInTheDocument()
    expect(screen.getByText(/git lfs migrate import --above=100M --everything/)).toBeInTheDocument()
  })

  it('uses singular form for a single file', () => {
    render(<OversizedFilesPanel files={[files[0]]} fallback="" />)
    expect(screen.getByText(/1 file exceed/)).toBeInTheDocument()
  })

  it('shows fallback message when provided', () => {
    render(<OversizedFilesPanel files={files} fallback="Push rejected." />)
    expect(screen.getByText('Push rejected.')).toBeInTheDocument()
  })
})
