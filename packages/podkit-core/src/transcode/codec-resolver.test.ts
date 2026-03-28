/**
 * Tests for codec preference resolver
 */

import { describe, expect, it } from 'bun:test';
import { CODEC_METADATA, DEFAULT_LOSSLESS_STACK } from './codecs.js';
import type { EncoderAvailability } from './codec-resolver.js';
import { isCodecResolutionError, resolveCodecPreferences } from './codec-resolver.js';

// =============================================================================
// Test helpers
// =============================================================================

const allEncoders: EncoderAvailability = { hasEncoder: () => true };
const noOpus: EncoderAvailability = { hasEncoder: (c) => c !== 'opus' };

/** Rockbox-like device: supports many codecs */
const rockboxCodecs = ['opus', 'aac', 'mp3', 'flac', 'alac', 'ogg'] as const;

/** iPod: limited codec support */
const ipodCodecs = ['aac', 'mp3', 'alac'] as const;

// =============================================================================
// Tests
// =============================================================================

describe('resolveCodecPreferences', () => {
  describe('basic resolution', () => {
    it('resolves default stack with Rockbox capabilities to Opus', () => {
      const result = resolveCodecPreferences(undefined, rockboxCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('opus');
      expect(result.lossy.metadata).toEqual(CODEC_METADATA.opus);
    });

    it('resolves default stack with iPod capabilities to AAC (opus not supported)', () => {
      const result = resolveCodecPreferences(undefined, ipodCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('aac');
      expect(result.lossy.metadata).toEqual(CODEC_METADATA.aac);
    });
  });

  describe('encoder fallthrough', () => {
    it('falls through to AAC when device supports opus but encoder is unavailable', () => {
      const result = resolveCodecPreferences({ lossy: ['opus', 'aac'] }, rockboxCodecs, noOpus);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('aac');
    });
  });

  describe('error cases', () => {
    it('returns error when preference is opus but device only supports aac', () => {
      const result = resolveCodecPreferences({ lossy: ['opus'] }, ['aac'], allEncoders);

      expect(isCodecResolutionError(result)).toBe(true);
      if (!isCodecResolutionError(result)) return;

      expect(result.type).toBe('no-compatible-codec');
      expect(result.stack).toBe('lossy');
      expect(result.preferred).toEqual(['opus']);
      expect(result.deviceSupported).toEqual(['aac']);
    });
  });

  describe('device override config', () => {
    it('uses custom lossy config regardless of device opus support', () => {
      const result = resolveCodecPreferences(
        { lossy: ['aac'] },
        rockboxCodecs, // supports opus
        allEncoders
      );

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('aac');
    });
  });

  describe('default stacks', () => {
    it('uses DEFAULT_LOSSY_STACK and DEFAULT_LOSSLESS_STACK when config is undefined', () => {
      const result = resolveCodecPreferences(undefined, rockboxCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      // Default lossy stack starts with opus
      expect(result.lossy.codec).toBe('opus');

      // Lossless stack should reflect defaults resolved against rockbox
      // DEFAULT_LOSSLESS_STACK = ['source', 'flac', 'alac']
      expect(result.lossless).toHaveLength(DEFAULT_LOSSLESS_STACK.length);
      expect(result.lossless[0]).toBe('source');
    });
  });

  describe('lossless source passthrough', () => {
    it('passes source through and resolves codecs on device supporting all', () => {
      const result = resolveCodecPreferences(undefined, rockboxCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      // DEFAULT_LOSSLESS_STACK = ['source', 'flac', 'alac']
      expect(result.lossless).toEqual([
        'source',
        { codec: 'flac', metadata: CODEC_METADATA.flac },
        { codec: 'alac', metadata: CODEC_METADATA.alac },
      ]);
    });

    it('filters out unsupported lossless codecs on iPod (no flac)', () => {
      const result = resolveCodecPreferences(undefined, ipodCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      // iPod doesn't support flac, so only source + alac
      expect(result.lossless).toEqual(['source', { codec: 'alac', metadata: CODEC_METADATA.alac }]);
    });
  });

  describe('array config', () => {
    it('works with array preferences', () => {
      const result = resolveCodecPreferences(
        { lossy: ['mp3', 'aac'], lossless: ['alac'] },
        ipodCodecs,
        allEncoders
      );

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('mp3');
      expect(result.lossless).toEqual([{ codec: 'alac', metadata: CODEC_METADATA.alac }]);
    });
  });

  describe('unknown codec validation', () => {
    it('throws on unknown codec in lossy stack', () => {
      expect(() =>
        resolveCodecPreferences({ lossy: ['vorbis'] }, rockboxCodecs, allEncoders)
      ).toThrow(/Unknown codec 'vorbis'/);
    });

    it('throws on unknown codec in lossless stack', () => {
      expect(() =>
        resolveCodecPreferences({ lossless: ['wavpack'] }, rockboxCodecs, allEncoders)
      ).toThrow(/Unknown codec 'wavpack'/);
    });
  });

  describe('resolved metadata', () => {
    it('includes correct extension, format, and type from CODEC_METADATA', () => {
      const result = resolveCodecPreferences({ lossy: ['aac'] }, ipodCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.metadata.extension).toBe('.m4a');
      expect(result.lossy.metadata.ffmpegFormat).toBe('ipod');
      expect(result.lossy.metadata.container).toBe('M4A');
      expect(result.lossy.metadata.type).toBe('lossy');
      expect(result.lossy.metadata.sampleRate).toBe(44100);
    });

    it('includes correct metadata for opus', () => {
      const result = resolveCodecPreferences({ lossy: ['opus'] }, rockboxCodecs, allEncoders);

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.metadata.extension).toBe('.opus');
      expect(result.lossy.metadata.ffmpegFormat).toBe('ogg');
      expect(result.lossy.metadata.sampleRate).toBe(48000);
    });
  });

  describe('lossless does not error when no codec matches', () => {
    it('returns empty lossless array when no lossless codec is supported', () => {
      const result = resolveCodecPreferences(
        { lossy: ['mp3'], lossless: ['flac'] },
        ['mp3'], // device only supports mp3, no lossless
        allEncoders
      );

      expect(isCodecResolutionError(result)).toBe(false);
      if (isCodecResolutionError(result)) return;

      expect(result.lossy.codec).toBe('mp3');
      expect(result.lossless).toEqual([]);
    });
  });
});

describe('isCodecResolutionError', () => {
  it('returns true for error objects', () => {
    const error = {
      type: 'no-compatible-codec' as const,
      stack: 'lossy' as const,
      preferred: ['opus'],
      deviceSupported: ['aac'],
    };
    expect(isCodecResolutionError(error)).toBe(true);
  });

  it('returns false for success objects', () => {
    const result = resolveCodecPreferences(undefined, rockboxCodecs, allEncoders);
    expect(isCodecResolutionError(result)).toBe(false);
  });
});
