import { describe, expect, it } from 'bun:test';
import {
  replayGainToSoundcheck,
  iTunNORMToSoundcheck,
  extractSoundcheck,
} from './soundcheck.js';
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

describe('iTunNORMToSoundcheck', () => {
  it('parses standard iTunNORM string', () => {
    const norm = ' 00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000';
    const result = iTunNORMToSoundcheck(norm);
    expect(result).toBe(0x0a2b); // 2603
  });

  it('takes the max of left and right channels', () => {
    const norm = ' 00000100 00000200 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000';
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
    const norm = '00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000';
    const result = iTunNORMToSoundcheck(norm);
    expect(result).toBe(0x0a2b);
  });
});

describe('extractSoundcheck', () => {
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
    expect(extractSoundcheck(metadata)).toBeNull();
  });

  it('extracts from ReplayGain track gain with source', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -6, ratio: 0.251 },
      },
    });
    const result = extractSoundcheck(metadata);
    expect(result).toEqual({ value: replayGainToSoundcheck(-6), source: 'replayGain_track' });
  });

  it('falls back to ReplayGain album gain with source', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_album_gain: { dB: -4, ratio: 0.398 },
      },
    });
    const result = extractSoundcheck(metadata);
    expect(result).toEqual({ value: replayGainToSoundcheck(-4), source: 'replayGain_album' });
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
            value: ' 00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000',
          },
        ],
      },
    });
    const result = extractSoundcheck(metadata);
    expect(result).toEqual({ value: 0x0a2b, source: 'iTunNORM' });
  });

  it('extracts iTunNORM from MP4 tags', () => {
    const metadata = makeMetadata({
      native: {
        'iTunes': [
          {
            id: '----:com.apple.iTunes:iTunNORM',
            value: ' 00000500 00000600 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000',
          },
        ],
      },
    });
    const result = extractSoundcheck(metadata);
    expect(result).toEqual({ value: 0x600, source: 'iTunNORM' });
  });

  it('prefers track gain over album gain', () => {
    const metadata = makeMetadata({
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        replaygain_track_gain: { dB: -3, ratio: 0.5 },
        replaygain_album_gain: { dB: -8, ratio: 0.158 },
      },
    });
    const result = extractSoundcheck(metadata);
    expect(result).toEqual({ value: replayGainToSoundcheck(-3), source: 'replayGain_track' });
  });
});
