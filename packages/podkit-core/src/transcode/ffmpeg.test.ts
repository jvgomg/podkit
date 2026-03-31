/**
 * Unit tests for FFmpeg transcoder
 *
 * Tests command generation, argument building, and progress parsing.
 * Does not require FFmpeg to be installed.
 */

import { describe, expect, it } from 'bun:test';
import {
  FFmpegTranscoder,
  createFFmpegTranscoder,
  buildTranscodeArgs,
  buildAlacArgs,
  buildVbrArgs,
  buildOptimizedCopyArgs,
  buildOpusArgs,
  buildMp3Args,
  buildFlacArgs,
  FFmpegNotFoundError,
  TranscodeError,
} from './ffmpeg.js';
import type { EncoderConfig, OptimizedCopyFormat } from './ffmpeg.js';
import { AAC_PRESETS } from './types.js';
import { parseFFmpegProgressLine } from './progress.js';

describe('buildVbrArgs', () => {
  describe('native aac encoder', () => {
    it('generates -q:a argument for quality 5', () => {
      const args = buildVbrArgs('aac', 5);
      expect(args).toEqual(['-q:a', '5']);
    });

    it('generates -q:a argument for quality 2', () => {
      const args = buildVbrArgs('aac', 2);
      expect(args).toEqual(['-q:a', '2']);
    });
  });

  describe('libfdk_aac encoder', () => {
    it('generates -vbr and -cutoff arguments', () => {
      const args = buildVbrArgs('libfdk_aac', 5);
      expect(args).toEqual(['-vbr', '5', '-cutoff', '18000']);
    });

    it('preserves quality level directly', () => {
      const args = buildVbrArgs('libfdk_aac', 3);
      expect(args).toEqual(['-vbr', '3', '-cutoff', '18000']);
    });
  });

  describe('aac_at encoder (macOS)', () => {
    it('maps quality level 5 to highest quality (q=0) without targetKbps', () => {
      // aac_at scale is inverted: 0 = highest, 14 = lowest
      const args = buildVbrArgs('aac_at', 5);
      expect(args).toEqual(['-q:a', '0']);
    });

    it('maps quality level 2 to q=6 without targetKbps', () => {
      const args = buildVbrArgs('aac_at', 2);
      expect(args).toEqual(['-q:a', '6']);
    });

    it('maps quality level 4 to q=4 without targetKbps', () => {
      const args = buildVbrArgs('aac_at', 4);
      expect(args).toEqual(['-q:a', '4']);
    });

    it('maps targetKbps 256 → q=2 (high)', () => {
      expect(buildVbrArgs('aac_at', 5, 256)).toEqual(['-q:a', '2']);
    });

    it('maps targetKbps 192 → q=4', () => {
      expect(buildVbrArgs('aac_at', 4, 192)).toEqual(['-q:a', '4']);
    });

    it('maps targetKbps 128 → q=6', () => {
      expect(buildVbrArgs('aac_at', 2, 128)).toEqual(['-q:a', '6']);
    });
  });

  describe('unknown encoder', () => {
    it('defaults to native aac behavior', () => {
      const args = buildVbrArgs('unknown_encoder', 5);
      expect(args).toEqual(['-q:a', '5']);
    });
  });
});

describe('buildTranscodeArgs', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.m4a';

  describe('VBR presets (by name)', () => {
    it('generates correct arguments for high preset (VBR)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-i');
      expect(args).toContain(input);
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).toContain('-q:a');
      expect(args).toContain('5');
      expect(args).toContain('-ar');
      expect(args).toContain('44100');
      expect(args).toContain('-map_metadata');
      expect(args).toContain('0');
      expect(args).toContain('-f');
      expect(args).toContain('ipod');
      expect(args).toContain('-y');
      expect(args).toContain(output);
    });

    it('generates correct arguments for medium preset (VBR)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'medium');

      expect(args).toContain('-q:a');
      expect(args).toContain('4');
    });

    it('generates correct arguments for low preset (VBR)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'low');

      expect(args).toContain('-q:a');
      expect(args).toContain('2');
    });

    it('resolves max preset to high VBR (quality 5, 256 kbps target)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'max');

      // max resolves to high internally
      expect(args).toContain('-q:a');
      expect(args).toContain('5');
    });
  });

  describe('CBR via EncoderConfig', () => {
    it('uses CBR arguments for high CBR config', () => {
      const config: EncoderConfig = { bitrateKbps: 256, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('256k');
      expect(args).not.toContain('-q:a');
    });

    it('uses CBR arguments for 320 kbps config', () => {
      const config: EncoderConfig = { bitrateKbps: 320, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('320k');
    });

    it('uses CBR arguments for 128 kbps config', () => {
      const config: EncoderConfig = { bitrateKbps: 128, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('128k');
    });
  });

  describe('VBR via EncoderConfig', () => {
    it('uses VBR arguments with quality and bitrate', () => {
      const config: EncoderConfig = {
        bitrateKbps: 256,
        encoding: 'vbr',
        quality: 5,
      };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-q:a');
      expect(args).toContain('5');
      expect(args).not.toContain('-b:a');
    });

    it('passes targetKbps to VBR args for aac_at encoder', () => {
      const config: EncoderConfig = {
        bitrateKbps: 192,
        encoding: 'vbr',
        quality: 4,
      };
      const args = buildTranscodeArgs(input, output, 'aac_at', config);

      // aac_at maps 192 kbps → q=4
      expect(args).toContain('-q:a');
      expect(args).toContain('4');
    });
  });

  describe('custom bitrate via EncoderConfig', () => {
    it('uses custom bitrate for CBR', () => {
      const config: EncoderConfig = { bitrateKbps: 200, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('200k');
    });

    it('uses custom bitrate for VBR with aac_at', () => {
      const config: EncoderConfig = {
        bitrateKbps: 200,
        encoding: 'vbr',
        quality: 4,
      };
      const args = buildTranscodeArgs(input, output, 'aac_at', config);

      // aac_at maps 200 kbps → q=4 (closest)
      expect(args).toContain('-q:a');
      expect(args).toContain('4');
    });
  });

  describe('VBR with different encoders', () => {
    it('uses VBR arguments with libfdk_aac', () => {
      const args = buildTranscodeArgs(input, output, 'libfdk_aac', 'medium');

      expect(args).toContain('-vbr');
      expect(args).toContain('4');
      expect(args).toContain('-cutoff');
      expect(args).toContain('18000');
    });
  });

  describe('metadata and artwork', () => {
    it('includes metadata mapping', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-map_metadata');
      expect(args).toContain('0');
    });

    it('strips artwork by default (fast mode)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
      expect(args).not.toContain('-disposition:v');
    });

    it('strips artwork in fast mode', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', { transferMode: 'fast' });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
      expect(args).not.toContain('-disposition:v');
    });

    it('strips artwork in optimized mode', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'optimized',
      });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
      expect(args).not.toContain('-disposition:v');
    });

    it('preserves artwork in portable mode', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'portable',
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).toContain('-disposition:v');
      expect(args).toContain('attached_pic');
      expect(args).not.toContain('-vn');
    });
  });

  describe('output format', () => {
    it('uses ipod container format', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });

    it('includes overwrite flag', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-y');
    });

    it('includes progress output', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-progress');
      expect(args).toContain('pipe:1');
    });
  });

  describe('argument order', () => {
    it('places input before output', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      const inputIndex = args.indexOf(input);
      const outputIndex = args.indexOf(output);

      expect(inputIndex).toBeLessThan(outputIndex);
    });

    it('places output at the end', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args[args.length - 1]).toBe(output);
    });
  });
});

describe('buildAlacArgs', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.m4a';

  it('generates ALAC arguments via buildTranscodeArgs with lossless', () => {
    const args = buildTranscodeArgs(input, output, 'aac', 'lossless');

    expect(args).toContain('-i');
    expect(args).toContain(input);
    expect(args).toContain('-c:a');
    expect(args).toContain('alac');
    expect(args).toContain('-ar');
    expect(args).toContain('44100');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
    expect(args).toContain(output);
  });

  it('generates ALAC arguments directly', () => {
    const args = buildAlacArgs(input, output);

    expect(args).toContain('-c:a');
    expect(args).toContain('alac');
    expect(args).toContain('-ar');
    expect(args).toContain('44100');
    expect(args).toContain('-map_metadata');
    expect(args).toContain('0');
  });

  it('strips artwork by default (fast mode)', () => {
    const args = buildAlacArgs(input, output);

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-disposition:v');
  });

  it('strips artwork in optimized mode', () => {
    const args = buildAlacArgs(input, output, { transferMode: 'optimized' });

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-disposition:v');
  });

  it('preserves artwork in portable mode', () => {
    const args = buildAlacArgs(input, output, { transferMode: 'portable' });

    expect(args).toContain('-c:v');
    expect(args).toContain('copy');
    expect(args).toContain('-disposition:v');
    expect(args).toContain('attached_pic');
    expect(args).not.toContain('-vn');
  });
});

describe('ReplayGain metadata injection', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.m4a';

  it('injects ReplayGain tags into AAC transcode args', () => {
    const args = buildTranscodeArgs(input, output, 'aac_at', 'high', {
      replayGain: { trackGain: -7.5, trackPeak: 0.988 },
    });
    expect(args).toContain('-metadata');
    const gainIdx = args.indexOf('REPLAYGAIN_TRACK_GAIN=-7.50 dB');
    const peakIdx = args.indexOf('REPLAYGAIN_TRACK_PEAK=0.988000');
    expect(gainIdx).toBeGreaterThan(-1);
    expect(peakIdx).toBeGreaterThan(-1);
    // Should come after -map_metadata 0
    const mapIdx = args.indexOf('-map_metadata');
    expect(gainIdx).toBeGreaterThan(mapIdx);
  });

  it('omits peak when not provided', () => {
    const args = buildTranscodeArgs(input, output, 'aac_at', 'high', {
      replayGain: { trackGain: -3.2 },
    });
    const gainIdx = args.indexOf('REPLAYGAIN_TRACK_GAIN=-3.20 dB');
    expect(gainIdx).toBeGreaterThan(-1);
    expect(args).not.toContain('REPLAYGAIN_TRACK_PEAK');
    // Verify no stray -metadata for peak
    const peakEntries = args.filter((a) => a.includes('REPLAYGAIN_TRACK_PEAK'));
    expect(peakEntries).toHaveLength(0);
  });

  it('does not inject ReplayGain when option is undefined', () => {
    const args = buildTranscodeArgs(input, output, 'aac_at', 'high');
    const rgEntries = args.filter((a) => a.includes('REPLAYGAIN'));
    expect(rgEntries).toHaveLength(0);
  });

  it('injects ReplayGain into Opus args', () => {
    const args = buildOpusArgs(
      input,
      output.replace('.m4a', '.ogg'),
      {
        codec: 'opus',
        bitrateKbps: 160,
        encoding: 'vbr',
      },
      {
        replayGain: { trackGain: -5.0 },
      }
    );
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-5.00 dB');
  });

  it('injects ReplayGain into MP3 args', () => {
    const args = buildMp3Args(
      input,
      output.replace('.m4a', '.mp3'),
      {
        codec: 'mp3',
        bitrateKbps: 256,
        encoding: 'vbr',
        quality: 0,
      },
      {
        replayGain: { trackGain: -8.3, trackPeak: 1.05 },
      }
    );
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-8.30 dB');
    expect(args).toContain('REPLAYGAIN_TRACK_PEAK=1.050000');
  });

  it('injects ReplayGain into FLAC args', () => {
    const args = buildFlacArgs(input, output.replace('.m4a', '.flac'), {
      replayGain: { trackGain: -4.0 },
    });
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-4.00 dB');
  });

  it('injects ReplayGain into ALAC args', () => {
    const args = buildAlacArgs(input, output, {
      replayGain: { trackGain: -6.0, trackPeak: 0.95 },
    });
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-6.00 dB');
    expect(args).toContain('REPLAYGAIN_TRACK_PEAK=0.950000');
  });

  it('injects ReplayGain into optimized copy args', () => {
    const args = buildOptimizedCopyArgs(input, output, 'm4a', {
      replayGain: { trackGain: -10.0 },
    });
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-10.00 dB');
  });

  it('injects album gain and peak into AAC transcode args', () => {
    const args = buildTranscodeArgs(input, output, 'aac_at', 'high', {
      replayGain: { trackGain: -7.5, trackPeak: 0.988, albumGain: -8.2, albumPeak: 0.995 },
    });
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-7.50 dB');
    expect(args).toContain('REPLAYGAIN_TRACK_PEAK=0.988000');
    expect(args).toContain('REPLAYGAIN_ALBUM_GAIN=-8.20 dB');
    expect(args).toContain('REPLAYGAIN_ALBUM_PEAK=0.995000');
  });

  it('omits album gain/peak when not provided', () => {
    const args = buildTranscodeArgs(input, output, 'aac_at', 'high', {
      replayGain: { trackGain: -3.2, trackPeak: 0.9 },
    });
    expect(args).toContain('REPLAYGAIN_TRACK_GAIN=-3.20 dB');
    const albumEntries = args.filter((a) => a.includes('REPLAYGAIN_ALBUM'));
    expect(albumEntries).toHaveLength(0);
  });

  it('injects album gain into Opus args', () => {
    const args = buildOpusArgs(
      input,
      output.replace('.m4a', '.ogg'),
      { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' },
      { replayGain: { trackGain: -5.0, albumGain: -6.0, albumPeak: 0.99 } }
    );
    expect(args).toContain('REPLAYGAIN_ALBUM_GAIN=-6.00 dB');
    expect(args).toContain('REPLAYGAIN_ALBUM_PEAK=0.990000');
  });

  it('injects album gain into optimized copy args', () => {
    const args = buildOptimizedCopyArgs(input, output, 'm4a', {
      replayGain: { trackGain: -10.0, albumGain: -9.5, albumPeak: 1.0 },
    });
    expect(args).toContain('REPLAYGAIN_ALBUM_GAIN=-9.50 dB');
    expect(args).toContain('REPLAYGAIN_ALBUM_PEAK=1.000000');
  });
});

describe('buildOptimizedCopyArgs', () => {
  const input = '/path/to/input.mp3';
  const output = '/path/to/output.mp3';

  describe('common arguments', () => {
    it.each(['alac', 'mp3', 'm4a'] as OptimizedCopyFormat[])(
      'includes stream copy and metadata for %s format',
      (format) => {
        const args = buildOptimizedCopyArgs(input, output, format);

        expect(args).toContain('-c:a');
        expect(args).toContain('copy');
        expect(args).toContain('-map_metadata');
        expect(args).toContain('0');
        expect(args).toContain('-vn');
        expect(args).toContain('-y');
        expect(args).toContain('-progress');
        expect(args).toContain('pipe:1');
      }
    );

    it.each(['alac', 'mp3', 'm4a'] as OptimizedCopyFormat[])(
      'places input before output for %s format',
      (format) => {
        const args = buildOptimizedCopyArgs(input, output, format);

        const inputIndex = args.indexOf(input);
        const outputIndex = args.indexOf(output);
        expect(inputIndex).toBeLessThan(outputIndex);
        expect(args[args.length - 1]).toBe(output);
      }
    );
  });

  describe('ALAC format', () => {
    it('uses ipod container format', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'alac');

      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });

    it('does not specify an audio encoder (stream copy only)', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'alac');

      // -c:a should be 'copy', not 'alac' or any encoder
      const codecIndex = args.indexOf('-c:a');
      expect(args[codecIndex + 1]).toBe('copy');
    });
  });

  describe('MP3 format', () => {
    it('uses mp3 container format (not ipod)', () => {
      const args = buildOptimizedCopyArgs('/in.mp3', '/out.mp3', 'mp3');

      expect(args).toContain('-f');
      expect(args).toContain('mp3');
      expect(args).not.toContain('ipod');
    });
  });

  describe('M4A format', () => {
    it('uses ipod container format', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a');

      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });
  });
});

describe('transfer mode × transcode path matrix', () => {
  const input = '/music/song.flac';
  const output = '/ipod/song.m4a';

  describe('FLAC → AAC (transcode)', () => {
    it.each(['fast', 'optimized'] as const)('%s mode strips artwork', (mode) => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', { transferMode: mode });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
    });

    it('portable mode preserves artwork', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', { transferMode: 'portable' });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).toContain('-disposition:v');
      expect(args).toContain('attached_pic');
      expect(args).not.toContain('-vn');
    });
  });

  describe('FLAC → ALAC (transcode)', () => {
    it.each(['fast', 'optimized'] as const)('%s mode strips artwork', (mode) => {
      const args = buildAlacArgs(input, output, { transferMode: mode });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
    });

    it('portable mode preserves artwork', () => {
      const args = buildAlacArgs(input, output, { transferMode: 'portable' });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).toContain('-disposition:v');
      expect(args).toContain('attached_pic');
      expect(args).not.toContain('-vn');
    });
  });

  describe('copy-format files (optimized mode uses buildOptimizedCopyArgs)', () => {
    it('ALAC → ALAC uses stream copy with ipod container', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'alac');

      expect(args).toContain('-c:a');
      expect(args).toContain('copy');
      expect(args).toContain('-vn');
      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });

    it('MP3 → MP3 uses stream copy with mp3 container (not ipod)', () => {
      const args = buildOptimizedCopyArgs('/in.mp3', '/out.mp3', 'mp3');

      expect(args).toContain('-c:a');
      expect(args).toContain('copy');
      expect(args).toContain('-vn');
      expect(args).toContain('-f');
      expect(args).toContain('mp3');
      expect(args).not.toContain('ipod');
    });

    it('M4A → M4A uses stream copy with ipod container', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a');

      expect(args).toContain('-c:a');
      expect(args).toContain('copy');
      expect(args).toContain('-vn');
      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });
  });
});

describe('artwork resize (embedded artwork devices)', () => {
  const input = '/music/song.flac';
  const output = '/device/song.m4a';

  describe('buildTranscodeArgs with artworkResize', () => {
    it('resizes artwork in fast mode when artworkResize is set', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'fast',
        artworkResize: 600,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(600,iw)':'min(600,ih)'");
      expect(args[filterIndex + 1]).toContain('force_original_aspect_ratio=decrease');
      expect(args).toContain('-disposition:v');
      expect(args).toContain('attached_pic');
      expect(args).not.toContain('-vn');
    });

    it('resizes artwork in optimized mode when artworkResize is set', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'optimized',
        artworkResize: 320,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(320,iw)':'min(320,ih)'");
      expect(args).not.toContain('-vn');
    });

    it('resizes artwork in portable mode when artworkResize is set (embedded device)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'portable',
        artworkResize: 600,
      });

      // artworkResize wins — device needs resized artwork regardless of mode
      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(600,iw)':'min(600,ih)'");
      expect(args).not.toContain('-vn');
    });

    it('preserves full-res artwork in portable mode when artworkResize is NOT set (database device)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'portable',
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).not.toContain('-filter:v');
      expect(args).not.toContain('-vn');
    });

    it('strips artwork when artworkResize is not set (default iPod behavior)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'fast',
      });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-filter:v');
    });

    it('strips artwork when artworkResize is 0', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', {
        transferMode: 'fast',
        artworkResize: 0,
      });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-filter:v');
    });
  });

  describe('buildAlacArgs with artworkResize', () => {
    it('resizes artwork in fast mode when artworkResize is set', () => {
      const args = buildAlacArgs(input, output, {
        transferMode: 'fast',
        artworkResize: 176,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(176,iw)':'min(176,ih)'");
      expect(args).not.toContain('-vn');
    });

    it('resizes artwork in optimized mode when artworkResize is set', () => {
      const args = buildAlacArgs(input, output, {
        transferMode: 'optimized',
        artworkResize: 320,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIdx = args.indexOf('-filter:v');
      expect(args[filterIdx + 1]).toContain('320');
      expect(args).not.toContain('-vn');
    });

    it('resizes artwork in portable mode when artworkResize is set (embedded device)', () => {
      const args = buildAlacArgs(input, output, {
        transferMode: 'portable',
        artworkResize: 176,
      });

      // artworkResize wins — device needs resized artwork regardless of mode
      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(176,iw)':'min(176,ih)'");
      expect(args).not.toContain('-vn');
    });

    it('preserves full-res artwork in portable mode when artworkResize is NOT set (database device)', () => {
      const args = buildAlacArgs(input, output, {
        transferMode: 'portable',
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).not.toContain('-filter:v');
      expect(args).not.toContain('-vn');
    });
  });

  describe('buildOptimizedCopyArgs with artworkResize', () => {
    it('resizes artwork instead of stripping when artworkResize is set', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a', {
        artworkResize: 600,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('mjpeg');
      expect(args).toContain('-filter:v');
      const filterIndex = args.indexOf('-filter:v');
      expect(args[filterIndex + 1]).toContain("scale='min(600,iw)':'min(600,ih)'");
      expect(args).toContain('-disposition:v');
      expect(args).toContain('attached_pic');
      expect(args).not.toContain('-vn');
    });

    it('strips artwork when artworkResize is not set (default behavior)', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a');

      expect(args).toContain('-vn');
      expect(args).not.toContain('-filter:v');
    });

    it('strips artwork when artworkResize is 0', () => {
      const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a', {
        artworkResize: 0,
      });

      expect(args).toContain('-vn');
      expect(args).not.toContain('-filter:v');
    });

    it('resizes artwork for MP3 format', () => {
      const args = buildOptimizedCopyArgs('/in.mp3', '/out.mp3', 'mp3', {
        artworkResize: 320,
      });

      expect(args).toContain('-filter:v');
      expect(args).not.toContain('-vn');
    });
  });
});

// =============================================================================
// Opus argument builder
// =============================================================================

describe('buildOpusArgs', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.opus';

  it('generates VBR args with correct codec, sample rate, bitrate, and format', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' };
    const args = buildOpusArgs(input, output, config);

    expect(args).toContain('-c:a');
    expect(args).toContain('libopus');
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
    expect(args).toContain('-b:a');
    expect(args).toContain('160k');
    expect(args).toContain('-vbr');
    expect(args).toContain('on');
    expect(args).toContain('-f');
    expect(args).toContain('ogg');
  });

  it('generates CBR args with -vbr off', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 128, encoding: 'cbr' };
    const args = buildOpusArgs(input, output, config);

    expect(args).toContain('-b:a');
    expect(args).toContain('128k');
    expect(args).toContain('-vbr');
    expect(args).toContain('off');
  });

  it('strips artwork by default (fast mode)', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' };
    const args = buildOpusArgs(input, output, config);

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
  });

  it('strips artwork when artworkResize is set (OGG cannot embed MJPEG)', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' };
    const args = buildOpusArgs(input, output, config, { artworkResize: 600 });

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('mjpeg');
  });

  it('strips artwork in portable mode (OGG cannot embed MJPEG)', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' };
    const args = buildOpusArgs(input, output, config, { transferMode: 'portable' });

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('copy');
  });
});

// =============================================================================
// MP3 argument builder
// =============================================================================

describe('buildMp3Args', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.mp3';

  it('generates VBR args with -q:a quality for high preset', () => {
    const config: EncoderConfig = { codec: 'mp3', bitrateKbps: 256, encoding: 'vbr', quality: 0 };
    const args = buildMp3Args(input, output, config);

    expect(args).toContain('-c:a');
    expect(args).toContain('libmp3lame');
    expect(args).toContain('-q:a');
    expect(args).toContain('0');
    expect(args).toContain('-ar');
    expect(args).toContain('44100');
    expect(args).toContain('-f');
    expect(args).toContain('mp3');
    expect(args).not.toContain('-b:a');
  });

  it('generates CBR args with -b:a bitrate', () => {
    const config: EncoderConfig = { codec: 'mp3', bitrateKbps: 256, encoding: 'cbr' };
    const args = buildMp3Args(input, output, config);

    expect(args).toContain('-c:a');
    expect(args).toContain('libmp3lame');
    expect(args).toContain('-b:a');
    expect(args).toContain('256k');
    expect(args).toContain('-f');
    expect(args).toContain('mp3');
    expect(args).not.toContain('-q:a');
  });

  it('uses 44100 Hz sample rate', () => {
    const config: EncoderConfig = { codec: 'mp3', bitrateKbps: 192, encoding: 'cbr' };
    const args = buildMp3Args(input, output, config);

    expect(args).toContain('-ar');
    expect(args).toContain('44100');
  });

  it('strips artwork by default', () => {
    const config: EncoderConfig = { codec: 'mp3', bitrateKbps: 192, encoding: 'vbr', quality: 2 };
    const args = buildMp3Args(input, output, config);

    expect(args).toContain('-vn');
  });
});

// =============================================================================
// FLAC argument builder
// =============================================================================

describe('buildFlacArgs', () => {
  const input = '/path/to/input.wav';
  const output = '/path/to/output.flac';

  it('generates correct FLAC args with codec and format', () => {
    const args = buildFlacArgs(input, output);

    expect(args).toContain('-c:a');
    expect(args).toContain('flac');
    expect(args).toContain('-f');
    expect(args).toContain('flac');
  });

  it('does not include bitrate or quality parameters', () => {
    const args = buildFlacArgs(input, output);

    expect(args).not.toContain('-b:a');
    expect(args).not.toContain('-q:a');
  });

  it('does not include -ar flag (preserves source sample rate)', () => {
    const args = buildFlacArgs(input, output);

    expect(args).not.toContain('-ar');
  });

  it('preserves metadata', () => {
    const args = buildFlacArgs(input, output);

    expect(args).toContain('-map_metadata');
    expect(args).toContain('0');
  });

  it('strips artwork by default', () => {
    const args = buildFlacArgs(input, output);

    expect(args).toContain('-vn');
  });

  it('resizes artwork when artworkResize is set (FLAC muxer converts to METADATA_BLOCK_PICTURE)', () => {
    const args = buildFlacArgs(input, output, { artworkResize: 320 });

    expect(args).toContain('-c:v');
    expect(args).toContain('mjpeg');
    expect(args).toContain('-filter:v');
    expect(args).not.toContain('-vn');
  });
});

// =============================================================================
// buildTranscodeArgs codec dispatch
// =============================================================================

describe('buildTranscodeArgs codec dispatch', () => {
  const input = '/path/to/input.flac';
  const output = '/path/to/output.file';

  it('dispatches to Opus builder when codec is opus', () => {
    const config: EncoderConfig = { codec: 'opus', bitrateKbps: 160, encoding: 'vbr' };
    const args = buildTranscodeArgs(input, output, 'libopus', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('libopus');
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
    expect(args).toContain('-f');
    expect(args).toContain('ogg');
  });

  it('dispatches to MP3 builder when codec is mp3', () => {
    const config: EncoderConfig = { codec: 'mp3', bitrateKbps: 256, encoding: 'cbr' };
    const args = buildTranscodeArgs(input, output, 'libmp3lame', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('libmp3lame');
    expect(args).toContain('-f');
    expect(args).toContain('mp3');
  });

  it('dispatches to FLAC builder when codec is flac', () => {
    const config: EncoderConfig = { codec: 'flac', bitrateKbps: 0, encoding: 'vbr' };
    const args = buildTranscodeArgs(input, output, 'flac', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('flac');
    expect(args).toContain('-f');
    expect(args).toContain('flac');
    expect(args).not.toContain('-ar');
  });

  it('dispatches to ALAC builder when codec is alac', () => {
    const config: EncoderConfig = { codec: 'alac', bitrateKbps: 0, encoding: 'vbr' };
    const args = buildTranscodeArgs(input, output, 'alac', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('alac');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
    expect(args).toContain('-ar');
    expect(args).toContain('44100');
  });

  it('uses AAC path when codec is aac', () => {
    const config: EncoderConfig = { codec: 'aac', bitrateKbps: 256, encoding: 'cbr' };
    const args = buildTranscodeArgs(input, output, 'aac', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-b:a');
    expect(args).toContain('256k');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });

  it('uses AAC path when EncoderConfig has no codec field (backward compat)', () => {
    const config: EncoderConfig = { bitrateKbps: 256, encoding: 'cbr' };
    const args = buildTranscodeArgs(input, output, 'aac', config);

    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-b:a');
    expect(args).toContain('256k');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });

  it('uses ALAC path when preset is lossless (unchanged)', () => {
    const args = buildTranscodeArgs(input, output, 'aac', 'lossless');

    expect(args).toContain('-c:a');
    expect(args).toContain('alac');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });

  it('uses AAC path when preset is a QualityPreset string (unchanged)', () => {
    const args = buildTranscodeArgs(input, output, 'aac', 'high');

    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-q:a');
    expect(args).toContain('5');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });
});

// =============================================================================
// buildOptimizedCopyArgs — new formats
// =============================================================================

describe('buildOptimizedCopyArgs — new formats', () => {
  it('uses -f ogg for opus format', () => {
    const args = buildOptimizedCopyArgs('/in.opus', '/out.opus', 'opus');

    expect(args).toContain('-f');
    expect(args).toContain('ogg');
    expect(args).not.toContain('ipod');
  });

  it('uses -f flac for flac format', () => {
    const args = buildOptimizedCopyArgs('/in.flac', '/out.flac', 'flac');

    expect(args).toContain('-f');
    expect(args).toContain('flac');
    expect(args).not.toContain('ipod');
  });

  it('uses -f mp3 for mp3 format', () => {
    const args = buildOptimizedCopyArgs('/in.mp3', '/out.mp3', 'mp3');

    expect(args).toContain('-f');
    expect(args).toContain('mp3');
    expect(args).not.toContain('ipod');
  });

  it('still uses -f ipod for alac format', () => {
    const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'alac');

    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });

  it('still uses -f ipod for m4a format', () => {
    const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a');

    expect(args).toContain('-f');
    expect(args).toContain('ipod');
  });

  it('strips artwork for opus even with artworkResize (OGG cannot embed MJPEG)', () => {
    const args = buildOptimizedCopyArgs('/in.opus', '/out.opus', 'opus', { artworkResize: 600 });

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('mjpeg');
  });

  it('resizes artwork for flac with artworkResize (FLAC muxer converts to METADATA_BLOCK_PICTURE)', () => {
    const args = buildOptimizedCopyArgs('/in.flac', '/out.flac', 'flac', { artworkResize: 320 });

    expect(args).toContain('-c:v');
    expect(args).toContain('mjpeg');
    expect(args).not.toContain('-vn');
  });

  it('still resizes artwork for m4a with artworkResize', () => {
    const args = buildOptimizedCopyArgs('/in.m4a', '/out.m4a', 'm4a', { artworkResize: 600 });

    expect(args).toContain('-c:v');
    expect(args).toContain('mjpeg');
    expect(args).not.toContain('-vn');
  });

  it('still resizes artwork for mp3 with artworkResize', () => {
    const args = buildOptimizedCopyArgs('/in.mp3', '/out.mp3', 'mp3', { artworkResize: 600 });

    expect(args).toContain('-c:v');
    expect(args).toContain('mjpeg');
    expect(args).not.toContain('-vn');
  });
});

describe('parseFFmpegProgressLine', () => {
  it('parses out_time_ms to seconds', () => {
    const result = parseFFmpegProgressLine('out_time_ms=5000000');

    expect(result).toEqual({ time: 5 });
  });

  it('handles zero time', () => {
    const result = parseFFmpegProgressLine('out_time_ms=0');

    expect(result).toEqual({ time: 0 });
  });

  it('handles large time values', () => {
    const result = parseFFmpegProgressLine('out_time_ms=180000000');

    expect(result).toEqual({ time: 180 }); // 3 minutes
  });

  it('returns null for progress=continue', () => {
    const result = parseFFmpegProgressLine('progress=continue');

    expect(result).toBeNull();
  });

  it('returns null for progress=end', () => {
    const result = parseFFmpegProgressLine('progress=end');

    expect(result).toBeNull();
  });

  it('parses bitrate to kbps', () => {
    const result = parseFFmpegProgressLine('bitrate=256.0kbits/s');

    expect(result).toEqual({ bitrate: 256 });
  });

  it('parses bitrate with rounding', () => {
    const result = parseFFmpegProgressLine('bitrate=128.7kbits/s');

    expect(result).toEqual({ bitrate: 129 });
  });

  it('returns null for unrecognized keys', () => {
    const result = parseFFmpegProgressLine('unknown_key=some_value');

    expect(result).toBeNull();
  });

  it('returns null for invalid format', () => {
    const result = parseFFmpegProgressLine('not a valid line');

    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseFFmpegProgressLine('');

    expect(result).toBeNull();
  });

  it('handles invalid out_time_ms value', () => {
    const result = parseFFmpegProgressLine('out_time_ms=invalid');

    expect(result).toBeNull();
  });
});

describe('FFmpegTranscoder', () => {
  describe('constructor', () => {
    it('creates instance with default paths', () => {
      const transcoder = new FFmpegTranscoder();

      expect(transcoder.getFFmpegPath()).toBe('ffmpeg');
      expect(transcoder.getFFprobePath()).toBe('ffprobe');
    });

    it('accepts custom FFmpeg path', () => {
      const transcoder = new FFmpegTranscoder({
        ffmpegPath: '/custom/path/ffmpeg',
      });

      expect(transcoder.getFFmpegPath()).toBe('/custom/path/ffmpeg');
    });

    it('accepts custom FFprobe path', () => {
      const transcoder = new FFmpegTranscoder({
        ffprobePath: '/custom/path/ffprobe',
      });

      expect(transcoder.getFFprobePath()).toBe('/custom/path/ffprobe');
    });

    it('accepts both custom paths', () => {
      const transcoder = new FFmpegTranscoder({
        ffmpegPath: '/custom/ffmpeg',
        ffprobePath: '/custom/ffprobe',
      });

      expect(transcoder.getFFmpegPath()).toBe('/custom/ffmpeg');
      expect(transcoder.getFFprobePath()).toBe('/custom/ffprobe');
    });
  });
});

describe('createFFmpegTranscoder', () => {
  it('creates FFmpegTranscoder instance', () => {
    const transcoder = createFFmpegTranscoder();

    expect(transcoder).toBeInstanceOf(FFmpegTranscoder);
  });

  it('passes config to constructor', () => {
    const transcoder = createFFmpegTranscoder({
      ffmpegPath: '/custom/ffmpeg',
    });

    expect(transcoder.getFFmpegPath()).toBe('/custom/ffmpeg');
  });
});

describe('FFmpegNotFoundError', () => {
  it('has correct name', () => {
    const error = new FFmpegNotFoundError();

    expect(error.name).toBe('FFmpegNotFoundError');
  });

  it('has default message', () => {
    const error = new FFmpegNotFoundError();

    expect(error.message).toBe('FFmpeg not found');
  });

  it('accepts custom message', () => {
    const error = new FFmpegNotFoundError('Custom message');

    expect(error.message).toBe('Custom message');
  });

  it('is instanceof Error', () => {
    const error = new FFmpegNotFoundError();

    expect(error).toBeInstanceOf(Error);
  });
});

describe('TranscodeError', () => {
  it('has correct name', () => {
    const error = new TranscodeError('Test error');

    expect(error.name).toBe('TranscodeError');
  });

  it('stores exit code', () => {
    const error = new TranscodeError('Test error', 1);

    expect(error.exitCode).toBe(1);
  });

  it('stores stderr', () => {
    const error = new TranscodeError('Test error', 1, 'Error output');

    expect(error.stderr).toBe('Error output');
  });

  it('is instanceof Error', () => {
    const error = new TranscodeError('Test error');

    expect(error).toBeInstanceOf(Error);
  });
});

describe('AAC_PRESETS', () => {
  it('has high preset with VBR quality 5 at 256 kbps', () => {
    expect(AAC_PRESETS.high).toEqual({
      mode: 'vbr',
      quality: 5,
      targetKbps: 256,
    });
  });

  it('has medium preset with VBR quality 4 at 192 kbps', () => {
    expect(AAC_PRESETS.medium).toEqual({
      mode: 'vbr',
      quality: 4,
      targetKbps: 192,
    });
  });

  it('has low preset with VBR quality 2 at 128 kbps', () => {
    expect(AAC_PRESETS.low).toEqual({
      mode: 'vbr',
      quality: 2,
      targetKbps: 128,
    });
  });

  it('has only 3 presets (high, medium, low)', () => {
    expect(Object.keys(AAC_PRESETS)).toEqual(['high', 'medium', 'low']);
  });
});
