import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PremiumRationale } from '../../../src/components/AI/PremiumRationale';

describe('<PremiumRationale />', () => {
    it('shows confidence pill', () => {
        render(<PremiumRationale source="ai" rationale="Used README and topics." confidence="high" signalsUsed={[]} redactions={[]} />);
        expect(screen.getByText(/high/i)).toBeInTheDocument();
    });

    it('renders signal chips', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[
            { kind: 'readme', label: 'README', bytes: 1500 },
            { kind: 'manifest', label: 'package.json', bytes: 600 },
        ]} redactions={[]} />);
        expect(screen.getByText(/README/)).toBeInTheDocument();
        expect(screen.getByText(/package\.json/)).toBeInTheDocument();
    });

    it('shows redaction notice when redactions > 0', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[]} redactions={[{ file: 'package.json', count: 2 }]} />);
        expect(screen.getByText(/2 lines redacted/i)).toBeInTheDocument();
    });

    it('hides redaction notice when redactions array is empty', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[]} redactions={[]} />);
        expect(screen.queryByText(/redacted/i)).toBeNull();
    });

    it('shows low-confidence amber notice', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="low" signalsUsed={[]} redactions={[]} />);
        expect(screen.getByText(/quality limited/i)).toBeInTheDocument();
    });
});
