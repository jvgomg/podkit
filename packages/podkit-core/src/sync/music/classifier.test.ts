import { describe, expect, test } from 'bun:test';
import { MusicTrackClassifier, classifierFromConfig } from './classifier.js';
import type { ClassifierContext } from './classifier.js';
import type { CollectionTrack } from '../../adapters/interface.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeTrack(overrides: Partial<CollectionTrack> = {}): CollectionTrack {
  return {
    artist: 'Test Artist',
    title: 'Test Song',
    album: 'Test Album',
    fileType: 'flac',
    filePath: '/music/test.flac',
    lossless: true,
    duration: 240000,
    ...overrides,
  } as CollectionTrack;
}

function makeContext(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  return {
    deviceSupportsAlac: false,
    resolvedQuality: 'high',
    transferMode: 'fast',
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

    test('FLAC + device supports FLAC natively → direct-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'mp3', 'aac'],
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'direct-copy' });
    });

    test('FLAC + device supports FLAC + embedded artwork → optimized-copy', () => {
      const classifier = new MusicTrackClassifier(
        makeContext({
          supportedAudioCodecs: ['flac', 'mp3', 'aac'],
          primaryArtworkSource: 'embedded',
        })
      );
      const result = classifier.classify(makeTrack());

      expect(result.deviceNative).toBe(true);
      expect(result.action).toEqual({ type: 'optimized-copy' });
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
        deviceSupportsAlac: false,
        transferMode: 'fast' as const,
        artworkResize: undefined,
        primaryArtworkSource: 'database' as const,
        supportedAudioCodecs: ['aac' as const, 'mp3' as const],
        transformsEnabled: false,
      };

      const ctx = classifierFromConfig(config);

      expect(ctx.supportedAudioCodecs).toEqual(['aac', 'mp3']);
      expect(ctx.deviceSupportsAlac).toBe(false);
      expect(ctx.resolvedQuality).toBe('high');
      expect(ctx.customBitrate).toBe(192);
      expect(ctx.primaryArtworkSource).toBe('database');
      expect(ctx.transferMode).toBe('fast');
    });

    test('passes resolvedLossyCodec and resolvedLosslessStack from config', () => {
      const config = {
        raw: { quality: 'max' as const, transcoder: {} as never },
        isAlacPreset: true,
        resolvedQuality: 'lossless',
        presetBitrate: 700,
        deviceSupportsAlac: false,
        transferMode: 'fast' as const,
        artworkResize: undefined,
        primaryArtworkSource: undefined,
        supportedAudioCodecs: ['opus' as const, 'flac' as const, 'mp3' as const],
        transformsEnabled: false,
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
