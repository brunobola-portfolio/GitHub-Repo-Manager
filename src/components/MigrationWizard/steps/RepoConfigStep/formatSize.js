import { formatFileSize } from '../../../../utils/format'

// Wrapper kept to preserve "0 B" empty-state copy and the "0 decimals for B"
// rendering the wizard expects. Shared by RepoMetadataBadges (per-repo size)
// and the dashboard header (total size).
export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  return formatFileSize(bytes, bytes < 1024 ? 0 : 1).replace('Bytes', 'B')
}
