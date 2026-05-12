import { describe, it, expect } from 'bun:test';
import { IPOD_CAPABILITY_KEYS, validateCapabilityOverrides } from './validate-overrides.js';

describe('IPOD_CAPABILITY_KEYS', () => {
  it('is empty — iPod capabilities are not user-overridable', () => {
    expect(IPOD_CAPABILITY_KEYS).toEqual([]);
  });
});

describe('validateCapabilityOverrides (iPod)', () => {
  it('returns ok for empty overrides', () => {
    expect(validateCapabilityOverrides({})).toEqual({ ok: true });
  });

  it('ignores keys with undefined values (no-op overrides)', () => {
    const result = validateCapabilityOverrides({
      artworkSources: undefined,
      supportsVideo: undefined,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects any single capability override', () => {
    const result = validateCapabilityOverrides({ supportsVideo: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        field: 'supportsVideo',
        code: 'OVERRIDE_NOT_SUPPORTED',
      });
      expect(result.errors[0]!.message).toContain('"supportsVideo"');
      expect(result.errors[0]!.message).toContain('generation tables');
    }
  });

  it('reports all rejected keys, not first-fail', () => {
    const result = validateCapabilityOverrides({
      artworkSources: ['embedded'],
      artworkMaxResolution: 320,
      supportsVideo: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(['artworkMaxResolution', 'artworkSources', 'supportsVideo']);
      for (const err of result.errors) {
        expect(err.code).toBe('OVERRIDE_NOT_SUPPORTED');
      }
    }
  });
});
