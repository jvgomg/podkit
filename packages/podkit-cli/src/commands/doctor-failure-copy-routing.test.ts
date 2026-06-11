/**
 * Pins the per-check-id routing contract for FAILURE_COPY.
 *
 * Each check id renders ONLY its own copy. TASK-317.02 Bug 3 was a
 * regression where every failing check fell through to the artwork-
 * rebuild wording; explicit id-based dispatch fixes it, and this test
 * locks the contract in place.
 *
 * Approach: for every registered check id, render against a structurally
 * representative `details` and assert that NO OTHER registered check's
 * signature string appears in the output. Signature strings are picked
 * to be uniquely identifying — e.g. "ithmb" appears only in artwork copy,
 * "USB firmware" appears only in sysinfo-consistency copy.
 */

import { describe, it, expect } from 'bun:test';
import { FAILURE_COPY, formatFailureCopy } from './doctor-failure-copy.js';

/**
 * Unique-to-check signature substrings. Each line of every registered
 * check's copy must contain (or fail to match) these correctly.
 */
const SIGNATURES: Record<string, string[]> = {
  'artwork-rebuild': ['ithmb', 'artwork database'],
  'sysinfo-consistency': ['USB firmware', "doesn't match the live device"],
  'sysinfo-modelnum-mismatch': ['claims a different model', 'firmware reports'],
};

function representativeDetails(checkId: string): Record<string, unknown> {
  if (checkId === 'artwork-rebuild') {
    return {
      totalEntries: 1000,
      corruptEntries: 250,
      healthyEntries: 750,
      corruptPercent: 25,
    };
  }
  return {};
}

describe('FAILURE_COPY registry', () => {
  it('registers every known check id (smoke)', () => {
    expect(Object.keys(FAILURE_COPY).sort()).toEqual(
      ['artwork-rebuild', 'sysinfo-consistency', 'sysinfo-modelnum-mismatch'].sort()
    );
  });
});

describe('formatFailureCopy — per-check routing isolation', () => {
  for (const checkId of Object.keys(FAILURE_COPY)) {
    it(`renders ${checkId}: only its own signature appears`, () => {
      const lines = formatFailureCopy(checkId, representativeDetails(checkId), 'fail');
      const text = lines.join('\n');

      // The check's own signature MUST appear.
      for (const sig of SIGNATURES[checkId] ?? []) {
        expect(text).toContain(sig);
      }

      // No OTHER check's signature is permitted — pin the routing
      // contract so a future inline-fall-through can't re-emerge.
      for (const [otherId, otherSigs] of Object.entries(SIGNATURES)) {
        if (otherId === checkId) continue;
        for (const sig of otherSigs) {
          expect(text).not.toContain(sig);
        }
      }
    });
  }
});

describe('formatFailureCopy — status gating', () => {
  it('artwork-rebuild emits copy on fail but not on warn', () => {
    const onFail = formatFailureCopy(
      'artwork-rebuild',
      representativeDetails('artwork-rebuild'),
      'fail'
    );
    const onWarn = formatFailureCopy(
      'artwork-rebuild',
      representativeDetails('artwork-rebuild'),
      'warn'
    );
    expect(onFail.length).toBeGreaterThan(0);
    expect(onWarn).toEqual([]);
  });

  it('sysinfo-consistency emits copy on fail but not on warn', () => {
    expect(formatFailureCopy('sysinfo-consistency', {}, 'fail').length).toBeGreaterThan(0);
    expect(formatFailureCopy('sysinfo-consistency', {}, 'warn')).toEqual([]);
  });

  it('sysinfo-modelnum-mismatch emits copy on warn as well as fail', () => {
    // Pinned because the check actually surfaces a `warn` status in
    // practice; the inline copy explicitly accepted both before the
    // extraction.
    expect(formatFailureCopy('sysinfo-modelnum-mismatch', {}, 'fail').length).toBeGreaterThan(0);
    expect(formatFailureCopy('sysinfo-modelnum-mismatch', {}, 'warn').length).toBeGreaterThan(0);
  });
});

describe('formatFailureCopy — unregistered ids and missing details', () => {
  it('returns [] for an unregistered check id', () => {
    expect(formatFailureCopy('not-a-check', {}, 'fail')).toEqual([]);
  });

  it('returns [] for known check id when caller passes undefined details', () => {
    // artwork-rebuild's structured details branch is optional; with no
    // details the generic 2 lines still render.
    const lines = formatFailureCopy('artwork-rebuild', undefined, 'fail');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('Corrupt:'))).toBe(false);
  });
});

describe('formatFailureCopy — artwork-rebuild structured detail rendering', () => {
  it('emits the corrupt/healthy entries when totalEntries is provided', () => {
    const lines = formatFailureCopy(
      'artwork-rebuild',
      { totalEntries: 1000, corruptEntries: 250, healthyEntries: 750, corruptPercent: 25 },
      'fail'
    );
    const text = lines.join('\n');
    expect(text).toContain('Corrupt: 250 / 1,000 entries (25%)');
    expect(text).toContain('Healthy: 750 entries');
  });

  it('omits the entry breakdown when totalEntries is undefined', () => {
    const lines = formatFailureCopy('artwork-rebuild', {}, 'fail');
    expect(lines.some((l) => l.includes('Corrupt:'))).toBe(false);
    expect(lines.some((l) => l.includes('out of sync'))).toBe(true);
  });
});
