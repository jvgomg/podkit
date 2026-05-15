/**
 * Unit tests for `determineLevel()`'s `'unsupported'` short-circuit.
 *
 * Covers the cases TASK-331 added:
 *   - Apple PID that lives in the `tables/unsupported.ts` table (touch 5G)
 *     → `level: 'unsupported'`, canonical reason text surfaced.
 *   - Apple PID in the iOS-range fallback (range catch for future iPhones)
 *     → `level: 'unsupported'` with the generic iOS-range message.
 *   - Caller-supplied `unsupportedReason` (Sony Walkman path)
 *     → `level: 'unsupported'` with the supplied reason verbatim.
 *   - Stages-only call signature still returns `'unknown'` for an empty
 *     stage list and `'ready'` for a successful run — backwards compat.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { determineLevel } from '../determine-level.js';
import type { ReadinessStageResult } from '../types.js';

function passStages(): ReadinessStageResult[] {
  return [
    { stage: 'usb', status: 'pass', summary: 'ok' },
    { stage: 'partition', status: 'pass', summary: 'ok' },
    { stage: 'filesystem', status: 'pass', summary: 'ok' },
    { stage: 'mount', status: 'pass', summary: 'ok' },
    { stage: 'sysinfo', status: 'pass', summary: 'ok' },
    { stage: 'database', status: 'pass', summary: 'ok' },
  ];
}

describe('determineLevel() — unsupported short-circuit', () => {
  it('returns unsupported for iPod touch 5G PID (12aa)', () => {
    const result = determineLevel([], { vendorId: '05ac', productId: '12aa' });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toContain('iPod touch');
    expect(result.unsupportedReason).toContain('5th generation');
  });

  it('returns unsupported for shuffle 3G/4G PIDs', () => {
    const result3g = determineLevel([], { vendorId: '05ac', productId: '1302' });
    expect(result3g.level).toBe('unsupported');
    expect(result3g.unsupportedReason).toContain('shuffle');

    const result4g = determineLevel([], { vendorId: '05ac', productId: '1303' });
    expect(result4g.level).toBe('unsupported');
  });

  it('returns unsupported for nano 7G PIDs (not in libgpod table)', () => {
    const result = determineLevel([], { vendorId: '05ac', productId: '120e' });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toContain('nano 7th gen');
  });

  it('returns unsupported for iOS-range PIDs without explicit table entry', () => {
    // 0x12ad is inside the iOS range (0x1290–0x12af) and intentionally NOT
    // listed in UNSUPPORTED_IPOD_PRODUCT_IDS — it must hit the range catch.
    const result = determineLevel([], { vendorId: '05ac', productId: '12ad' });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toMatch(/iOS device/);
  });

  it('accepts 0x-prefixed product IDs', () => {
    const result = determineLevel([], { vendorId: '0x05ac', productId: '0x12aa' });
    expect(result.level).toBe('unsupported');
  });

  it('threads a caller-supplied unsupportedReason verbatim (Sony Walkman)', () => {
    const reason =
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.';
    const result = determineLevel([], {
      vendorId: '054c',
      productId: '0882',
      unsupportedReason: reason,
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toBe(reason);
  });

  it('caller-supplied reason wins over Apple table lookup', () => {
    // Even if the context's vendor/product would match the Apple table, an
    // explicit reason from the caller takes priority. Useful for non-Apple
    // classifiers that want to own the message wording.
    const reason = 'caller wins';
    const result = determineLevel([], {
      vendorId: '05ac',
      productId: '12aa',
      unsupportedReason: reason,
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toBe(reason);
  });

  it('does NOT mark a non-Apple vendor as unsupported via the Apple table', () => {
    // A non-Apple vendor without an explicit reason falls through to the
    // stage cascade. With a passing stage list this yields 'ready', NOT
    // 'unsupported'.
    const result = determineLevel(passStages(), { vendorId: '054c', productId: '0882' });
    expect(result.level).toBe('ready');
    expect(result.unsupportedReason).toBeUndefined();
  });

  it('does NOT mark a supported iPod PID as unsupported', () => {
    // iPod video 5G PID = 0x1209 — should NOT be in the rejection table.
    const result = determineLevel(passStages(), { vendorId: '05ac', productId: '1209' });
    expect(result.level).toBe('ready');
    expect(result.unsupportedReason).toBeUndefined();
  });
});

describe('determineLevel() — backwards compatibility', () => {
  it('stages-only signature returns a bare ReadinessLevel string', () => {
    const result = determineLevel(passStages());
    expect(result).toBe('ready');
  });

  it('stages-only signature still returns unknown for an empty stage list', () => {
    const result = determineLevel([]);
    expect(result).toBe('unknown');
  });

  it('context signature without unsupported match collapses to unknown for empty stages', () => {
    // No PID, no reason → no unsupported short-circuit → falls through
    // the rule cascade → returns 'unknown' since no rule matches.
    const result = determineLevel([], {});
    expect(result.level).toBe('unknown');
    expect(result.unsupportedReason).toBeUndefined();
  });

  it('context signature preserves stage-rule outcomes for non-unsupported devices', () => {
    const stages: ReadinessStageResult[] = [
      { stage: 'usb', status: 'pass', summary: 'ok' },
      { stage: 'partition', status: 'pass', summary: 'ok' },
      { stage: 'filesystem', status: 'fail', summary: 'no fs' },
    ];
    const result = determineLevel(stages, { vendorId: '05ac', productId: '1209' });
    expect(result.level).toBe('needs-format');
    expect(result.unsupportedReason).toBeUndefined();
  });
});
