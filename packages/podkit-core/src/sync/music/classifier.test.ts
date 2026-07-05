import { describe, expect, test } from 'bun:test';
import { MusicTrackClassifier, classifierFromConfig } from './classifier.js';
import type { ClassifierContext } from './classifier.js';
import { resolveReductionAxis } from '../engine/lossy-reduction.js';
import { makeMockCollectionTrack } from '../../test-utils/tracks.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const makeTrack = makeMockCollectionTrack;

function makeContext(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  // Mirror the real resolution: the reduction axis defaults to following the
  // transfer mode (`reduce = auto`) unless a test pins it explicitly.
  const transferMode = overrides.transferMode ?? 'fast';
  return {
    deviceSupportsAlac: false,
    resolvedQuality: 'high',
    transferMode,
    presetBitrate: 0,
    reductionAxis: resolveReductionAxis('auto', transferMode),
    reductionTolerance: 0.25,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('MusicTrackClassifier', () => {
  describe('FLAC tracks', () => {
    test('FLAC + no device codecs → transcode to high', () => {
      const classifier = new MusicTrackClassifier(makeContext());
      const result = classifier.classify(makeTrack());

      expect(result.sourceCategory).toBe('lossless');
      expect(result.deviceNative).toBe(false);
      expect(result.isLossless).toBe(true);
      expect(result.warnLossyToLossy).toBe(false);
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high' },
      });
    });

    test('FLAC + ALAC-capable device + quality lossless → transcode to lossless', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          deviceSupportsAlac: true,
          resolvedQuality: 'lossless',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.sourceCategory).toBe('lossless');
      expect(result.isLossless).toBe(true);
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'lossless' },
      });
    });

    test('FLAC + device supports FLAC natively + lossless preset → direct-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'mp3', 'aac'],
          resolvedQuality: 'lossless',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('FLAC + device supports FLAC + embedded artwork + lossless preset → optimized-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'mp3', 'aac'],
          primaryArtworkSource: 'embedded',
          resolvedQuality: 'lossless',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('FLAC + device supports FLAC natively + high preset → transcode', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'mp3', 'aac'],
          resolvedQuality: 'high',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.deviceNative).toBe(true);
      expect(result.isLossless).toBe(true);
      expect(result.action.type).toBe('transcode');
    });
  });

  describe('ALAC tracks', () => {
    test('ALAC source + ALAC-capable device + quality lossless → direct-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          deviceSupportsAlac: true,
          resolvedQuality: 'lossless',
        })
      );
      const track = makeTrack({
        fileType: 'm4a',
        filePath: '/music/test.m4a',
        codec: 'alac',
        lossless: true,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('lossless');
      expect(result.isLossless).toBe(true);
      // ALAC source with lossless preset → direct copy (no transcode needed)
      expect(result.action).toEqual({ type: 'direct-copy' });
    });
  });

  describe('MP3 tracks', () => {
    test('MP3 → direct-copy (compatible lossy)', () => {
      const classifier = new MusicTrackClassifier(makeContext());
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/test.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('compatible-lossy');
      expect(result.deviceNative).toBe(false);
      expect(result.isLossless).toBe(false);
      expect(result.warnLossyToLossy).toBe(false);
      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('MP3 + optimized transfer mode → optimized-copy', () => {
      const classifier = new MusicTrackClassifier(makeContext({ transferMode: 'optimized' }));
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/test.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('MP3 + embedded artwork device → optimized-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ primaryArtworkSource: 'embedded' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/test.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });
  });

  describe('OGG tracks', () => {
    test('OGG → transcode (incompatible lossy) with bitrate capped', () => {
      const classifier = new MusicTrackClassifier(makeContext());
      const track = makeTrack({
        fileType: 'ogg',
        filePath: '/music/test.ogg',
        lossless: false,
        bitrate: 192,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('incompatible-lossy');
      expect(result.isLossless).toBe(false);
      expect(result.warnLossyToLossy).toBe(true);
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high' },
      });
    });

    test('OGG + custom bitrate → transcode with bitrateOverride', () => {
      const classifier = new MusicTrackClassifier(makeContext({ customBitrate: 128 }));
      const track = makeTrack({
        fileType: 'ogg',
        filePath: '/music/test.ogg',
        lossless: false,
        bitrate: 192,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', bitrateOverride: 128 },
      });
    });
  });

  describe('lossy reduction on add (ADR-023)', () => {
    test('device-native MP3 above the cap under preserve (fast default) → copied untouched', () => {
      // fast → reduce=auto → preserve: an over-cap device-native lossy source is
      // honoured, not re-encoded. This is the ADR-010 copy-as-is rule.
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['mp3', 'aac'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 128,
          resolvedQuality: 'low',
          transferMode: 'fast',
        })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('device-native MP3 above the cap under portable → copied untouched', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['mp3', 'aac'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 128,
          resolvedQuality: 'low',
          transferMode: 'portable',
        })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('device-native MP3 above the cap under convert (optimized) → reduced to the cap', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['mp3', 'aac'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 128,
          resolvedQuality: 'low',
          transferMode: 'optimized',
        })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.deviceNative).toBe(true);
      // convert reduces an over-cap source down to the cap (raw kbps), in the
      // resolved lossy codec — what a later re-sync would produce too.
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'low', targetCodec: 'aac', bitrateOverride: 128 },
      });
      expect(result.warnLossyToLossy).toBe(false);
    });

    test('compatible-lossy MP3 (default iPod) above the cap under convert → reduced to the cap', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 128, resolvedQuality: 'low', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('compatible-lossy');
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'low', bitrateOverride: 128 },
      });
    });

    test('convert: MP3 just inside the tolerance band → copied (no churn)', () => {
      // cap=128, tol=0.25 → reduce only when source > 160.
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 128, resolvedQuality: 'low', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/near.mp3',
        lossless: false,
        bitrate: 156,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('convert: MP3 just outside the tolerance band → reduced to the cap', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 128, resolvedQuality: 'low', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/over.mp3',
        lossless: false,
        bitrate: 161,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'low', bitrateOverride: 128 },
      });
    });

    test('convert: MP3 at the cap → copied as-is (no needless lossy re-encode)', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 256, resolvedQuality: 'high', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/exact.mp3',
        lossless: false,
        bitrate: 256,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('convert: MP3 below the cap → copied as-is', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 256, resolvedQuality: 'high', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/quiet.mp3',
        lossless: false,
        bitrate: 192,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('convert: MP3 with unknown bitrate → copied as-is (never transcode blindly)', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 128, resolvedQuality: 'low', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/unknown.mp3',
        lossless: false,
        bitrate: 0,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('no cap configured (presetBitrate 0 — defensive zero-cap guard) under convert → copied as-is', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 0, transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('lossy source under a lossless target (cap ~900) under convert → copied as-is, not reduced', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 900, resolvedQuality: 'lossless', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({ type: 'optimized-copy' });
    });

    test('reduced add does not raise a lossy-to-lossy warning (consistent with cap-down)', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({ presetBitrate: 128, resolvedQuality: 'low', transferMode: 'optimized' })
      );
      const track = makeTrack({
        fileType: 'mp3',
        filePath: '/music/loud.mp3',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.warnLossyToLossy).toBe(false);
    });

    test('incompatible-lossy (necessity) under preserve → efficiency-matched, cap-bounded transcode', () => {
      // Vorbis source on a device that cannot play it: forced transcode to AAC.
      // preserve targets min(round(224 × eff[aac]/eff[vorbis]), cap=256) =
      // min(round(248.9), 256) = 249.
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['aac', 'mp3'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 256,
          resolvedQuality: 'high',
          transferMode: 'fast',
        })
      );
      const track = makeTrack({
        fileType: 'ogg',
        filePath: '/music/song.ogg',
        codec: 'vorbis',
        lossless: false,
        bitrate: 224,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('incompatible-lossy');
      expect(result.warnLossyToLossy).toBe(true);
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'aac', bitrateOverride: 249 },
      });
    });

    test('incompatible-lossy (necessity) under preserve → efficiency target above cap is clamped to the cap', () => {
      // High-bitrate Opus on a device that cannot play it, low cap: the
      // efficiency match would exceed the cap, so the hard ceiling wins and the
      // clamped bitrate flows through to bitrateOverride.
      // round(320 × eff[aac]/eff[opus]) = round(320 × 1.0/0.75) = 427; min(427, cap=128) = 128.
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['aac', 'mp3'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 128,
          resolvedQuality: 'low',
          transferMode: 'fast',
        })
      );
      const track = makeTrack({
        fileType: 'ogg',
        filePath: '/music/song.ogg',
        codec: 'opus',
        lossless: false,
        bitrate: 320,
      });
      const result = classifier.classify(track);

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'low', targetCodec: 'aac', bitrateOverride: 128 },
      });
    });

    test('deviceMaxBitrate threads to the seam and clamps a preserve-necessity target', () => {
      // The add-path classifier forwards the device maximum to the seam. A device
      // declaring maxAudioBitrate=112 clamps the efficiency-matched target below
      // the cap: round(96 × eff[aac]/eff[opus]) = 128, min(128, cap=256, 112) = 112.
      const ctx = makeContext({
        supportedAudioCodecs: ['aac', 'mp3'],
        resolvedLossyCodec: 'aac',
        presetBitrate: 256,
        resolvedQuality: 'high',
        transferMode: 'fast',
        deviceMaxBitrate: 112,
      });
      const track = makeTrack({
        fileType: 'opus',
        filePath: '/music/song.opus',
        codec: 'opus',
        lossless: false,
        bitrate: 96,
      });
      expect(new MusicTrackClassifier(ctx).classify(track).action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'aac', bitrateOverride: 112 },
      });

      // Absent deviceMaxBitrate leaves the same target unbounded by any device
      // maximum: it lands at the efficiency match (128), under the cap.
      const unbounded = makeContext({
        supportedAudioCodecs: ['aac', 'mp3'],
        resolvedLossyCodec: 'aac',
        presetBitrate: 256,
        resolvedQuality: 'high',
        transferMode: 'fast',
      });
      expect(new MusicTrackClassifier(unbounded).classify(track).action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'aac', bitrateOverride: 128 },
      });
    });

    test('incompatible-lossy (necessity) under convert → min(source, cap) transcode', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['aac', 'mp3'],
          resolvedLossyCodec: 'aac',
          presetBitrate: 256,
          resolvedQuality: 'high',
          transferMode: 'optimized',
        })
      );
      const track = makeTrack({
        fileType: 'ogg',
        filePath: '/music/song.ogg',
        codec: 'vorbis',
        lossless: false,
        bitrate: 224,
      });
      const result = classifier.classify(track);

      // convert: min(source=224, cap=256) = 224 (raw kbps, no efficiency).
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'aac', bitrateOverride: 224 },
      });
    });
  });

  describe('caching', () => {
    test('classify same track twice returns cached result', () => {
      const classifier = new MusicTrackClassifier(makeContext());
      const track = makeTrack();

      const first = classifier.classify(track);
      const second = classifier.classify(track);

      // Same object reference (cached)
      expect(first).toBe(second);
    });

    test('different file paths are classified independently', () => {
      const classifier = new MusicTrackClassifier(makeContext());

      const flac = makeTrack({ filePath: '/music/a.flac', fileType: 'flac', lossless: true });
      const mp3 = makeTrack({ filePath: '/music/b.mp3', fileType: 'mp3', lossless: false });

      const flacResult = classifier.classify(flac);
      const mp3Result = classifier.classify(mp3);

      expect(flacResult.action.type).toBe('transcode');
      expect(mp3Result.action.type).toBe('direct-copy');
    });
  });

  describe('classifierFromConfig', () => {
    test('extracts relevant fields from ResolvedMusicConfig', () => {
      // Minimal mock of ResolvedMusicConfig
      const config = {
        raw: { quality: 'high' as const, transcoder: {} as never, customBitrate: 192 },
        isAlacPreset: false,
        resolvedQuality: 'high',
        presetBitrate: 256,
        reductionAxis: 'convert' as const,
        reductionTolerance: 0.4,
        deviceSupportsAlac: false,
        transferMode: 'fast' as const,
        artworkResize: undefined,
        sidecarResize: undefined,
        primaryArtworkSource: 'database' as const,
        supportedAudioCodecs: ['aac' as const, 'mp3' as const],
        transformsEnabled: false,
        audioNormalization: 'soundcheck' as const,
      };

      const ctx = classifierFromConfig(config);

      expect(ctx.supportedAudioCodecs).toEqual(['aac', 'mp3']);
      expect(ctx.deviceSupportsAlac).toBe(false);
      expect(ctx.resolvedQuality).toBe('high');
      expect(ctx.customBitrate).toBe(192);
      expect(ctx.primaryArtworkSource).toBe('database');
      expect(ctx.transferMode).toBe('fast');
      expect(ctx.presetBitrate).toBe(256);
      expect(ctx.reductionAxis).toBe('convert');
      expect(ctx.reductionTolerance).toBe(0.4);
    });

    test('passes resolvedLossyCodec and resolvedLosslessStack from config', () => {
      const config = {
        raw: { quality: 'max' as const, transcoder: {} as never },
        isAlacPreset: true,
        resolvedQuality: 'lossless',
        presetBitrate: 700,
        reductionAxis: 'preserve' as const,
        reductionTolerance: 0.25,
        deviceSupportsAlac: false,
        transferMode: 'fast' as const,
        artworkResize: undefined,
        sidecarResize: undefined,
        primaryArtworkSource: undefined,
        supportedAudioCodecs: ['opus' as const, 'flac' as const, 'mp3' as const],
        transformsEnabled: false,
        audioNormalization: 'soundcheck' as const,
        resolvedLossyCodec: 'opus' as const,
        resolvedLosslessStack: ['source' as const, 'flac' as const],
      };

      const ctx = classifierFromConfig(config);

      expect(ctx.resolvedLossyCodec).toBe('opus');
      expect(ctx.resolvedLosslessStack).toEqual(['source', 'flac']);
    });
  });

  describe('codec preference integration', () => {
    test('default stack + iPod capabilities → resolves to AAC (targetCodec on preset)', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['aac', 'mp3', 'alac'],
          resolvedLossyCodec: 'aac',
          resolvedQuality: 'high',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'aac' },
      });
    });

    test('device supporting opus but not FLAC → FLAC transcoded to Opus', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['opus', 'mp3', 'aac'],
          resolvedLossyCodec: 'opus',
          resolvedQuality: 'high',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'opus' },
      });
    });

    test('max preset + FLAC-capable device → lossless stack resolves, FLAC sources copied', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'opus', 'mp3'],
          resolvedLossyCodec: 'opus',
          resolvedQuality: 'lossless',
          resolvedLosslessStack: ['source', 'flac'],
        })
      );
      const result = classifier.classify(makeTrack());

      // FLAC source + device supports FLAC + 'source' in stack → copy
      expect(result.sourceCategory).toBe('lossless');
      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('max preset + ALAC-only lossless → transcodes to ALAC', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['aac', 'alac', 'mp3'],
          resolvedLossyCodec: 'aac',
          resolvedQuality: 'lossless',
          resolvedLosslessStack: ['source', 'alac'],
        })
      );
      // FLAC source — device doesn't support FLAC, so 'source' is skipped
      const result = classifier.classify(makeTrack());

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'lossless', targetCodec: 'alac' },
      });
    });

    test('max preset + no lossless support → falls to lossy at high', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['opus', 'mp3'],
          resolvedLossyCodec: 'opus',
          resolvedQuality: 'lossless',
          resolvedLosslessStack: [], // empty — no lossless codecs available
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'high', targetCodec: 'opus' },
      });
    });

    test('WAV source + source in lossless stack → source skipped (WAV not in CODEC_METADATA)', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'opus', 'mp3'],
          resolvedLossyCodec: 'opus',
          resolvedQuality: 'lossless',
          resolvedLosslessStack: ['source', 'flac'],
        })
      );
      const track = makeTrack({
        fileType: 'wav',
        filePath: '/music/test.wav',
        lossless: true,
      });
      const result = classifier.classify(track);

      // WAV is not in CODEC_METADATA, so 'source' is skipped → falls to 'flac'
      expect(result.action).toEqual({
        type: 'transcode',
        preset: { name: 'lossless', targetCodec: 'flac' },
      });
    });

    test('Opus source on Opus-capable device → classified as compatible-lossy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['opus', 'flac', 'mp3'],
          resolvedLossyCodec: 'opus',
          resolvedQuality: 'high',
        })
      );
      const track = makeTrack({
        fileType: 'opus',
        filePath: '/music/test.opus',
        lossless: false,
      });
      const result = classifier.classify(track);

      expect(result.sourceCategory).toBe('compatible-lossy');
      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'direct-copy' });
    });
  });
});
