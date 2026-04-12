import { RefinementChips } from './RefinementChips'
import { ChatInput } from './ChatInput'
import { VersionHistory } from './VersionHistory'

export function RefinementZone({ chips, onChipSelect, onChatSubmit, disabled, placeholder, versions, onRestore }) {
    return (
        <div className="space-y-3">
            {chips && chips.length > 0 && (
                <RefinementChips chips={chips} onSelect={onChipSelect} disabled={disabled} />
            )}
            <ChatInput placeholder={placeholder || 'Refine...'} onSubmit={onChatSubmit} disabled={disabled} />
            <VersionHistory versions={versions || []} onRestore={onRestore} />
        </div>
    )
}
