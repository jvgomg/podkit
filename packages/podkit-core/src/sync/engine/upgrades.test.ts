/**
 * Unit tests for the unified quality classifier (`classifyQualityChange` and
 * its two bounds `classifySourceBound` / `classifyDeviceBound`).
 *
 * The classifier is pure, so the matrix of (transition × source type × tag
 * state) is covered exhaustively here without spinning up a sync. The
 * encoding-mismatch row will be added when that direction is enabled — the
 * scaffold section at the bottom holds its placeholder.
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
  // Lossy cap enforcement (both directions). The device sync tag's recorded
  // bitrate is the sole authoritative `encoded` value — the DB bitrate is never
  // consulted for lossy. The effective target is min(source, cap): re-encoding
  // up never exceeds what the source can supply.
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

    test('recorded bitrate below the cap, source can supply the cap -> cap-up bounded by the cap', () => {
      // Source 320 > cap 256, so the effective target is the cap (256). The
      // device copy at 96 sits below it — re-encode up to 256.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 96,
        syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
      });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256 }),
      });

      expect(change).toMatchObject({
        reason: 'cap-up',
        direction: 'up',
        reEncodes: true,
      });
      expect(change?.encodedBitrate).toBe(96);
      expect(change?.targetBitrate).toBe(256);
      expect(change?.sourceBitrate).toBe(320);
    });

    test('recorded bitrate below the cap, source supplies less than the cap -> cap-up bounded by the source', () => {
      // Source 200 < cap 256, so the effective target is the source (200), not
      // the cap. Re-encoding up to the full cap would inflate the file with no
      // quality gain.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 200 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 96,
        syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
      });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256 }),
      });

      expect(change).toMatchObject({
        reason: 'cap-up',
        direction: 'up',
        reEncodes: true,
      });
      expect(change?.targetBitrate).toBe(200);
      expect(change?.encodedBitrate).toBe(96);
      expect(change?.sourceBitrate).toBe(200);
    });

    test('recorded bitrate equal to the effective target -> null (in sync)', () => {
      // Source 200 < cap 256 → effective target 200. The device copy already
      // sits at 200, so there is nothing to raise.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 200 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 200,
        syncTag: buildAudioSyncTag('medium', 'vbr', 200, 'fast', 'aac'),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'high', presetBitrate: 256 }),
        })
      ).toBeNull();
    });

    test('source degraded below the device copy (source < encoded <= cap) -> source-down-suppressed (keep the good copy, report)', () => {
      // The source re-ripped down to 96 while the device copy is a healthy 192,
      // still under the 256 cap. Re-encoding down to the worse source would
      // destroy quality, so the better existing copy is kept and the situation
      // is reported (reEncodes: false) rather than acted on.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 96 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 192,
        syncTag: buildAudioSyncTag('medium', 'vbr', 192, 'fast', 'aac'),
      });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256 }),
      });

      expect(change).toMatchObject({
        reason: 'source-down-suppressed',
        direction: 'down',
        reEncodes: false,
      });
      expect(change?.encodedBitrate).toBe(192);
      expect(change?.sourceBitrate).toBe(96);
      // The effective target follows the (degraded) source, not the cap.
      expect(change?.targetBitrate).toBe(96);
    });

    test('source degraded BELOW the cap while the recorded copy is ABOVE the cap -> source-down-suppressed (not cap-down)', () => {
      // The fixed edge: the device copy records 320 (above the 128 cap) but the
      // source has since been re-ripped to 100 (below the cap). A naive
      // `encoded > cap` rule would fire cap-down and re-encode 128 from the 100k
      // source — a lossy-to-lossy upsample of degraded audio. The three-bound
      // model recognises the source can no longer supply the cap and suppresses.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 100 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 320,
        syncTag: buildAudioSyncTag('high', 'vbr', 320, 'fast', 'aac'),
      });

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 128 }),
      });

      expect(change).toMatchObject({
        reason: 'source-down-suppressed',
        direction: 'down',
        reEncodes: false,
      });
      expect(change?.encodedBitrate).toBe(320);
      expect(change?.sourceBitrate).toBe(100);
      expect(change?.targetBitrate).toBe(100);
    });

    test('recorded bitrate below the cap but no source bitrate -> null (nothing to raise toward)', () => {
      // Without a source bitrate the upward ceiling is unknown — leave the track
      // alone rather than guess.
      const source = makeMockCollectionTrack({
        fileType: 'mp3',
        lossless: false,
        bitrate: undefined,
      });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 96,
        syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'high', presetBitrate: 256 }),
        })
      ).toBeNull();
    });

    test('recorded bitrate above the cap but no source bitrate -> null (no effective target)', () => {
      // The device copy exceeds the cap, but with no known source bitrate there
      // is no way to know whether re-encoding would help or just inflate a
      // degraded source — leave it alone rather than guess.
      const source = makeMockCollectionTrack({
        fileType: 'mp3',
        lossless: false,
        bitrate: undefined,
      });
      const device = makeMockDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
      });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 128 }),
        })
      ).toBeNull();
    });

    test('a cap-up re-encode is idempotent: the new encoded bitrate matches the effective target', () => {
      // After a cap-up to min(source, cap) = source (200), the sync tag records
      // 200. The next sync sees encoded == effective target and does nothing.
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 200 });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 200,
        syncTag: buildAudioSyncTag('high', 'vbr', 200, 'fast', 'aac'),
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

  test('cross-family lossy below a raised cap -> cap-up via the device bound', () => {
    // A 320 kbps MP3 source whose device copy is a 128 kbps AAC (a different
    // family). The source bound can't fire (cross-family comparison returns
    // null), so the device bound owns this: the recorded 128 sits below
    // min(320, 256) = 256, so re-encode up to the cap. This is exactly the case
    // the source bound misses — the two bounds are complementary.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 128,
      syncTag: buildAudioSyncTag('low', 'vbr', 128, 'fast', 'aac'),
    });

    const change = classifyQualityChange({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
    });

    expect(change).toMatchObject({ reason: 'cap-up', direction: 'up', reEncodes: true });
    expect(change?.encodedBitrate).toBe(128);
    expect(change?.targetBitrate).toBe(256);
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

  test('degraded lossy source -> source-down-suppressed via the device bound (source bound does not pre-empt)', () => {
    // The source dropped to 96 below the 192 device copy, still under the cap.
    // The source bound is null (a worse same-family source is not an upgrade), so
    // the device bound owns this and suppresses rather than re-encoding down.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 96 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 192,
      syncTag: buildAudioSyncTag('medium', 'vbr', 192, 'fast', 'aac'),
    });

    const change = classifyQualityChange({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
    });

    expect(change).toMatchObject({
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Scaffold for forthcoming directions. These reasons are part of the
// classifier's vocabulary but are not yet produced. The placeholders document
// the intended rows so they can be filled in when the directions are enabled.
// ---------------------------------------------------------------------------

describe('not-yet-produced reasons (scaffold)', () => {
  // Lossy cap enforcement (both directions) and source-down suppression are
  // implemented — see `classifyDeviceBound > lossy cap enforcement` above.
  test.todo('encoding-mismatch: CBR<->VBR flip fires regardless of bitrate', () => {});

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
