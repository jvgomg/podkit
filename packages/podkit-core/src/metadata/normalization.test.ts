import { describe, expect, it } from 'bun:test';
import {
  replayGainToSoundcheck,
  soundcheckToReplayGainDb,
  iTunNORMToSoundcheck,
  extractNormalization,
  normalizationToDb,
  normalizationToSoundcheck,
} from './normalization.js';
import type { AudioNormalization } from './normalization.js';
import type { IAudioMetadata } from 'music-metadata';

describe('replayGainToSoundcheck', () => {
  it('converts 0 dB to 1000 (unity gain)', () => {
    expect(replayGainToSoundcheck(0)).toBe(1000);
  });

  it('converts negative gain (loud track) to value > 1000', () => {
    // -6 dB → 1000 * 10^(6/10) ≈ 3981
    const result = replayGainToSoundcheck(-6);
    expect(result).toBeGreaterThan(1000);
    expect(result).toBe(Math.round(1000 * Math.pow(10, 6 / 10)));
  });

  it('converts positive gain (quiet track) to value < 1000', () => {
    // +6 dB → 1000 * 10^(-6/10) ≈ 251
    const result = replayGainToSoundcheck(6);
    expect(result).toBeLessThan(1000);
    expect(result).toBe(Math.round(1000 * Math.pow(10, -6 / 10)));
  });

  it('handles typical ReplayGain values', () => {
    // -7.5 dB (fairly loud track)
    expect(replayGainToSoundcheck(-7.5)).toBe(Math.round(1000 * Math.pow(10, 7.5 / 10)));
    // +3.2 dB (quiet track)
    expect(replayGainToSoundcheck(3.2)).toBe(Math.round(1000 * Math.pow(10, -3.2 / 10)));
  });
});

describe('soundcheckToReplayGainDb', () => {
  it('converts 1000 to 0 dB (unity gain)', () => {
    expect(soundcheckToReplayGainDb(1000)).toBeCloseTo(0, 10);
  });

  it('converts value > 1000 to negative dB (loud track)', () => {
    const result = soundcheckToReplayGainDb(3981);
    expect(result).toBeLessThan(0);
    expect(result).toBeCloseTo(-6, 1);
  });

  it('converts value < 1000 to positive dB (quiet track)', () => {
    const result = soundcheckToReplayGainDb(251);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(6, 1);
  });

  it('round-trips with replayGainToSoundcheck', () => {
    const gains = [-12.5, -7.5, -3.0, 0, 3.2, 6.0];
    for (const gain of gains) {
      const soundcheck = replayGainToSoundcheck(gain);
      const roundTripped = soundcheckToReplayGainDb(soundcheck);
      // Integer rounding in soundcheck introduces sub-0.01 dB error
      expect(roundTripped).toBeCloseTo(gain, 1);
    }
  });
});

describe('iTunNORMToSoundcheck', () => {
  it('parses standard iTunNORM string', () => {
    const norm =
      ' 00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000';
    const result = iTunNORMToSoundcheck(norm);
    expect(result).toBe(0x0a2b); // 2603
  });

  it('takes the max of left and right channels', () => {
    const norm =
      ' 00000100 00000200 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000';
    const result = iTunNORMToSoundcheck(norm);
    expect(result).toBe(0x200); // 512 (right channel is higher)
  });

  it('returns null for empty string', () => {
    expect(iTunNORMToSoundcheck('')).toBeNull();
  });

  it('returns null for invalid hex values', () => {
    expect(iTunNORMToSoundcheck('ZZZZZZZZ ZZZZZZZZ')).toBeNull();
  });

  it('returns null for string with fewer than 2 fields', () => {
    expect(iTunNORMToSoundcheck('00000A2B')).toBeNull();
  });

  it('handles no leading space', () => {
    const norm =
      '00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000';
    const result = iTunNORMToSoundcheck(norm);
    expect(result).toBe(0x0a2b);
  });
});

describe('extractNormalization', () => {
  function makeMetadata(
    overrides: { common?: Record<string, unknown>; native?: IAudioMetadata['native'] } = {}
  ): IAudioMetadata {
    return {
      format: {
        tagTypes: [],
      },
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        movementIndex: { no: null, of: null },
        ...overrides.common,
      },
      native: overrides.native ?? {},
      quality: { warnings: [] },
    } as unknown as IAudioMetadata;
  }

  it('returns null when no normalization data present', () => {
    const metadata = makeMetadata();
    expect(extractNormalization(metadata)).toBeNull();
  });

  it('extracts from ReplayGain track gain with rich type', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -6, ratio: 0.251 },
        replaygain_track_peak: { ratio: 0.251 },
        replaygain_album_gain: { dB: -8, ratio: 0.158 },
        replaygain_album_peak: { ratio: 0.95 },
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'replaygain-track',
      trackGain: -6,
      trackPeak: 0.251,
      albumGain: -8,
      albumPeak: 0.95,
      soundcheckValue: replayGainToSoundcheck(-6),
    });
  });

  it('falls back to ReplayGain album gain', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_album_gain: { dB: -4, ratio: 0.398 },
        replaygain_album_peak: { ratio: 0.398 },
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'replaygain-album',
      trackGain: -4,
      trackPeak: 0.398,
      albumGain: -4,
      albumPeak: 0.398,
      soundcheckValue: replayGainToSoundcheck(-4),
    });
  });

  it('prefers iTunNORM over ReplayGain', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -6, ratio: 0.251 },
      },
      native: {
        'ID3v2.3': [
          {
            id: 'TXXX:iTunNORM',
            value:
              ' 00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000',
          },
        ],
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'itunes-soundcheck',
      soundcheckValue: 0x0a2b,
      trackGain: soundcheckToReplayGainDb(0x0a2b),
    });
  });

  it('extracts iTunNORM from MP4 tags', () => {
    const metadata = makeMetadata({
      native: {
        iTunes: [
          {
            id: '----:com.apple.iTunes:iTunNORM',
            value:
              ' 00000500 00000600 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000',
          },
        ],
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'itunes-soundcheck',
      soundcheckValue: 0x600,
      trackGain: soundcheckToReplayGainDb(0x600),
    });
  });

  it('prefers track gain over album gain', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -3, ratio: 0.5 },
        replaygain_track_peak: { ratio: 0.5 },
        replaygain_album_gain: { dB: -8, ratio: 0.158 },
        replaygain_album_peak: { ratio: 0.9 },
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'replaygain-track',
      trackGain: -3,
      trackPeak: 0.5,
      albumGain: -8,
      albumPeak: 0.9,
      soundcheckValue: replayGainToSoundcheck(-3),
    });
  });

  it('extracts album gain alongside track gain', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -5, ratio: 0.316 },
        replaygain_track_peak: { ratio: 0.92 },
        replaygain_album_gain: { dB: -7, ratio: 0.2 },
        replaygain_album_peak: { ratio: 0.98 },
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'replaygain-track',
      trackGain: -5,
      trackPeak: 0.92,
      albumGain: -7,
      albumPeak: 0.98,
      soundcheckValue: replayGainToSoundcheck(-5),
    });
  });

  it('omits trackPeak when not available', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -6, ratio: 0.251 },
      },
    });
    const result = extractNormalization(metadata);
    expect(result).toEqual({
      source: 'replaygain-track',
      trackGain: -6,
      trackPeak: undefined,
      albumGain: undefined,
      albumPeak: undefined,
      soundcheckValue: replayGainToSoundcheck(-6),
    });
  });
});

describe('normalizationToDb', () => {
  it('returns trackGain when available', () => {
    const norm: AudioNormalization = {
      source: 'replaygain-track',
      trackGain: -7.5,
      soundcheckValue: replayGainToSoundcheck(-7.5),
    };
    expect(normalizationToDb(norm)).toBe(-7.5);
  });

  it('back-converts from soundcheckValue when trackGain is missing', () => {
    const norm: AudioNormalization = {
      source: 'itunes-soundcheck',
      soundcheckValue: 1000,
    };
    expect(normalizationToDb(norm)).toBeCloseTo(0, 10);
  });

  it('returns undefined when neither field is present', () => {
    const norm: AudioNormalization = {
      source: 'replaygain-track',
    };
    expect(normalizationToDb(norm)).toBeUndefined();
  });
});

describe('normalizationToSoundcheck', () => {
  it('returns soundcheckValue when available', () => {
    const norm: AudioNormalization = {
      source: 'itunes-soundcheck',
      soundcheckValue: 2603,
    };
    expect(normalizationToSoundcheck(norm)).toBe(2603);
  });

  it('converts from trackGain when soundcheckValue is missing', () => {
    const norm: AudioNormalization = {
      source: 'replaygain-track',
      trackGain: -6,
    };
    expect(normalizationToSoundcheck(norm)).toBe(replayGainToSoundcheck(-6));
  });

  it('returns undefined when neither field is present', () => {
    const norm: AudioNormalization = {
      source: 'replaygain-track',
    };
    expect(normalizationToSoundcheck(norm)).toBeUndefined();
  });
});
