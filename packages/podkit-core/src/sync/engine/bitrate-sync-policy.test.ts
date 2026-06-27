/**
 * Exhaustive unit test for the bitrate-sync policy gate.
 *
 * The gate is a pure mapping from `(direction, reason, mode)` to
 * `'fire' | 'suppress-log'`. Every reason is exercised against every mode so a
 * change to the table can't silently shift behaviour. Precondition reasons
 * (`encoding-mismatch`, `lossless-boundary`, `format-mismatch`) bypass the gate
 * and fire in every mode; the three bitrate reasons follow the per-direction
 * policy; `source-down-suppressed` fires only under `match-all`.
 *
 * @module
 */

import { describe, expect, test } from 'bun:test';
import {
  applyBitrateSyncPolicy,
  type BitrateSyncMode,
  type QualityChangeDirection,
  type QualityChangeReason,
} from './upgrades.js';

const MODES: BitrateSyncMode[] = ['off', 'match-cap', 'match-all', 'up-only', 'down-only'];

// The canonical direction each reason carries when produced by the classifier.
const DIRECTION: Record<QualityChangeReason, QualityChangeDirection> = {
  'format-mismatch': 'format-only',
  'encoding-mismatch': 'format-only',
  'lossless-boundary': 'up',
  'cap-up': 'up',
  'source-improved': 'up',
  'cap-down': 'down',
  'source-down-suppressed': 'down',
};

// The expected gate decision per (reason, mode). `true` = fire.
const EXPECTED: Record<QualityChangeReason, Record<BitrateSyncMode, boolean>> = {
  // Preconditions always fire — correctness, not bitrate preference.
  'format-mismatch': {
    off: true,
    'match-cap': true,
    'match-all': true,
    'up-only': true,
    'down-only': true,
  },
  'encoding-mismatch': {
    off: true,
    'match-cap': true,
    'match-all': true,
    'up-only': true,
    'down-only': true,
  },
  'lossless-boundary': {
    off: true,
    'match-cap': true,
    'match-all': true,
    'up-only': true,
    'down-only': true,
  },
  // Up moves.
  'cap-up': {
    off: false,
    'match-cap': true,
    'match-all': true,
    'up-only': true,
    'down-only': false,
  },
  'source-improved': {
    off: false,
    'match-cap': true,
    'match-all': true,
    'up-only': true,
    'down-only': false,
  },
  // Down move.
  'cap-down': {
    off: false,
    'match-cap': true,
    'match-all': true,
    'up-only': false,
    'down-only': true,
  },
  // Source-down: only the opt-in match-all follows the source down.
  'source-down-suppressed': {
    off: false,
    'match-cap': false,
    'match-all': true,
    'up-only': false,
    'down-only': false,
  },
};

describe('applyBitrateSyncPolicy', () => {
  for (const reason of Object.keys(EXPECTED) as QualityChangeReason[]) {
    for (const mode of MODES) {
      const expectFire = EXPECTED[reason][mode];
      test(`${reason} under ${mode} -> ${expectFire ? 'fire' : 'suppress-log'}`, () => {
        expect(applyBitrateSyncPolicy(DIRECTION[reason], reason, mode)).toBe(
          expectFire ? 'fire' : 'suppress-log'
        );
      });
    }
  }

  test('match-cap is the documented default behaviour for every reason', () => {
    // match-cap fires every reason except source-down (the only suppressed one).
    expect(applyBitrateSyncPolicy('up', 'cap-up', 'match-cap')).toBe('fire');
    expect(applyBitrateSyncPolicy('down', 'cap-down', 'match-cap')).toBe('fire');
    expect(applyBitrateSyncPolicy('down', 'source-down-suppressed', 'match-cap')).toBe(
      'suppress-log'
    );
  });
});
