import { describe, it, expect } from 'vitest';
import { pickStrategies } from '../routes/import/azure/tfvc.js';

describe('tfvc cascade — pickStrategies', () => {
  it('returns all three strategies in order by default', () => {
    const s = pickStrategies();
    expect(s.map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
  });

  it('returns only the forced strategy when forceStrategy is set', () => {
    expect(pickStrategies('gitTfs').map(x => x.name)).toEqual(['gitTfs']);
    expect(pickStrategies('snapshot').map(x => x.name)).toEqual(['snapshot']);
    expect(pickStrategies('importApi').map(x => x.name)).toEqual(['importApi']);
  });

  it('falls back to full cascade for unknown forceStrategy', () => {
    expect(pickStrategies('bogus').map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
  });

  it('every strategy has the expected shape', () => {
    for (const s of pickStrategies()) {
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('startPct');
      expect(typeof s.run).toBe('function');
    }
  });
});
