import { describe, expect, test } from 'bun:test';
import {
  resolveLossyReduction,
  resolveReductionAxis,
  type LossyReductionInput,
  type LossyReductionResult,
  type ReductionMode,
} from './lossy-reduction.js';
import type { TransferMode } from '../../transcode/types.js';

// =============================================================================
// resolveReductionAxis — full 3×3 truth table
// =============================================================================

describe('resolveReductionAxis', () => {
  const cases: { reduce: ReductionMode; mode: TransferMode; expected: 'convert' | 'preserve' }[] = [
    // auto follows the transfer mode's lean
    { reduce: 'auto', mode: 'fast', expected: 'preserve' },
    { reduce: 'auto', mode: 'optimized', expected: 'convert' },
    { reduce: 'auto', mode: 'portable', expected: 'preserve' },
    // always converts regardless of mode
    { reduce: 'always', mode: 'fast', expected: 'convert' },
    { reduce: 'always', mode: 'optimized', expected: 'convert' },
    { reduce: 'always', mode: 'portable', expected: 'convert' },
    // never preserves regardless of mode
    { reduce: 'never', mode: 'fast', expected: 'preserve' },
    { reduce: 'never', mode: 'optimized', expected: 'preserve' },
    { reduce: 'never', mode: 'portable', expected: 'preserve' },
  ];

  for (const { reduce, mode, expected } of cases) {
    test(`reduce=${reduce} + ${mode} → ${expected}`, () => {
      expect(resolveReductionAxis(reduce, mode)).toBe(expected);
    });
  }
});

// =============================================================================
// resolveLossyReduction
// =============================================================================

function input(overrides: Partial<LossyReductionInput> = {}): LossyReductionInput {
  return {
    sourceCodec: 'mp3',
    sourceBitrate: 320,
    deviceNative: true,
    targetCodec: 'aac',
    cap: 128,
    axis: 'preserve',
    tolerance: 0.25,
    ...overrides,
  };
}

describe('resolveLossyReduction', () => {
  describe('device-native + preserve', () => {
    test('over-cap source is copied untouched', () => {
      expect(
        resolveLossyReduction(input({ deviceNative: true, axis: 'preserve', sourceBitrate: 320 }))
      ).toEqual({
        action: 'copy',
      });
    });

    test('at-cap source is copied', () => {
      expect(resolveLossyReduction(input({ axis: 'preserve', sourceBitrate: 128 }))).toEqual({
        action: 'copy',
      });
    });

    test('below-cap source is copied', () => {
      expect(resolveLossyReduction(input({ axis: 'preserve', sourceBitrate: 96 }))).toEqual({
        action: 'copy',
      });
    });
  });

  describe('device-native + convert', () => {
    test('source just inside the tolerance band is copied (not reduced)', () => {
      // cap=128, tol=0.25 → reduce only when source > 160.
      expect(resolveLossyReduction(input({ axis: 'convert', sourceBitrate: 156 }))).toEqual({
        action: 'copy',
      });
    });

    test('source exactly at the tolerance boundary is copied (strict >)', () => {
      expect(resolveLossyReduction(input({ axis: 'convert', sourceBitrate: 160 }))).toEqual({
        action: 'copy',
      });
    });

    test('source just outside the tolerance band is reduced to the cap', () => {
      expect(resolveLossyReduction(input({ axis: 'convert', sourceBitrate: 161 }))).toEqual({
        action: 'transcode',
        bitrate: 128,
      });
    });

    test('source well above the cap is reduced to the cap (raw kbps, not efficiency-weighted)', () => {
      expect(
        resolveLossyReduction(
          input({ axis: 'convert', sourceBitrate: 320, sourceCodec: 'opus', targetCodec: 'aac' })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('at-cap source is copied (no needless re-encode)', () => {
      expect(resolveLossyReduction(input({ axis: 'convert', sourceBitrate: 128 }))).toEqual({
        action: 'copy',
      });
    });

    test('tolerance=0 reduces any over-cap source', () => {
      expect(
        resolveLossyReduction(input({ axis: 'convert', sourceBitrate: 129, tolerance: 0 }))
      ).toEqual({
        action: 'transcode',
        bitrate: 128,
      });
    });
  });

  describe('necessity (incompatible codec) + convert', () => {
    test('source above the cap → min(source, cap) = cap', () => {
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'convert',
            sourceCodec: 'vorbis',
            sourceBitrate: 224,
            cap: 128,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('source below the cap → min(source, cap) = source (raw kbps, no efficiency)', () => {
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'convert',
            sourceCodec: 'opus',
            sourceBitrate: 96,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 96 });
    });
  });

  describe('necessity (incompatible codec) + preserve — efficiency-weighted', () => {
    // round(source × eff[target] / eff[source]); eff: aac 1.0, opus 0.75, vorbis 0.90, mp3 1.30.
    test('opus → aac targets a higher kbps to preserve quality, bounded by the cap', () => {
      // round(96 × 1.0 / 0.75) = 128; min(128, cap=256) = 128. Above source (96) by design.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'aac',
            sourceBitrate: 96,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('vorbis → aac rounds the efficiency ratio', () => {
      // round(192 × 1.0 / 0.90) = round(213.33) = 213; min(213, cap=256) = 213.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'vorbis',
            targetCodec: 'aac',
            sourceBitrate: 192,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 213 });
    });

    test('mp3 → aac targets a lower kbps (mp3 is less efficient)', () => {
      // round(320 × 1.0 / 1.30) = round(246.15) = 246; min(246, cap=320) = 246.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'mp3',
            targetCodec: 'aac',
            sourceBitrate: 320,
            cap: 320,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 246 });
    });

    test('mp3 → opus targets far fewer kbps (opus much more efficient)', () => {
      // round(320 × 0.75 / 1.30) = round(184.6) = 185; min(185, cap=320) = 185.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'mp3',
            targetCodec: 'opus',
            sourceBitrate: 320,
            cap: 320,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 185 });
    });

    test('aac → opus (same-quality stack) targets fewer kbps', () => {
      // round(256 × 0.75 / 1.0) = 192; min(192, cap=256) = 192.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'aac',
            targetCodec: 'opus',
            sourceBitrate: 256,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 192 });
    });

    test('same codec (opus → opus) preserves the source bitrate when under the cap', () => {
      // round(160 × 0.75 / 0.75) = 160; min(160, cap=256) = 160.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'opus',
            sourceBitrate: 160,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 160 });
    });

    test('the cap clamps the efficiency-matched target', () => {
      // round(320 × 1.0 / 0.75) = 427; min(427, cap=128) = 128.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'aac',
            sourceBitrate: 320,
            cap: 128,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('unknown source codec is treated as AAC-equivalent (efficiency 1.0)', () => {
      // round(200 × 1.0 / 1.0) = 200; min(200, cap=256) = 200.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'wma',
            targetCodec: 'aac',
            sourceBitrate: 200,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 200 });
    });
  });

  describe('deviceMax clamp (hard device ceiling — every transcode target + preserve)', () => {
    test('deviceMax below the efficiency target clamps it', () => {
      // round(96 × 1.0 / 0.75) = 128; min(128, cap=256, deviceMax=112) = 112.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'aac',
            sourceBitrate: 96,
            cap: 256,
            deviceMax: 112,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 112 });
    });

    test('deviceMax above the efficiency target is a no-op', () => {
      // round(96 × 1.0 / 0.75) = 128; min(128, cap=256, deviceMax=320) = 128.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'aac',
            sourceBitrate: 96,
            cap: 256,
            deviceMax: 320,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('absent deviceMax leaves the target unbounded by any device maximum', () => {
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'preserve',
            sourceCodec: 'opus',
            targetCodec: 'aac',
            sourceBitrate: 96,
            cap: 256,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('deviceMax clamps the convert-necessity target below min(source, cap)', () => {
      // min(source=96, cap=256, deviceMax=64) = 64 — the device ceiling wins.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: false,
            axis: 'convert',
            sourceBitrate: 96,
            cap: 256,
            deviceMax: 64,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 64 });
    });

    test('deviceMax below the cap forces a device-native convert reduction to the device max', () => {
      // Source 150 is within the 25% band of the 256 cap (would copy), but the
      // device max is 112: 150 > 112 → reduce to min(cap, deviceMax) = 112.
      expect(
        resolveLossyReduction(
          input({
            deviceNative: true,
            axis: 'convert',
            sourceBitrate: 150,
            cap: 256,
            deviceMax: 112,
            tolerance: 0.25,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 112 });
    });

    test('deviceMax forces a device-native PRESERVE source above it to reduce (device cannot hold it)', () => {
      // Preserve would normally copy a device-native source, but a 320 source on a
      // device that maxes at 128 cannot be stored as-is → reduce to min(cap, 128).
      expect(
        resolveLossyReduction(
          input({
            deviceNative: true,
            axis: 'preserve',
            sourceBitrate: 320,
            cap: 256,
            deviceMax: 128,
          })
        )
      ).toEqual({ action: 'transcode', bitrate: 128 });
    });

    test('a device-native source at or below deviceMax is still copied (no needless reduce)', () => {
      // Below (96 < 128) and exactly AT the device max (128 == 128) both copy —
      // the `> deviceMax` boundary is strict, so a source at the ceiling is fine.
      for (const sourceBitrate of [96, 128]) {
        expect(
          resolveLossyReduction(
            input({
              deviceNative: true,
              axis: 'preserve',
              sourceBitrate,
              cap: 256,
              deviceMax: 128,
            })
          )
        ).toEqual({ action: 'copy' });
      }
    });
  });

  describe('preconditions', () => {
    test('throws on a zero source bitrate (caller must filter unknown-bitrate sources)', () => {
      expect(() => resolveLossyReduction(input({ sourceBitrate: 0 }))).toThrow();
    });

    test('throws on a negative source bitrate', () => {
      expect(() => resolveLossyReduction(input({ sourceBitrate: -1 }))).toThrow();
    });
  });

  describe('invariants across the matrix', () => {
    const codecs = ['aac', 'opus', 'vorbis', 'mp3'] as const;
    const targets = ['aac', 'opus', 'mp3'] as const;
    const bitrates = [64, 96, 128, 160, 161, 192, 224, 256, 320];
    const caps = [96, 128, 192, 256];

    type Cell = {
      axis: 'convert' | 'preserve';
      deviceNative: boolean;
      sourceCodec: (typeof codecs)[number];
      targetCodec: (typeof targets)[number];
      sourceBitrate: number;
      cap: number;
      result: LossyReductionResult;
    };

    const cells: Cell[] = [];
    for (const axis of ['convert', 'preserve'] as const) {
      for (const deviceNative of [true, false]) {
        for (const sourceCodec of codecs) {
          for (const targetCodec of targets) {
            for (const sourceBitrate of bitrates) {
              for (const cap of caps) {
                cells.push({
                  axis,
                  deviceNative,
                  sourceCodec,
                  targetCodec,
                  sourceBitrate,
                  cap,
                  result: resolveLossyReduction(
                    input({ axis, deviceNative, sourceCodec, targetCodec, sourceBitrate, cap })
                  ),
                });
              }
            }
          }
        }
      }
    }

    test('every transcode target is ≤ the cap (the hard ceiling)', () => {
      for (const c of cells) {
        if (c.result.action !== 'transcode') continue;
        expect(c.result.bitrate).toBeLessThanOrEqual(c.cap);
      }
    });

    test('every transcode target is down-only (≤ source) except preserve-necessity, which may target above the source to match quality in a less-efficient codec', () => {
      // preserve-necessity intentionally targets the source's *quality* in a
      // less efficient codec, so its raw kbps may exceed the source (bounded by
      // the cap). Every other row is strictly down-only.
      for (const c of cells) {
        if (c.result.action !== 'transcode') continue;
        if (c.axis === 'preserve' && !c.deviceNative) continue;
        expect(c.result.bitrate).toBeLessThanOrEqual(c.sourceBitrate);
      }
    });
  });
});
