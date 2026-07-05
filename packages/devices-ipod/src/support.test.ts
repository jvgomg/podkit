/**
 * Unit tests for the generation support matrix — the two-axis access tier
 * (`syncable` / `read-only` / `none`) and its orthogonal verification
 * provenance (`hardware` / `inferred`).
 */

import { describe, expect, it } from 'bun:test';
import { resolveGenerationSupport, getSupportMatrix } from './support.js';
import { GENERATIONS } from './tables/generations.js';
import { IPOD_GENERATION_IDS } from './types.js';

// =============================================================================
// resolveGenerationSupport
// =============================================================================

describe('resolveGenerationSupport', () => {
  it('reports shuffle 4g as read-only, hardware-verified', () => {
    const support = resolveGenerationSupport('shuffle_4g');
    expect(support.access).toBe('read-only');
    expect(support.verified).toBe('hardware');
    expect(support.note).toBeDefined();
  });

  it('reports shuffle 3g as read-only, inferred', () => {
    const support = resolveGenerationSupport('shuffle_3g');
    expect(support.access).toBe('read-only');
    expect(support.verified).toBe('inferred');
  });

  it('reports nano 6g as read-only, inferred', () => {
    const support = resolveGenerationSupport('nano_6g');
    expect(support.access).toBe('read-only');
    expect(support.verified).toBe('inferred');
  });

  it('reports an iPod touch as none, inferred', () => {
    const support = resolveGenerationSupport('touch_5g');
    expect(support.access).toBe('none');
    expect(support.verified).toBe('inferred');
  });

  it('reports nano 7g as none, inferred', () => {
    const support = resolveGenerationSupport('nano_7g');
    expect(support.access).toBe('none');
    expect(support.verified).toBe('inferred');
  });

  it('reports a syncable classic/nano generation as syncable, inferred', () => {
    // `access` is the contract; `verified` on the syncable path is table state
    // that contributors upgrade to `hardware` as devices are tested — don't pin it.
    expect(resolveGenerationSupport('classic_6g').access).toBe('syncable');
    expect(resolveGenerationSupport('nano_4g').access).toBe('syncable');
  });
});

// =============================================================================
// getSupportMatrix
// =============================================================================

describe('getSupportMatrix', () => {
  it('returns one row per generation in the table', () => {
    const matrix = getSupportMatrix();
    expect(matrix).toHaveLength(IPOD_GENERATION_IDS.length);
    expect(new Set(matrix.map((r) => r.generation))).toEqual(new Set(IPOD_GENERATION_IDS));
  });

  it('carries access + verified + display name on every row', () => {
    for (const row of getSupportMatrix()) {
      expect(['syncable', 'read-only', 'none']).toContain(row.access);
      expect(['hardware', 'inferred']).toContain(row.verified);
      expect(row.displayName.length).toBeGreaterThan(0);
    }
  });

  it('stays in lock-step with the generation table', () => {
    for (const row of getSupportMatrix()) {
      expect(row.access).toBe(GENERATIONS[row.generation].support.access);
      expect(row.verified).toBe(GENERATIONS[row.generation].support.verified);
    }
  });

  it('surfaces the read-only shuffle 4g row with its note', () => {
    const shuffle = getSupportMatrix().find((r) => r.generation === 'shuffle_4g');
    expect(shuffle).toBeDefined();
    expect(shuffle!.access).toBe('read-only');
    expect(shuffle!.verified).toBe('hardware');
    expect(shuffle!.note).toMatch(/iTunesSD/);
  });
});
