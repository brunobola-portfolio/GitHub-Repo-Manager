import { useMemo } from 'react'
import { GitCommitHorizontal, GitPullRequest, Eye } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useDevToolkit } from '../../hooks/useDevToolkit'
import { CommitTab } from './CommitTab/CommitTab'
import { PRTab } from './PRTab/PRTab'
import { ReviewTab } from './ReviewTab/ReviewTab'

const TABS = [
    { id: 'commits', label: 'Commits', icon: GitCommitHorizontal },
    { id: 'pr', label: 'Pull Request', icon: GitPullRequest },
    { id: 'review', label: 'Review', icon: Eye },
]

export function DevToolkitModal({ isOpen, onClose, modalData, repos, askAI, onStartReview }) {
    const toolkit = useDevToolkit({
        repos,
        initialTab: modalData?.initialTab,
        initialRepo: modalData?.repo,
        initialBranch: modalData?.branch,
        initialPR: modalData?.pr,
    })

    const content = useMemo(() => {
        switch (toolkit.activeTab) {
            case 'commits':
                return <CommitTab toolkit={toolkit} askAI={askAI} />
            case 'pr':
                return <PRTab toolkit={toolkit} />
            case 'review':
                return <ReviewTab toolkit={toolkit} onStartReview={onStartReview} onClose={onClose} />
            default:
                return null
        }
    }, [toolkit, askAI, onStartReview, onClose])

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Dev Toolkit"
            subtitle="AI-powered developer tools"
            icon={GitCommitHorizontal}
            iconGradient="primary"
            size="3xl"
            tabs={TABS}
            activeTab={toolkit.activeTab}
            onTabChange={toolkit.setActiveTab}
            tabsLayoutId="dev-toolkit-tabs"
            mobileVariant="sheet"
        >
            {content}
        </Modal>
    )
}
