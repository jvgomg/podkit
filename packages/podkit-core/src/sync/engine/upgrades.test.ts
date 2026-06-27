/**
 * Unit tests for the unified quality classifier (`classifyQualityChange` and
 * its two bounds `classifySourceBound` / `classifyDeviceBound`).
 *
 * The classifier is pure, so the matrix of (transition × source type × tag
 * state) is covered exhaustively here without spinning up a sync. New rows
 * (lossy cap-up, encoding-mismatch, source-down-suppressed) will be added as
 * those directions are enabled — the scaffold section at the bottom holds
 * placeholders.
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
import { buildAudioSyncTag, buildCopySyncTag } from '../../metadata/sync-tags.js';
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
  test('lossy source with no recorded sync-tag bitrate -> null (opt out; no DB guessing)', () => {
    // The device DB bitrate (320) is deliberately NOT consulted for lossy — only
    // the sync tag's recorded bitrate is authoritative, and there is none here.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 320 });

    expect(
      classifyDeviceBound({ source, device, target: target({ preset: 'low', presetBitrate: 96 }) })
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Lossy cap enforcement (cap-DOWN only). The device sync tag's recorded
  // bitrate is the sole authoritative `encoded` value — the DB bitrate is never
  // consulted for lossy.
  // -------------------------------------------------------------------------
  describe('lossy cap enforcement', () => {
    test('recorded bitrate above the cap -> cap-down (down, re-encodes)', () => {
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
      });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 128 }),
      });

      expect(change).toMatchObject({
        reason: 'cap-down',
        direction: 'down',
        reEncodes: true,
      });
      expect(change?.encodedBitrate).toBe(320);
      expect(change?.targetBitrate).toBe(128);
      expect(change?.sourceBitrate).toBe(320);
    });

    test('recorded bitrate equal to the cap -> null (in sync)', () => {
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 128,
        syncTag: buildCopySyncTag('fast', undefined, 'mp3', 128),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 128 }),
        })
      ).toBeNull();
    });

    test('recorded bitrate below the cap -> null (cap-up for lossy not yet enabled)', () => {
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 96,
        syncTag: buildCopySyncTag('fast', undefined, 'mp3', 96),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'high', presetBitrate: 256 }),
        })
      ).toBeNull();
    });

    test('no recorded bitrate in the sync tag -> null (cannot compare)', () => {
      // A copy tag written before sync-tag bitrate recording carries no `bitrate=`.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: { quality: 'copy', transferMode: 'fast' },
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 128 }),
        })
      ).toBeNull();
    });

    test('no configured cap (lossless target preset) -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'lossless', presetBitrate: 0, isAlacPreset: true }),
        })
      ).toBeNull();
    });

    test('a cap-down re-encode is idempotent: the new encoded bitrate matches the cap', () => {
      // After a cap-down, the device track is re-encoded to the cap and the sync
      // tag records the new bitrate (here a transcode tag at quality=low). The
      // recorded bitrate now equals the cap, so the next sync is a no-op.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 128,
        syncTag: buildAudioSyncTag('low', 'vbr', 128, 'fast', 'aac'),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 128 }),
        })
      ).toBeNull();
    });
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

  describe('untagged fallback (DB bitrate + tolerance — lossless only)', () => {
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

  test('untagged lossy track -> null (opted out; no DB-bitrate guessing)', () => {
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

  test('tagged lossy track above the cap -> cap-down via the device bound', () => {
    // The source bound is null (same-family copy, no bitrate climb), so the
    // device bound fires the lossy cap-down.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    const change = classifyQualityChange({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 96 }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.encodedBitrate).toBe(320);
    expect(change?.targetBitrate).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// Scaffold for forthcoming directions. These reasons are part of the
// classifier's vocabulary but are not yet produced. The placeholders document
// the intended rows so they can be filled in when the directions are enabled.
// ---------------------------------------------------------------------------

describe('not-yet-produced reasons (scaffold)', () => {
  // Lossy cap-DOWN is implemented — see `classifyDeviceBound > lossy cap enforcement` above.
  test.todo('lossy cap-up: lossy source below raised cap, source can supply -> cap-up', () => {});
  test.todo('encoding-mismatch: CBR<->VBR flip fires regardless of bitrate', () => {});
  test.todo('source-down-suppressed: worse source under match-cap -> reEncodes:false', () => {});

  // Pin the type-level vocabulary so a refactor can't silently drop a reason.
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

// Silence unused-import lint when scaffold fixtures are not yet consumed.
export type _Fixtures = [CollectionTrack, DeviceTrack];
