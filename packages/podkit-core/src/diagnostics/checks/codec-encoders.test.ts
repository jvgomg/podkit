/**
 * Unit tests for codec encoder availability diagnostic check
 *
 * Tests the pure checkEncoderAvailability function with injected capabilities,
 * avoiding the need for a real FFmpeg installation.
 */

import { describe, it, expect } from 'bun:test';
import { checkEncoderAvailability, codecEncodersCheck } from './codec-encoders.js';
import type { TranscoderCapabilities } from '../../transcode/types.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCapabilities(
  available: Partial<Record<TranscodeTargetCodec, string>>
): TranscoderCapabilities {
  return {
    version: '6.0',
    path: '/usr/bin/ffmpeg',
    aacEncoders: available.aac ? [available.aac] : [],
    preferredEncoder: available.aac ?? 'aac',
    encoders: {
      aac: available.aac ? [available.aac] : [],
      opus: available.opus ? [available.opus] : [],
      mp3: available.mp3 ? [available.mp3] : [],
      flac: available.flac ? [available.flac] : [],
      alac: available.alac ? [available.alac] : [],
    },
    preferredEncoders: {
      aac: available.aac,
      opus: available.opus,
      mp3: available.mp3,
      flac: available.flac,
      alac: available.alac,
    },
  };
}

/** Full capabilities — all encoders present */
const ALL_AVAILABLE = makeCapabilities({
  aac: 'aac',
  opus: 'libopus',
  mp3: 'libmp3lame',
  flac: 'flac',
  alac: 'alac',
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('codecEncodersCheck', () => {
  it('should have correct metadata', () => {
    expect(codecEncodersCheck.id).toBe('codec-encoders');
    expect(codecEncodersCheck.name).toBe('Codec Encoders');
    expect(codecEncodersCheck.applicableTo).toEqual(['ipod', 'mass-storage']);
    expect(codecEncodersCheck.repair).toBeUndefined();
  });
});

describe('checkEncoderAvailability', () => {
  it('should pass when all encoders are available', () => {
    const result = checkEncoderAvailability(ALL_AVAILABLE);

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('encoder');
    expect(result.repairable).toBe(false);
    expect(result.details?.checkedCodecs).toBeDefined();
  });

  it('should warn when libopus is missing', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      mp3: 'libmp3lame',
      flac: 'flac',
      alac: 'alac',
      // opus: missing
    });

    const result = checkEncoderAvailability(caps);

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('Opus');
    expect(result.repairable).toBe(false);
    expect(result.details?.missingCodecs).toEqual(['opus']);
  });

  it('should warn when libmp3lame is missing', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      opus: 'libopus',
      flac: 'flac',
      alac: 'alac',
      // mp3: missing
    });

    // Use a stack that includes mp3
    const result = checkEncoderAvailability(caps, ['aac', 'mp3'], ['source', 'flac', 'alac']);

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('MP3');
    expect(result.details?.missingCodecs).toEqual(['mp3']);
  });

  it('should list all missing encoders when multiple are absent', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      flac: 'flac',
      alac: 'alac',
      // opus and mp3 missing
    });

    const result = checkEncoderAvailability(caps, ['opus', 'aac', 'mp3'], ['source', 'flac']);

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('Opus');
    expect(result.summary).toContain('MP3');
    expect(result.details?.missingCodecs).toEqual(['opus', 'mp3']);
    expect(result.details?.repairAdvice as string).toContain('OPUS');
    expect(result.details?.repairAdvice as string).toContain('MP3');
  });

  it('should only check codecs in the preference stacks', () => {
    // Caps missing opus, but opus is not in the stacks
    const caps = makeCapabilities({
      aac: 'aac',
      mp3: 'libmp3lame',
      flac: 'flac',
      alac: 'alac',
      // opus: missing
    });

    // Stacks that don't include opus
    const result = checkEncoderAvailability(caps, ['aac', 'mp3'], ['source', 'alac']);

    expect(result.status).toBe('pass');
    // opus should not be in checked codecs
    expect(result.details?.checkedCodecs).not.toContain('opus');
  });

  it('should exclude source from lossless stack', () => {
    const result = checkEncoderAvailability(ALL_AVAILABLE, ['aac'], ['source', 'flac']);

    expect(result.status).toBe('pass');
    // 'source' should not appear in checkedCodecs
    const checked = result.details?.checkedCodecs as string[];
    expect(checked).not.toContain('source');
    expect(checked).toContain('aac');
    expect(checked).toContain('flac');
  });

  it('should deduplicate codecs across stacks', () => {
    // alac appears in both lossy and lossless stacks (hypothetical config)
    const result = checkEncoderAvailability(ALL_AVAILABLE, ['aac'], ['alac']);

    const checked = result.details?.checkedCodecs as string[];
    // alac should appear once
    expect(checked.filter((c: string) => c === 'alac')).toHaveLength(1);
  });

  it('should include repair advice with platform-specific instructions', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      flac: 'flac',
      alac: 'alac',
    });

    const result = checkEncoderAvailability(caps, ['opus', 'aac', 'mp3'], ['source', 'flac']);

    expect(result.status).toBe('warn');
    const advice = result.details?.repairAdvice as string;
    expect(advice).toContain('brew');
    expect(advice).toContain('apt');
    expect(advice).toContain('apk');
  });

  it('should warn about broken FFmpeg for built-in encoders', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      opus: 'libopus',
      mp3: 'libmp3lame',
      // flac: missing (built-in!)
      alac: 'alac',
    });

    const result = checkEncoderAvailability(caps, ['aac'], ['source', 'flac']);

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('FLAC');
    const advice = result.details?.repairAdvice as string;
    expect(advice).toContain('built-in');
    expect(advice).toContain('reinstall');
  });
});
