import { describe, it, expect } from 'vitest';
import { pickStrategies } from '../routes/import/azure/tfvc.js';
import { azureTfvcImportSchema } from '../lib/validators.js';

describe('tfvc cascade — pickStrategies', () => {
  it('returns all three strategies in order by default', () => {
    const s = pickStrategies();
    expect(s.map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
  });

  it('returns exactly the forced strategy for each valid camelCase key', () => {
    expect(pickStrategies('importApi').map(x => x.name)).toEqual(['importApi']);
    expect(pickStrategies('gitTfs').map(x => x.name)).toEqual(['gitTfs']);
    expect(pickStrategies('snapshot').map(x => x.name)).toEqual(['snapshot']);
  });

  it('undefined forceStrategy yields the full 3-strategy cascade', () => {
    expect(pickStrategies(undefined).map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
  });

  it('falls back to full cascade for unknown forceStrategy', () => {
    expect(pickStrategies('bogus').map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
  });

  it('old kebab-case key falls through to the full cascade (why the enum had to match)', () => {
    // 'import-api' is NOT a key of pickStrategies(); it silently degrades to
    // the full cascade. The validators enum now rejects kebab-case at the edge
    // so this never reaches pickStrategies in production — see schema tests.
    expect(pickStrategies('import-api').map(x => x.name)).toEqual(['importApi', 'gitTfs', 'snapshot']);
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

describe('azureTfvcImportSchema — forceStrategy enum + savedCredentialId', () => {
  const base = { azureOrg: 'org', azureProject: 'proj', tfvcPath: '$/x' };

  it('accepts a camelCase forceStrategy together with savedCredentialId', () => {
    const result = azureTfvcImportSchema.safeParse({
      ...base,
      forceStrategy: 'importApi',
      savedCredentialId: 7,
    });
    expect(result.success).toBe(true);
    expect(result.data.forceStrategy).toBe('importApi');
    expect(result.data.savedCredentialId).toBe(7);
  });

  it('accepts each valid forceStrategy key', () => {
    for (const force of ['importApi', 'gitTfs', 'snapshot']) {
      expect(azureTfvcImportSchema.safeParse({ ...base, forceStrategy: force }).success).toBe(true);
    }
  });

  it('rejects the old kebab-case forceStrategy "import-api"', () => {
    const result = azureTfvcImportSchema.safeParse({ ...base, forceStrategy: 'import-api' });
    expect(result.success).toBe(false);
  });

  it('rejects a bogus forceStrategy', () => {
    const result = azureTfvcImportSchema.safeParse({ ...base, forceStrategy: 'bogus' });
    expect(result.success).toBe(false);
  });

  it('accepts savedCredentialId as a string too', () => {
    expect(azureTfvcImportSchema.safeParse({ ...base, savedCredentialId: '7' }).success).toBe(true);
  });
});
