import { SectionCard } from '../shared/SectionCard'
import { LabelPills } from './LabelPills'
import { ReviewerPills } from './ReviewerPills'

const SUMMARY_CHIPS = [
    { id: 'shorter', label: 'Shorter' },
    { id: 'more_context', label: 'More context' },
    { id: 'architecture_notes', label: 'Architecture notes' },
]

const TEST_PLAN_CHIPS = [
    { id: 'more_cases', label: 'More cases' },
    { id: 'edge_cases', label: 'Edge cases' },
    { id: 'e2e_focus', label: 'E2E focus' },
]

export function PRSections({ sections, onSectionChange, onRefine, refiningSection, loading, labels, onLabelsChange, reviewers, onReviewersChange }) {
    if (loading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-20 ds-skeleton rounded-xl" />)}
            </div>
        )
    }

    if (!sections) return null

    return (
        <div className="space-y-3">
            <SectionCard
                title="Title"
                content={sections.title}
                onContentChange={(v) => onSectionChange('title', v)}
            />
            <SectionCard
                title="Summary"
                content={sections.summary}
                onContentChange={(v) => onSectionChange('summary', v)}
                chips={SUMMARY_CHIPS}
                onRefine={(id) => onRefine('pr_summary', id)}
                refining={refiningSection === 'pr_summary'}
            />
            <SectionCard
                title="Test Plan"
                content={sections.test_plan}
                onContentChange={(v) => onSectionChange('test_plan', v)}
                chips={TEST_PLAN_CHIPS}
                onRefine={(id) => onRefine('pr_test_plan', id)}
                refining={refiningSection === 'pr_test_plan'}
            />
            <SectionCard
                title="Breaking Changes"
                content={sections.breaking_changes || 'None detected'}
                onContentChange={(v) => onSectionChange('breaking_changes', v)}
            />
            {sections.related_issues?.length > 0 && (
                <SectionCard
                    title="Related Issues"
                    content={sections.related_issues.map(i => `${i.relation} #${i.number}`).join('\n')}
                />
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <span className="ds-eyebrow text-slate-600 dark:text-slate-300">Labels</span>
                <LabelPills
                    labels={labels}
                    onRemove={(l) => onLabelsChange(labels.filter(x => x !== l))}
                    onAdd={(l) => onLabelsChange([...labels, l])}
                />
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <span className="ds-eyebrow text-slate-600 dark:text-slate-300">Reviewers</span>
                <ReviewerPills
                    reviewers={reviewers}
                    onRemove={(r) => onReviewersChange(reviewers.filter(x => x !== r))}
                    onAdd={(r) => onReviewersChange([...reviewers, r])}
                />
            </div>
        </div>
    )
}
