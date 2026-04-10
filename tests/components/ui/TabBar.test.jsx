import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from '../../../src/components/ui/TabBar';

vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion');
    return {
        ...actual,
        useReducedMotion: () => true,
    };
});

const TABS = [
    { id: 'files', label: 'Files' },
    { id: 'activity', label: 'Activity' },
    { id: 'settings', label: 'Settings' },
];

const MockIcon = ({ className }) => <svg data-testid="mock-icon" className={className} />;

const TABS_WITH_ICONS = [
    { id: 'files', label: 'Files', icon: MockIcon },
    { id: 'activity', label: 'Activity', icon: MockIcon },
];

describe('TabBar', () => {
    it('renders all tabs with correct ARIA attributes', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getByRole('tablist')).toBeInTheDocument();
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);

        expect(tabs[0]).toHaveTextContent('Files');
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[0]).toHaveAttribute('tabindex', '0');
        expect(tabs[0]).toHaveAttribute('aria-controls', 'tabpanel-test-files');
        expect(tabs[0]).toHaveAttribute('id', 'tab-test-files');

        expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
        expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    });

    it('calls onTabChange when a tab is clicked', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        await user.click(screen.getByRole('tab', { name: /Activity/i }));
        expect(onTabChange).toHaveBeenCalledWith('activity');
    });

    it('navigates with ArrowRight and wraps around', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="settings" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Settings/i }).focus();
        await user.keyboard('{ArrowRight}');
        expect(onTabChange).toHaveBeenCalledWith('files');
    });

    it('navigates with ArrowLeft and wraps around', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Files/i }).focus();
        await user.keyboard('{ArrowLeft}');
        expect(onTabChange).toHaveBeenCalledWith('settings');
    });

    it('navigates with Home and End keys', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="activity" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Activity/i }).focus();
        await user.keyboard('{Home}');
        expect(onTabChange).toHaveBeenCalledWith('files');

        await user.keyboard('{End}');
        expect(onTabChange).toHaveBeenCalledWith('settings');
    });

    it('renders icons when provided', () => {
        render(
            <TabBar tabs={TABS_WITH_ICONS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getAllByTestId('mock-icon')).toHaveLength(2);
    });

    it('renders without icons when not provided', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.queryByTestId('mock-icon')).not.toBeInTheDocument();
    });

    it('renders pill variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('rounded-2xl');
    });

    it('renders underline variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="underline" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('border-b');
    });

    it('renders segmented variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="segmented" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('rounded-lg');
    });

    it('applies size="sm" classes', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" size="sm" />
        );

        const tab = screen.getAllByRole('tab')[0];
        expect(tab.className).toContain('text-xs');
    });

    it('applies custom className to container', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" className="mt-4" />
        );

        expect(screen.getByRole('tablist').className).toContain('mt-4');
    });
});
