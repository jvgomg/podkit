/**
 * Unit tests for the unified quality classifier (`classifyQualityChange` and
 * its two bounds `classifySourceBound` / `classifyDeviceBound`).
 *
 * The classifier is pure, so the matrix of (transition × source type × tag
 * state) is covered exhaustively here without spinning up a sync.
 *
 * The lossy device-bound reduction is down-only (ADR-023): it reuses the shared
 * lossy-reduction seam against the device's RECORDED bitrate (the sync tag) with
 * an EXACT recorded-vs-cap comparison, so the add path and the re-sync never
 * disagree. A lossy source is never re-encoded UP and a lossy CBR/VBR flip never
 * re-encodes. The lossless paths (sync-tag-exact preset moves, the ALAC upgrade,
 * the lossless-boundary crossing, and the lossless CBR/VBR `encoding-mismatch`)
 * are covered alongside.
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
// Target builders — the device's configured quality intent. `axis` defaults to
// `convert` in the classifier (cap-enforcing); a test opts into `preserve`
// explicitly via the override.
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
// classifySourceBound — source-vs-device. Only the lossless-boundary crossing
// survives; a lossy source whose bitrate climbed is NOT a quality change here
// (ADR-023 down-only) — a genuinely changed source folds into content-change
// detection.
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

  test('same-family lossy source with a higher bitrate -> null (no lossy up-encode)', () => {
    // Re-encoding a lossy source up cannot recover discarded information, so a
    // climbed source bitrate is never a quality change here (ADR-023).
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });

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
// classifySourceBound — source-down (bad re-rip). A lossy source dropped
// meaningfully below the device's recorded (sync-tag) bitrate: keep the better
// device copy, report it, never re-encode down to the worse source.
// ---------------------------------------------------------------------------

describe('classifySourceBound — source-down (bad re-rip, report-only)', () => {
  test('lossy source below the device recorded bitrate -> source-down-suppressed (no re-encode)', () => {
    // Device holds a 256 kbps copy podkit recorded; the source was re-ripped to
    // 128 kbps. The device copy is better — keep it, report the situation.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 128 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 256,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 256),
    });

    const change = classifySourceBound(source, device, 256);

    expect(change).toMatchObject({
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: false,
      encodedBitrate: 256,
      sourceBitrate: 128,
    });
  });

  test('source only trivially below recorded (within tolerance) -> null (ffprobe wobble)', () => {
    // 240 vs a recorded 256 is a ~6% drop — VBR/ffprobe wobble, not a re-rip.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 240 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 256,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 256),
    });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  test('untagged device track -> null (no authoritative recorded bitrate)', () => {
    // Without a sync tag there is no recorded bitrate to compare against — the DB
    // bitrate is never consulted, so the track is opted out of the report.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 128 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 256 });

    expect(classifySourceBound(source, device, 256)).toBeNull();
  });

  test('explicit tolerance widens the in-sync band', () => {
    // With tolerance 0.5, a 160 source against a recorded 256 (37.5% drop) is
    // still treated as wobble (threshold = 256 * 0.5 = 128).
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 160 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 256,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 256),
    });

    expect(classifySourceBound(source, device, 256, 0.5)).toBeNull();
    expect(classifySourceBound(source, device, 256, 0)).toMatchObject({
      reason: 'source-down-suppressed',
    });
  });
});

// ---------------------------------------------------------------------------
// classifyDeviceBound — lossy reduction (down-only, ADR-023).
//
// The device sync tag's RECORDED bitrate is the sole authoritative `encoded`
// value — the DB bitrate is never consulted. The comparison against the cap is
// EXACT (tolerance 0): a cap you lowered applies fully on the next sync; a track
// already at the cap re-syncs to a no-op. `convert` reduces an over-cap track to
// the cap; `preserve` keeps it untouched; neither ever lifts a lossy track up.
// ---------------------------------------------------------------------------

describe('classifyDeviceBound — lossy reduction', () => {
  test('convert: recorded above the cap -> cap-down to the cap (re-encodes)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.encodedBitrate).toBe(320);
    expect(change?.targetBitrate).toBe(128);
  });

  test('deviceMax clamps the device-bound cap-down below the quality cap (hard device ceiling)', () => {
    // A device declaring a maxAudioBitrate below the quality cap forces the
    // reduction down to that hard ceiling, not just to the preset cap: a 320
    // recorded copy against cap 128 + deviceMax 64 reduces to 64, whereas the same
    // target without deviceMax reduces to the cap (128).
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    const withMax = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128, axis: 'convert', deviceMax: 64 }),
    });
    const withoutMax = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
    });

    expect(withMax?.targetBitrate).toBe(64); // the device ceiling, tighter than the cap
    expect(withoutMax?.targetBitrate).toBe(128); // the preset cap when no device max
  });

  test('deviceMax forces a reduction under preserve on the device bound (device constraint, not a preference)', () => {
    // Preserve normally leaves a device-native copy untouched (the cap does not
    // apply), but a recorded 320 copy on a device that maxes at 128 cannot be
    // played as-is, so the device constraint forces a cap-down to min(cap, 128).
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256, axis: 'preserve', deviceMax: 128 }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.targetBitrate).toBe(128);
  });

  test('convert: a COPY tag in the tolerance band above the cap -> null (add and re-sync agree)', () => {
    // A device-native source at 280 kbps, cap 256, convert, tolerance 0.25: the
    // add path COPIES it (280 < 256×1.25=320), recording a quality=copy tag at
    // 280. The re-sync must NOT then reduce it — re-evaluating the copy tag with
    // the SAME tolerance keeps add and re-sync in agreement (idempotent).
    const source = makeMockCollectionTrack({ fileType: 'aac', lossless: false, bitrate: 280 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 280,
      syncTag: buildCopySyncTag('fast', undefined, 'aac', 280),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({
          preset: 'high',
          presetBitrate: 256,
          axis: 'convert',
          reductionTolerance: 0.25,
        }),
      })
    ).toBeNull();
  });

  test('convert: a COPY tag is still reduced when the cap is lowered past the tolerance band', () => {
    // Same 280 kbps copy, but the cap was lowered to 128. 280 > 128×1.25=160, so
    // the copy is now genuinely over-cap and reduces to the new cap.
    const source = makeMockCollectionTrack({ fileType: 'aac', lossless: false, bitrate: 280 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 280,
      syncTag: buildCopySyncTag('fast', undefined, 'aac', 280),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({
        preset: 'low',
        presetBitrate: 128,
        axis: 'convert',
        reductionTolerance: 0.25,
      }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.targetBitrate).toBe(128);
  });

  test('convert: a CONVERTED preset tag uses the EXACT comparison (a lowered cap applies fully)', () => {
    // A lossy source podkit converted down to `high` (recorded == the old cap,
    // 256). The cap was lowered to 192. Unlike a copy tag, a converted preset tag
    // is compared exactly — the tolerance does NOT apply — so the lowered cap
    // reduces it even though 256 < 192×1.25=240.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr', 256, 'optimized', 'aac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({
        preset: 'medium',
        presetBitrate: 192,
        axis: 'convert',
        reductionTolerance: 0.25,
      }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.targetBitrate).toBe(192);
  });

  test('convert: recorded equal to the cap -> null (in sync)', () => {
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
        target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
      })
    ).toBeNull();
  });

  test('previously-reduced track below a raised cap -> below-cap (report-only, never lifted)', () => {
    // A track podkit REDUCED to `low` (96) now sits below a raised cap (256).
    // Down-only never re-encodes it up automatically — that is reported so the
    // user can `--force-transcode` to lift it. The report carries reEncodes:false.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 96,
      syncTag: buildAudioSyncTag('low', 'vbr', 96, 'fast', 'aac'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256, axis: 'convert' }),
    });

    expect(change).toMatchObject({
      reason: 'below-cap',
      direction: 'up',
      reEncodes: false,
      targetBitrate: 256,
      encodedBitrate: 96,
    });
  });

  test('device-native COPY below the cap -> null (never reduced; stays low-noise)', () => {
    // A device-native lossy track simply COPIED (quality=copy) and recorded below
    // the cap was never reduced, so it does NOT qualify for the below-cap report.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 96 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 96,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 96),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256, axis: 'convert' }),
      })
    ).toBeNull();
  });

  test('reduced track recorded EXACTLY at the cap -> null (in sync, no below-cap report)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 256,
      syncTag: buildAudioSyncTag('high', 'vbr', 256, 'fast', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'high', presetBitrate: 256, axis: 'convert' }),
      })
    ).toBeNull();
  });

  test('preserve: recorded above the cap -> null (device-native lossy kept untouched)', () => {
    // ADR-010 honored: under `preserve` (the default in fast/portable) a
    // device-native lossy track is copied as-is, even over the cap.
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
        target: target({ preset: 'low', presetBitrate: 128, axis: 'preserve' }),
      })
    ).toBeNull();
  });

  test('default axis is convert: over-cap recorded fires cap-down without an explicit axis', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    expect(
      classifyDeviceBound({ source, device, target: target({ preset: 'low', presetBitrate: 128 }) })
    ).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true, targetBitrate: 128 });
  });

  test('no recorded bitrate in the sync tag -> null (opt out; no DB guessing)', () => {
    // A copy tag written before sync-tag bitrate recording carries no `bitrate=`;
    // the DB bitrate (320) is deliberately NOT consulted.
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
        target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
      })
    ).toBeNull();
  });

  test('untagged lossy track -> null (opted out; no DB-bitrate guessing)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 320 });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 96, axis: 'convert' }),
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

  test('a lossy CBR/VBR encoding flip never re-encodes (ADR-023 §6)', () => {
    // The device holds an AAC copy recorded at the cap (128, VBR). The user
    // flips to CBR but the bitrate is unchanged. Re-encoding a lossy source for a
    // mode flip is a lossy->lossy degradation that can grow the file, so it is
    // never done — the track stays in sync.
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
        target: target({ preset: 'low', presetBitrate: 128, encoding: 'cbr', axis: 'convert' }),
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Idempotency: a track converted on add lands at the cap in its sync tag, and
// the re-sync device-bound reuses the same seam — so it re-syncs to a no-op.
// This is the structural guarantee against an add-vs-resync disagreement.
// ---------------------------------------------------------------------------

describe('add ↔ re-sync idempotency (shared seam)', () => {
  test('a converted track (recorded == cap) re-syncs to no change', () => {
    // On add, a 320 kbps source was converted down to the cap (128) and the sync
    // tag recorded 128. On the next sync the device-bound compares the recorded
    // 128 against the cap 128 with tolerance 0 — not `> cap`, so the seam returns
    // copy and the classifier returns null. No second-pass re-encode.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 128,
      syncTag: buildAudioSyncTag('low', 'vbr', 128, 'optimized', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
      })
    ).toBeNull();
  });

  test('a zero recorded bitrate opts out (no throw) rather than entering the seam', () => {
    // A corrupt or third-party sync tag can carry bitrate=0. That is not a usable
    // source bitrate, so the device-bound opts out (null) rather than passing 0
    // into the seam, which rejects a non-positive source bitrate.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 0,
      syncTag: buildAudioSyncTag('low', 'vbr', 0, 'optimized', 'aac'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'low', presetBitrate: 128, axis: 'convert' }),
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyDeviceBound — lossless device-vs-target (sync-tag-exact / ALAC).
// Lossless sources may legitimately be re-encoded up to a higher preset (cap-up)
// or down (cap-down); the source carries the full quality.
// ---------------------------------------------------------------------------

describe('classifyDeviceBound — lossless (sync-tag exact, authoritative)', () => {
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

  test('tag below target tier -> cap-up (re-encode the lossless source up)', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({
      filetype: 'AAC audio file',
      bitrate: 128,
      syncTag: buildAudioSyncTag('low', 'vbr'),
    });
    const expectedSyncTag = buildAudioSyncTag('high', 'vbr');

    const change = classifyDeviceBound({ source, device, target: target(), expectedSyncTag });

    expect(change).toMatchObject({ reason: 'cap-up', direction: 'up', reEncodes: true });
  });

  test('same tier, a newly-added lower custom bitrate -> cap-down (not mislabelled cap-up)', () => {
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

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
  });
});

describe('untagged lossless tracks are opted out (no DB-bitrate fallback)', () => {
  // The sync tag is the sole quality truth. A track podkit did not write (no
  // sync tag) carries no authoritative recorded encoding, so it is opted out —
  // there is no guessing from the unreliable iPod-DB bitrate.

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

    expect(change).toMatchObject({ reason: 'cap-up', direction: 'up', toLossless: true });
  });

  test('an exact tag comparison takes priority over the ALAC branch', () => {
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

// ---------------------------------------------------------------------------
// classifyQualityChange — composition of both bounds. The source bound is
// checked first; the device bound only fires when the source bound is null.
// ---------------------------------------------------------------------------

describe('classifyQualityChange (composed)', () => {
  test('source bound wins when both could fire', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });

    const change = classifyQualityChange({ source, device, target: target() });

    expect(change?.reason).toBe('lossless-boundary');
  });

  test('device bound fires when source bound is null (lossless preset up)', () => {
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

  test('tagged lossy track above the cap -> cap-down via the device bound (convert default)', () => {
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'MPEG audio file',
      bitrate: 320,
      syncTag: buildCopySyncTag('fast', undefined, 'mp3', 320),
    });

    const change = classifyQualityChange({
      source,
      device,
      target: target({ preset: 'low', presetBitrate: 96, axis: 'convert' }),
    });

    expect(change).toMatchObject({ reason: 'cap-down', direction: 'down', reEncodes: true });
    expect(change?.encodedBitrate).toBe(320);
    expect(change?.targetBitrate).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// Encoding-mismatch (CBR<->VBR) is a precondition class on the LOSSLESS-source
// sync-tag path: re-encoding reads the lossless source, so it is correctness,
// not a lossy degradation. It fires regardless of any concurrent tier move.
// ---------------------------------------------------------------------------

describe('encoding-mismatch (lossless precondition)', () => {
  test('VBR->CBR flip at the same tier -> encoding-mismatch (format-only)', () => {
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
    });

    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'format-only',
      reEncodes: true,
    });
  });

  test('encoding flip that coincides with a tier move keeps that direction', () => {
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
    });

    expect(change).toMatchObject({
      reason: 'encoding-mismatch',
      direction: 'down',
      reEncodes: true,
    });
  });
});

// ---------------------------------------------------------------------------
// lossless-boundary down: the target switched to a lossy preset while the device
// copy is still lossless. Crossing the lossless/lossy boundary is a precondition
// (correctness), so it always re-encodes DOWN to the cap.
// ---------------------------------------------------------------------------

describe('lossless-boundary down (precondition)', () => {
  test('lossless device copy + lossy target -> lossless-boundary down', () => {
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

  test('lossless device copy + now-LOSSY source + lossy target -> lossless-boundary down', () => {
    // The source was re-derived as lossy (e.g. FLAC replaced with MP3) while the
    // device still holds the ALAC copy and the target is a lossy preset. The lossy
    // routing alone would read the absent recorded bitrate of the lossless tag and
    // return null, leaving an over-ceiling lossless copy in place. The guard keeps
    // the boundary crossing firing regardless of source losslessness.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
      syncTag: buildAudioSyncTag('lossless'),
    });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
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

  test('lossless device copy + lossy source + LOSSLESS target -> null (both lossless, in sync)', () => {
    // The guard must NOT fire when the target is itself lossless — the ALAC copy
    // is already at the lossless target.
    const source = makeMockCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 320 });
    const device = makeMockDeviceTrack({
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
      syncTag: buildAudioSyncTag('lossless'),
    });

    expect(
      classifyDeviceBound({
        source,
        device,
        target: target({ preset: 'lossless', presetBitrate: 0, isAlacPreset: true }),
      })
    ).toBeNull();
  });

  test('direct-copied ALAC (quality=copy, lossless filetype) + lossy target -> lossless-boundary down', () => {
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
    });

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
    });
  });

  test('untagged lossless device copy + lossy target -> lossless-boundary down', () => {
    const source = makeMockCollectionTrack({ fileType: 'flac', lossless: true });
    const device = makeMockDeviceTrack({ filetype: 'Apple Lossless audio file', bitrate: 900 });

    const change = classifyDeviceBound({
      source,
      device,
      target: target({ preset: 'high', presetBitrate: 256 }),
    });

    expect(change).toMatchObject({
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
    });
  });

  test('ALAC-filetype device tagged as a lossy transcode is NOT treated as lossless (tag is authoritative)', () => {
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
// Reserved vocabulary. `format-mismatch` (codec-correctness precondition) and
// `source-down-suppressed` (the report-only channel, repopulated by the
// "below a raised cap" surfacing in a later slice) are part of the classifier's
// vocabulary but are not produced by the audio classifier here. Every other
// reason is exercised above.
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
      'source-down-suppressed',
      'below-cap',
    ];
    const directions: QualityChange['direction'][] = ['up', 'down', 'format-only'];
    expect(reasons).toHaveLength(7);
    expect(directions).toHaveLength(3);
  });
});

// Silence unused-import lint when scaffold fixtures are not yet consumed.
export type _Fixtures = [CollectionTrack, DeviceTrack];
