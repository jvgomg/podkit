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
  FFmpegNotFoundError,
  TranscodeError,
} from './ffmpeg.js';
import type { AacTranscodeConfig } from './ffmpeg.js';
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

  describe('CBR via AacTranscodeConfig', () => {
    it('uses CBR arguments for high CBR config', () => {
      const config: AacTranscodeConfig = { bitrateKbps: 256, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('256k');
      expect(args).not.toContain('-q:a');
    });

    it('uses CBR arguments for 320 kbps config', () => {
      const config: AacTranscodeConfig = { bitrateKbps: 320, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('320k');
    });

    it('uses CBR arguments for 128 kbps config', () => {
      const config: AacTranscodeConfig = { bitrateKbps: 128, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('128k');
    });
  });

  describe('VBR via AacTranscodeConfig', () => {
    it('uses VBR arguments with quality and bitrate', () => {
      const config: AacTranscodeConfig = {
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
      const config: AacTranscodeConfig = {
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

  describe('custom bitrate via AacTranscodeConfig', () => {
    it('uses custom bitrate for CBR', () => {
      const config: AacTranscodeConfig = { bitrateKbps: 200, encoding: 'cbr' };
      const args = buildTranscodeArgs(input, output, 'aac', config);

      expect(args).toContain('-b:a');
      expect(args).toContain('200k');
    });

    it('uses custom bitrate for VBR with aac_at', () => {
      const config: AacTranscodeConfig = {
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

    it('strips artwork by default (optimized mode)', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high');

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
      expect(args).not.toContain('-disposition:v');
    });

    it('preserves artwork in portable mode', () => {
      const args = buildTranscodeArgs(input, output, 'aac', 'high', { fileMode: 'portable' });

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

  it('strips artwork by default (optimized mode)', () => {
    const args = buildAlacArgs(input, output);

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-disposition:v');
  });

  it('preserves artwork in portable mode', () => {
    const args = buildAlacArgs(input, output, { fileMode: 'portable' });

    expect(args).toContain('-c:v');
    expect(args).toContain('copy');
    expect(args).toContain('-disposition:v');
    expect(args).toContain('attached_pic');
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
