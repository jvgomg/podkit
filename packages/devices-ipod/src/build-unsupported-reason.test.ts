/**
 * Tests for the access-aware refusal wording. `accessLimitationHeadline` is the
 * single source of the "why podkit won't sync this" sentence across the
 * identify cascade, worded by access tier.
 */

import { describe, expect, it } from 'bun:test';
import { accessLimitationHeadline } from './build-unsupported-reason.js';
import type { GenerationSupport } from './types.js';

const support = (access: GenerationSupport['access']): GenerationSupport => ({
  access,
  verified: 'inferred',
});

describe('accessLimitationHeadline', () => {
  it('says nothing for a syncable generation', () => {
    expect(
      accessLimitationHeadline('iPod classic (6th Generation)', support('syncable'))
    ).toBeUndefined();
  });

  it('tells a read-only device it can still be read and archived', () => {
    const headline = accessLimitationHeadline(
      'iPod shuffle (4th Generation)',
      support('read-only')
    );
    expect(headline).toBeDefined();
    expect(headline).toMatch(/read-only/i);
    expect(headline).toMatch(/archive/i);
    expect(headline).toMatch(/cannot sync/i);
  });

  it('flatly refuses a none-access generation', () => {
    const headline = accessLimitationHeadline('iPod touch (5th Generation)', support('none'));
    expect(headline).toBe('iPod touch (5th Generation) is not a podkit-supported generation.');
  });
});
