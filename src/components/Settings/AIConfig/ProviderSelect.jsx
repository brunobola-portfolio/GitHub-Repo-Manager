import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
} from '../../../utils/providerCapabilities'
import { Select } from '../../ui/Select'

// ---------------------------------------------------------------------------
// Sub-component: ProviderSelect
// ---------------------------------------------------------------------------

/**
 * Completion-provider picker. Uses the shared premium `Select` so it stays
 * visually coherent with the Embedding-provider picker (same component) and
 * the model dropdown — instead of an unstyleable native <select> whose open
 * list is rendered by the OS.
 */
export function ProviderSelect({ value, onChange }) {
    return (
        <Select
            label="Completion provider"
            value={value ?? ''}
            onChange={(v) => onChange(v || null)}
            placeholder="— Select a provider —"
            options={[
                { value: '', label: '— Select a provider —' },
                ...PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDER_LABELS[id] })),
            ]}
        />
    )
}
