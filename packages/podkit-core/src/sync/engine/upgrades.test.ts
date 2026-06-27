/**
 * Unit tests for the unified quality classifier (`classifyQualityChange` and
 * its two bounds `classifySourceBound` / `classifyDeviceBound`).
 *
 * The classifier is pure, so the matrix of (transition × source type × tag
 * state) is covered exhaustively here without spinning up a sync. The precondition
 * classes — CBR/VBR `encoding-mismatch` (lossless and lossy paths) and the
 * `lossless-boundary` crossing in both directions — are covered alongside the
 * bitrate moves; only `format-mismatch` remains reserved (see the bottom block).
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

    test('same tier, a newly-added lower custom bitrate -> cap-down (not mislabelled cap-up)', () => {
      // The device tag is quality=high with no custom bitrate; the target adds a
      // custom bitrate (128) below the high nominal. The tier is unchanged and the
      // old tag carries no bitrate, so the direction is resolved from effective
      // bitrates. Pinned under `off`: a cap-down is suppressed, but a mislabelled
      // cap-up would also be suppressed — so assert the down direction directly
      // under the default policy where it fires.
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: buildAudioSyncTag('high', 'vbr'),
      });
      const expectedSyncTag = buildAudioSyncTag('high', 'vbr', 128);

      const change = classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256, customBitrate: 128 }),
        expectedSyncTag,
      });

      expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
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

  describe('untagged tracks are opted out (no DB-bitrate fallback)', () => {
    // The sync tag is the sole quality truth. A track podkit did not write (no
    // sync tag) carries no authoritative recorded bitrate/encoding, so it is
    // opted out of the device-vs-target bound entirely — there is no guessing
    // from the unreliable iPod-DB bitrate (libgpod exposes no VBR signal).

    test('untagged lossless, device bitrate well below target -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });

      expect(classifyDeviceBound({ source, device, target: target() })).toBeNull();
    });

    test('untagged lossless, device bitrate well above target -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 96 }),
        })
      ).toBeNull();
    });

    test('untagged lossy, device bitrate well above target -> null', () => {
      const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
      const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 320 });

      expect(
        classifyDeviceBound({
          source,
          device,
          target: target({ preset: 'low', presetBitrate: 96 }),
        })
      ).toBeNull();
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
// Policy threading — the bitrate-sync mode controls `reEncodes` per direction.
// The classifier still RETURNS a change when suppressed so it can be reported;
// only `reEncodes` flips.
// ---------------------------------------------------------------------------

describe('bitrate-sync policy threading', () => {
  function lossyCapDown(policy?: Parameters<typeof classifyDeviceBound>[0]['policy']) {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });
    return classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128 }),
      policy,
    });
  }

  function lossyCapUp(policy?: Parameters<typeof classifyDeviceBound>[0]['policy']) {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 96,
      syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
    });
    return classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
      policy,
    });
  }

  function sourceDown(policy?: Parameters<typeof classifyDeviceBound>[0]['policy']) {
    // Source re-ripped to 96, below the 192 device copy, both under the 256 cap.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 96 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 192,
      syncTag: buildAudioSyncTag('medium', 'vbr', 192, 'fast', 'aac'),
    });
    return classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
      policy,
    });
  }

  test('default policy is match-cap: cap moves fire, source-down suppresses', () => {
    expect(lossyCapDown()?.reEncodes).toBe(true);
    expect(lossyCapUp()?.reEncodes).toBe(true);
    expect(sourceDown()?.reEncodes).toBe(false);
  });

  test('off suppresses both cap directions (still returns the change)', () => {
    expect(lossyCapDown('off')).toMatchObject({ reason: 'cap-down', reEncodes: false });
    expect(lossyCapUp('off')).toMatchObject({ reason: 'cap-up', reEncodes: false });
  });

  test('up-only fires up, suppresses down', () => {
    expect(lossyCapUp('up-only')?.reEncodes).toBe(true);
    expect(lossyCapDown('up-only')?.reEncodes).toBe(false);
  });

  test('down-only fires down, suppresses up', () => {
    expect(lossyCapDown('down-only')?.reEncodes).toBe(true);
    expect(lossyCapUp('down-only')?.reEncodes).toBe(false);
  });

  test('match-all follows the source down: source-down fires at the source bitrate', () => {
    const change = sourceDown('match-all');
    expect(change).toMatchObject({
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: true,
    });
    // The re-encode target is the degraded source bitrate (capped), so the
    // executor re-encodes down to the source, not the cap.
    expect(change?.targetBitrate).toBe(96);
    expect(change?.sourceBitrate).toBe(96);
  });

  test('match-cap keeps the good copy on source-down (no re-encode)', () => {
    expect(sourceDown('match-cap')?.reEncodes).toBe(false);
  });

  test('source bound source-improved is gated by direction (suppressed under off)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });

    expect(classifySourceBound(source, device, 256, 'match-cap')).toMatchObject({
      reason: 'source-improved',
      reEncodes: true,
    });
    expect(classifySourceBound(source, device, 256, 'off')).toMatchObject({
      reason: 'source-improved',
      reEncodes: false,
    });
  });

  test('lossless-boundary is a precondition: fires even under off', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 192 });

    expect(classifySourceBound(source, device, 256, 'off')).toMatchObject({
      reason: 'lossless-boundary',
      reEncodes: true,
    });
  });

  test('a device-bound crossing into lossless (ALAC upgrade) fires even under off', () => {
    // quality=max on an ALAC device with an AAC device copy: the device bound
    // reports this as cap-up + toLossless. Crossing into lossless is a quality
    // boundary, not a bitrate move, so it must re-encode even with bitrate
    // moves frozen.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'lossless', presetBitrate: 900, isAlacPreset: true }),
      policy: 'off',
    });

    expect(change).toMatchObject({ reason: 'cap-up', toLossless: true, reEncodes: true });
  });
});

// ---------------------------------------------------------------------------
// Encoding-mismatch (CBR<->VBR) is a precondition class: it fires regardless of
// the bitrate-sync mode, including off.
// ---------------------------------------------------------------------------

describe('encoding-mismatch (precondition)', () => {
  test('lossless source: VBR->CBR flip at the same tier -> encoding-mismatch (format-only), fires under off', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'cbr');

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ encoding: 'cbr' }),
      expectedSyncTag,
      policy: 'off',
    });

    // A pure encoding flip (same tier, same bitrate) tags `format-only` — it is
    // not a bitrate move.
    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'format-only',
      reEncodes: true,
    });
  });

  test('lossless source: encoding flip that coincides with a tier move keeps that direction', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('low', 'cbr');

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 96, encoding: 'cbr' }),
      expectedSyncTag,
      policy: 'off',
    });

    // Encoding flipped AND the tier dropped: a single re-encode satisfies both,
    // encoding-mismatch is the headline, and the direction reflects the move.
    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'down',
      reEncodes: true,
    });
  });

  // The gap: the lossy device-bound previously compared bitrate only, so a pure
  // CBR<->VBR flip on a track podkit transcoded (recorded encoding + bitrate) was
  // never detected. It must re-encode for correctness under every policy mode.
  test('lossy source: VBR->CBR flip at the cap -> encoding-mismatch (format-only), fires under off', () => {
    // The device copy was a prior cap-down to AAC at 128 (recorded encoding=vbr,
    // bitrate=128). Source 320 > cap 128, so the effective target is the cap and
    // the recorded bitrate already sits at it — only the encoding mode changed.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 128,
      syncTag: buildAudioSyncTag('low', 'vbr', 128, 'fast', 'aac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'format-only',
      reEncodes: true,
    });
    expect(change?.targetBitrate).toBe(128);
    expect(change?.fromEncoding).toBe('vbr');
    expect(change?.toEncoding).toBe('cbr');
  });

  test('lossy source: encoding flip coinciding with a cap-down keeps direction down', () => {
    // Recorded 200 > effective target min(320, 128) = 128, AND the encoding flips.
    // The single re-encode satisfies both; encoding-mismatch is the headline and
    // the direction reflects the down move.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 200,
      syncTag: buildAudioSyncTag('medium', 'vbr', 200, 'fast', 'aac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'down',
      reEncodes: true,
    });
    expect(change?.targetBitrate).toBe(128);
  });

  test('lossy source: encoding flip coinciding with a cap-up keeps direction up', () => {
    // Recorded 96 < effective target min(320, 256) = 256, AND the encoding flips.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 96,
      syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256, encoding: 'cbr' }),
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'up',
      reEncodes: true,
    });
    expect(change?.targetBitrate).toBe(256);
  });

  test('lossy source: encoding flip fires under every bitrate-sync mode', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const buildDevice = () =>
      makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 128,
        syncTag: buildAudioSyncTag('low', 'vbr', 128, 'fast', 'aac'),
      });

    for (const policy of ['off', 'match-cap', 'match-all', 'up-only', 'down-only'] as const) {
      const change = classifyDeviceBound({
        source,
        device: buildDevice(),
        target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
        policy,
      });
      expect(change).toMatchObject({ reason: 'encoding-mismatch', reEncodes: true });
    }
  });

  test('lossy source degraded below the cap with an encoding flip -> source-down, not a destructive re-encode', () => {
    // The device holds a 128 kbps VBR copy (a prior cap-down). The source was
    // later re-ripped down to 100 kbps and the user switched to CBR. Honouring
    // the flip would re-encode the good 128 kbps copy down to the 100 kbps
    // source — quality loss. This is a source-down situation: under match-cap
    // the better copy is kept and reported; only match-all follows it down.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 100 });
    const buildDevice = () =>
      makeMockDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 128,
        syncTag: buildAudioSyncTag('low', 'vbr', 128, 'fast', 'aac'),
      });

    const kept = classifyDeviceBound({
      source,
      device: buildDevice(),
      target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
    });
    expect(kept).toMatchObject({
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: false,
    });

    // match-all opts into following the source down; that re-encode adopts the
    // new encoding mode as a side effect.
    const followed = classifyDeviceBound({
      source,
      device: buildDevice(),
      target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
      policy: 'match-all',
    });
    expect(followed).toMatchObject({ reason: 'source-down-suppressed', reEncodes: true });
  });

  test('lossy copy with no recorded encoding -> no encoding-mismatch (a copy has no podkit encoding)', () => {
    // A direct copy clears `encoding` (buildCopySyncTag), so an encoding-mode
    // change must NOT re-encode it — that would be a lossy-to-lossy degradation
    // of a faithful copy.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 128 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 128,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 128),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr' }),
      })
    ).toBeNull();
  });

  test('lossy source: matching encoding (no flip) does not fire encoding-mismatch', () => {
    // Same encoding, recorded bitrate at the cap — fully in sync.
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
        target: target({ preset: 'low', presetBitrate: 128, encoding: 'vbr' }),
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lossless-boundary down: the target switched to a lossy preset while the device
// copy is still lossless. Crossing the lossless/lossy boundary is a precondition
// (correctness), so it re-encodes DOWN to the cap even under `off`.
// ---------------------------------------------------------------------------

describe('lossless-boundary down (precondition)', () => {
  test('lossless device copy + lossy target -> lossless-boundary down, fires under off', () => {
    // Source FLAC, device copy still ALAC (sync tag quality=lossless), target now
    // a lossy preset. Previously this fired a policy-gated cap-down (suppressed
    // under off); it must be a precondition that always re-encodes down.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
      syncTag: buildAudioSyncTag('lossless'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
      expectedSyncTag,
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
      fromLossless: true,
      toLossless: false,
    });
    expect(change?.targetBitrate).toBe(256);
  });

  test('direct-copied ALAC (quality=copy, lossless filetype) + lossy target -> lossless-boundary down', () => {
    // A directly-copied ALAC source carries a quality=copy tag; its losslessness
    // is read from the filetype fallback. Switching to a lossy target crosses the
    // boundary.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
      syncTag: buildCopySyncTag('fast', undefined, 'alac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
    });
  });

  test('untagged lossless device copy + lossy target -> lossless-boundary down', () => {
    // No sync tag: the device copy's losslessness is read from the filetype.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'Apple Lossless audio file', bitrate: 900 });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
      policy: 'off',
    });

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
    });
  });

  test('ALAC-filetype device tagged as a lossy transcode is NOT treated as lossless (tag is authoritative)', () => {
    // A contrived but important case: the filetype reads ALAC yet the sync tag
    // says quality=high (a lossy transcode). The tag wins — no boundary crossing,
    // and an exact-match tag is simply in sync.
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

    expect(classifyDeviceBound({ source, device, target: target(), expectedSyncTag })).toBeNull();
  });

  test('lossless device copy + lossless target -> not a boundary crossing (in sync)', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
      syncTag: buildAudioSyncTag('lossless'),
    });
    const expectedSyncTag = buildAudioSyncTag('lossless');

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'lossless', presetBitrate: 0, isAlacPreset: true }),
        expectedSyncTag,
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source-bound tolerance — damps ffprobe drift on the lossy source-bound
// comparison so a trivial source-bitrate wobble doesn't churn a re-encode.
// Default 0 = exact.
// ---------------------------------------------------------------------------

describe('source-bound tolerance (lossy cap path)', () => {
  test('toleranceDown absorbs a small source-bitrate wobble (no cap-down churn)', () => {
    // Source drifted to 200, device copy recorded 205. Without tolerance the
    // 205 > 200 effective target would fire cap-down; a 10% down tolerance
    // (20 kbps on 200) absorbs the 5 kbps wobble.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 200 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 205,
      syncTag: buildAudioSyncTag('medium', 'vbr', 205, 'fast', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256, toleranceDown: 0.1 }),
      })
    ).toBeNull();
  });

  test('toleranceUp absorbs a small source-bitrate wobble (no cap-up churn)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 200 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 195,
      syncTag: buildAudioSyncTag('medium', 'vbr', 195, 'fast', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256, toleranceUp: 0.1 }),
      })
    ).toBeNull();
  });

  test('a drift beyond the tolerance still fires a genuine cap-down', () => {
    // Source 320 >= cap 200, so the effective target is the cap (200) and the
    // 240 recorded copy is +40 (20%) above it, beyond a 10% (20 kbps) tolerance.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 240,
      syncTag: buildAudioSyncTag('high', 'vbr', 240, 'fast', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'medium', presetBitrate: 200, toleranceDown: 0.1 }),
      })
    ).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true, targetBitrate: 200 });
  });

  test('default tolerance is exact (0): a 1 kbps drift over the cap fires', () => {
    // Source 320 >= cap 200, effective target 200; recorded 201 exceeds it by 1.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 201,
      syncTag: buildAudioSyncTag('medium', 'vbr', 201, 'fast', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'medium', presetBitrate: 200 }),
      })
    ).toMatchObject({ reason: 'cap-down' });
  });
});

// ---------------------------------------------------------------------------
// Reserved vocabulary. `format-mismatch` (codec-correctness precondition) is part
// of the classifier's vocabulary but is not yet produced — codec changes are
// detected separately by the handler's codec-change pass. Every other reason,
// including both encoding-mismatch paths and the lossless-boundary crossing in
// both directions, is exercised above.
// ---------------------------------------------------------------------------

describe('reserved vocabulary', () => {
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
