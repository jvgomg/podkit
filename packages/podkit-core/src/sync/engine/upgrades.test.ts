/**
 * Unit tests for the unified quality classifier (`classifyQualityChange` and
 * its two bounds `classifySourceBound` / `classifyDeviceBound`).
 *
 * The classifier is pure, so the matrix of (transition × source type × tag
 * state) is covered exhaustively here without spinning up a sync. The table is
 * structured so later slices append rows (lossy cap-down/up,
 * encoding-mismatch, source-down-suppressed) rather than rewriting cases.
 *
 * Each case reads independently — it spells out its own source / device /
 * target and asserts the observable `{ reason, direction, reEncodes }`. No
 * shared mutable fixtures hide intent.
 *
 * @module
 */

import { describe, expect, test } from 'bun:test';
import {
  classifyQualityChange,
  classifySourceBound,
  classifyDeviceBound,
  type QualityChange,
  type QualityTarget,
} from './upgrades.js';
import { buildAudioSyncTag } from '../../metadata/sync-tags.js';
import { makeMockCollectionTrack, makeMockDeviceTrack } from '../../test-utils/tracks.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceTrack } from '../../device/adapter.js';

// ---------------------------------------------------------------------------
// Target builders — the device's configured quality intent.
// ---------------------------------------------------------------------------

function target(overrides: Partial<QualityTarget> = {}): QualityTarget {
  return {
    preset: 'high',
    presetBitrate: 256,
    encoding: 'vbr',
    isAlacPreset: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifySourceBound — source-vs-device (was format-upgrade / quality-upgrade)
// ---------------------------------------------------------------------------

describe('classifySourceBound', () => {
  test('lossless source over a lossy device track -> lossless-boundary up', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 192 });

    const change = classifySourceBound(source, device, 256);

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'up',
      reEncodes: true,
    });
  });

  test('lossy source vs lossless device -> null (never a downgrade on this bound)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'Apple Lossless audio file', bitrate: 900 });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  test('same-family lossy with a significant bitrate climb (>=64 kbps) -> source-improved up', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });

    const change = classifySourceBound(source, device, 256);

    expect(change).toMatchObject({
      reason: 'source-improved',
      direction: 'up',
      reEncodes: true,
    });
    expect(change?.encodedBitrate).toBe(128);
    expect(change?.sourceBitrate).toBe(320);
  });

  test('same-family lossy with a small bitrate climb (<64 kbps and <1.5x) -> null', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 280 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 256 });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  // The multiplier threshold (>=1.5x) is a separate trigger from the absolute
  // one (>=64 kbps). These two cases pin the multiplier boundary on its own,
  // where the absolute increase is below 64 kbps so only the ratio can fire.
  test('same-family lossy, absolute <64 kbps but ratio >=1.5x -> source-improved up', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 175 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 114 });

    // +61 kbps (<64) but 175/114 = 1.535x (>=1.5)
    expect(classifySourceBound(source, device, 256)).toMatchObject({
      reason: 'source-improved',
      direction: 'up',
      reEncodes: true,
    });
  });

  test('same-family lossy, absolute <64 kbps and ratio just under 1.5x -> null', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 170 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 114 });

    // +56 kbps (<64) and 170/114 = 1.491x (<1.5)
    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  test('cross-family lossy (mp3 source, aac device) -> null', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  test('device filetype unknown -> null (cannot compare)', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: undefined, bitrate: 0 });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyDeviceBound — device-vs-target (was detectPresetChange)
// ---------------------------------------------------------------------------

describe('classifyDeviceBound', () => {
  test('lossy source -> null (copied as-is; cap does not apply in S0)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 320 });

    expect(classifyDeviceBound({ source, device, target: target() })).toBeNull();
  });

  describe('sync-tag exact comparison (authoritative)', () => {
    test('tag matches expected -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: buildAudioSyncTag('high', 'vbr'),
      });
      const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

      expect(classifyDeviceBound({ source, device, target: target(), expectedSyncTag })).toBeNull();
    });

    test('tag below target tier -> cap-up', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 128,
        syncTag: buildAudioSyncTag('low', 'vbr'),
      });
      const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

      const change = classifyDeviceBound({ source, device, target: target(), expectedSyncTag });

      expect(change).toMatchObject({
        reason: 'cap-up',
        direction: 'up',
        reEncodes: true,
      });
    });

    test('tag above target tier -> cap-down', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: buildAudioSyncTag('high', 'vbr'),
      });
      const expectedSyncTag = buildAudioSyncTag('low', 'vbr');

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 96 }),
        expectedSyncTag,
      });

      expect(change).toMatchObject({
        reason: 'cap-down',
        direction: 'down',
        reEncodes: true,
      });
    });
  });

  describe('untagged fallback (DB bitrate + tolerance — S0-preserved)', () => {
    test('device bitrate well below target -> cap-up', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });

      const change = classifyDeviceBound({ source, device, target: target() });

      expect(change).toMatchObject({ reason: 'cap-up', direction: 'up' });
    });

    test('device bitrate well above target -> cap-down', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 96 }),
      });

      expect(change).toMatchObject({
        reason: 'cap-down',
        direction: 'down',
      });
    });

    test('device bitrate within tolerance of target -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 240 });

      expect(classifyDeviceBound({ source, device, target: target() })).toBeNull();
    });
  });

  describe('ALAC preset (format-based, fallback when no exact tag)', () => {
    test('device track already ALAC -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'Apple Lossless audio file', bitrate: 900 });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'lossless', presetBitrate: 900, isAlacPreset: true }),
        })
      ).toBeNull();
    });

    test('device track is AAC -> cap-up to lossless', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'lossless', presetBitrate: 900, isAlacPreset: true }),
      });

      expect(change).toMatchObject({
        reason: 'cap-up',
        direction: 'up',
        toLossless: true,
      });
    });

    test('an exact tag comparison takes priority over the ALAC branch', () => {
      // A per-track preset that fell back from ALAC to high+aac writes a
      // quality=high tag, which must compare equal to its own expected tag
      // rather than tripping the config-wide ALAC branch.
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: buildAudioSyncTag('high', 'vbr', undefined, undefined, 'aac'),
      });
      const expectedSyncTag = buildAudioSyncTag('high', 'vbr', undefined, undefined, 'aac');

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'lossless', presetBitrate: 900, isAlacPreset: true }),
          expectedSyncTag,
        })
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// classifyQualityChange — composition of both bounds. The source bound is
// checked first; the device bound only fires when the source bound is null.
// ---------------------------------------------------------------------------

describe('classifyQualityChange (composed)', () => {
  test('source bound wins when both could fire', () => {
    // Lossless source + lossy device fires the source bound (lossless-boundary)
    // before the device bound is consulted.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });

    const change = classifyQualityChange({ source, device, target: target() });

    expect(change?.reason).toBe('lossless-boundary');
  });

  test('device bound fires when source bound is null', () => {
    // A FLAC source over a lossy AAC device fires the SOURCE bound first
    // (lossless-boundary) — the device bound is unreachable through the pure
    // composed function for that pairing. To exercise the device bound the
    // source bound must be null: use an ALAC (lossless) device track, where the
    // source improves nothing, but the recorded tag is below the target tier.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('low', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

    const change = classifyQualityChange({ source, device, target: target(), expectedSyncTag });

    expect(change).toMatchObject({ reason: 'cap-up', direction: 'up' });
  });

  test('in-sync lossless track -> null', () => {
    // Lossless device track in sync with the target — source bound null (no
    // lossy device to improve), device bound null (tag matches).
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

    expect(classifyQualityChange({ source, device, target: target(), expectedSyncTag })).toBeNull();
  });

  test('lossy copied-as-is track -> null (S0: no lossy cap enforcement)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 320 });

    expect(
      classifyQualityChange({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 96 }),
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scaffold for later slices. These reasons/directions are part of the
// classifier's vocabulary but are NOT produced in S0. The placeholders document
// the intended rows so future slices add assertions rather than new structure.
// ---------------------------------------------------------------------------

describe('later-slice scaffold (not produced in S0)', () => {
  test.todo('lossy cap-down: lossy source above lowered cap -> cap-down (S1/S3)', () => {});
  test.todo(
    'lossy cap-up: lossy source below raised cap, source can supply -> cap-up (S1/S3)',
    () => {}
  );
  test.todo('encoding-mismatch: CBR<->VBR flip fires regardless of bitrate (S2)', () => {});
  test.todo(
    'source-down-suppressed: worse source under match-cap -> reEncodes:false (S2)',
    () => {}
  );

  // Pin the type-level vocabulary so a later slice can't silently drop a reason.
  test('the QualityChange vocabulary covers every reason/direction', () => {
    const reasons: QualityChange['reason'][] = [
      'format-mismatch',
      'encoding-mismatch',
      'lossless-boundary',
      'cap-down',
      'cap-up',
      'source-improved',
      'source-down-suppressed',
    ];
    const directions: QualityChange['direction'][] = ['up', 'down', 'format-only'];
    expect(reasons).toHaveLength(7);
    expect(directions).toHaveLength(3);
  });
});

// Silence unused-import lint when fixtures are trimmed in a later slice.
export type _Fixtures = [CollectionTrack, DeviceTrack];
