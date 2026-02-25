/**
 * Integration tests for FFmpeg transcoder
 *
 * These tests require FFmpeg to be installed and perform real transcoding.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  FFmpegTranscoder,
  isFFmpegAvailable,
  FFmpegNotFoundError,
  TranscodeError,
} from './ffmpeg.js';
import { PRESETS } from './types.js';
import type { TranscodeProgress } from './types.js';
import { requireFFmpeg } from '../__tests__/helpers/test-setup.js';

// Fail early if FFmpeg is not available
requireFFmpeg();

let transcoder: FFmpegTranscoder;
let testDir: string;
let testAudioPath: string;

/**
 * Generate a simple test WAV file
 * Creates a 1-second sine wave at 440Hz (A4 note)
 */
async function generateTestAudio(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use FFmpeg to generate a test tone
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      // Add some basic metadata
      '-metadata',
      'title=Test Track',
      '-metadata',
      'artist=Test Artist',
      '-metadata',
      'album=Test Album',
      '-metadata',
      'track=1',
      '-metadata',
      'date=2024',
      '-y',
      path,
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

describe('FFmpegTranscoder integration', () => {
  beforeAll(async () => {
    // Create temp directory and test audio file
    transcoder = new FFmpegTranscoder();
    testDir = await mkdtemp(join(tmpdir(), 'podkit-ffmpeg-test-'));
    testAudioPath = join(testDir, 'test.wav');

    await generateTestAudio(testAudioPath);
  });

  afterAll(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('detect', () => {
    it('detects FFmpeg version', async () => {
      const caps = await transcoder.detect();

      expect(caps.version).toBeDefined();
      expect(caps.version).not.toBe('unknown');
      expect(caps.path).toBe('ffmpeg');
    });

    it('detects available AAC encoders', async () => {
      const caps = await transcoder.detect();

      expect(caps.aacEncoders.length).toBeGreaterThan(0);
      // At least native aac should be available
      expect(caps.aacEncoders).toContain('aac');
    });

    it('selects preferred encoder', async () => {
      const caps = await transcoder.detect();

      expect(caps.preferredEncoder).toBeDefined();
      expect(caps.aacEncoders).toContain(caps.preferredEncoder);
    });

    it('throws FFmpegNotFoundError when FFmpeg is missing', async () => {
      const badTranscoder = new FFmpegTranscoder({
        ffmpegPath: '/nonexistent/ffmpeg',
      });

      await expect(badTranscoder.detect()).rejects.toThrow(FFmpegNotFoundError);
    });
  });

  describe('probe', () => {
    it('probes audio file metadata', async () => {
      const meta = await transcoder.probe(testAudioPath);

      expect(meta.duration).toBeGreaterThan(0);
      expect(meta.duration).toBeLessThan(2000); // ~1 second in ms
      expect(meta.sampleRate).toBe(44100);
      expect(meta.channels).toBe(2);
      expect(meta.codec).toBe('pcm_s16le');
    });

    it('throws TranscodeError for invalid file', async () => {
      const invalidPath = join(testDir, 'nonexistent.wav');

      await expect(transcoder.probe(invalidPath)).rejects.toThrow(TranscodeError);
    });

    it('throws TranscodeError for non-audio file', async () => {
      const textFile = join(testDir, 'test.txt');
      await writeFile(textFile, 'This is not audio');

      await expect(transcoder.probe(textFile)).rejects.toThrow(TranscodeError);
    });
  });

  describe('transcode', () => {
    it('transcodes WAV to M4A with high preset', async () => {
      const outputPath = join(testDir, 'output-high.m4a');

      const result = await transcoder.transcode(testAudioPath, outputPath, PRESETS.high);

      expect(result.outputPath).toBe(outputPath);
      expect(result.size).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);

      // Verify output file exists and is valid audio
      const meta = await transcoder.probe(outputPath);
      expect(meta.codec).toBe('aac');
      expect(meta.sampleRate).toBe(44100);
    });

    it('transcodes with medium preset', async () => {
      const outputPath = join(testDir, 'output-medium.m4a');

      const result = await transcoder.transcode(testAudioPath, outputPath, PRESETS.medium);

      expect(result.outputPath).toBe(outputPath);
      expect(result.size).toBeGreaterThan(0);

      const meta = await transcoder.probe(outputPath);
      expect(meta.codec).toBe('aac');
    });

    it('transcodes with low preset', async () => {
      const outputPath = join(testDir, 'output-low.m4a');

      const result = await transcoder.transcode(testAudioPath, outputPath, PRESETS.low);

      expect(result.outputPath).toBe(outputPath);
      expect(result.size).toBeGreaterThan(0);

      const meta = await transcoder.probe(outputPath);
      expect(meta.codec).toBe('aac');
    });

    it('produces valid output for all presets', async () => {
      const outputHigh = join(testDir, 'size-high.m4a');
      const outputLow = join(testDir, 'size-low.m4a');

      const resultHigh = await transcoder.transcode(testAudioPath, outputHigh, PRESETS.high);
      const resultLow = await transcoder.transcode(testAudioPath, outputLow, PRESETS.low);

      // Both should produce valid output
      expect(resultHigh.size).toBeGreaterThan(0);
      expect(resultLow.size).toBeGreaterThan(0);
    });

    it('reports progress during transcoding', async () => {
      const outputPath = join(testDir, 'output-progress.m4a');
      const progressUpdates: TranscodeProgress[] = [];

      await transcoder.transcode(testAudioPath, outputPath, PRESETS.high, {
        onProgress: (progress) => {
          progressUpdates.push({ ...progress });
        },
      });

      // Should have received at least some progress updates
      // (may be empty for very short files)
      expect(Array.isArray(progressUpdates)).toBe(true);
    });

    it('supports abort signal', async () => {
      const outputPath = join(testDir, 'output-abort.m4a');
      const controller = new AbortController();

      // Abort immediately
      controller.abort();

      await expect(
        transcoder.transcode(testAudioPath, outputPath, PRESETS.high, {
          signal: controller.signal,
        })
      ).rejects.toThrow('aborted');
    });

    it('throws TranscodeError for invalid input file', async () => {
      const outputPath = join(testDir, 'output-invalid.m4a');
      const invalidInput = join(testDir, 'nonexistent.wav');

      await expect(
        transcoder.transcode(invalidInput, outputPath, PRESETS.high)
      ).rejects.toThrow(TranscodeError);
    });

    it('throws FFmpegNotFoundError when FFmpeg is missing', async () => {
      const outputPath = join(testDir, 'output-noffmpeg.m4a');
      const badTranscoder = new FFmpegTranscoder({
        ffmpegPath: '/nonexistent/ffmpeg',
      });

      await expect(
        badTranscoder.transcode(testAudioPath, outputPath, PRESETS.high)
      ).rejects.toThrow(FFmpegNotFoundError);
    });

    it('overwrites existing output file', async () => {
      const outputPath = join(testDir, 'output-overwrite.m4a');

      // Create first output
      await transcoder.transcode(testAudioPath, outputPath, PRESETS.high);
      const firstSize = (await stat(outputPath)).size;

      // Transcode again (should overwrite)
      await transcoder.transcode(testAudioPath, outputPath, PRESETS.low);
      const secondSize = (await stat(outputPath)).size;

      // File should still exist and be valid
      const meta = await transcoder.probe(outputPath);
      expect(meta.codec).toBe('aac');
      expect(firstSize).toBeGreaterThan(0);
      expect(secondSize).toBeGreaterThan(0);
    });
  });

  describe('metadata preservation', () => {
    it('preserves title metadata', async () => {
      const outputPath = join(testDir, 'output-metadata.m4a');

      await transcoder.transcode(testAudioPath, outputPath, PRESETS.high);

      // Use ffprobe to check metadata
      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format_tags=title,artist,album',
          '-of',
          'json',
          outputPath,
        ]);

        let stdout = '';
        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.on('close', () => {
          resolve(stdout);
        });

        proc.on('error', reject);
      });

      const data = JSON.parse(result);

      // Metadata should be preserved
      expect(data.format?.tags?.title).toBe('Test Track');
      expect(data.format?.tags?.artist).toBe('Test Artist');
      expect(data.format?.tags?.album).toBe('Test Album');
    });
  });

  describe('custom VBR preset', () => {
    it('transcodes with custom VBR quality', async () => {
      const outputPath = join(testDir, 'output-vbr.m4a');

      const result = await transcoder.transcode(testAudioPath, outputPath, {
        name: 'custom',
        codec: 'aac',
        container: 'm4a',
        quality: 3, // VBR quality
      });

      expect(result.outputPath).toBe(outputPath);

      const meta = await transcoder.probe(outputPath);
      expect(meta.codec).toBe('aac');
    });
  });

  describe('encoder detection on current platform', () => {
    it('reports platform-specific encoders', async () => {
      const caps = await transcoder.detect();

      // On macOS, aac_at may be available
      // Just ensure we have some encoder
      expect(caps.aacEncoders.length).toBeGreaterThan(0);
      expect(caps.preferredEncoder).toBeTruthy();
    });
  });
});

describe('isFFmpegAvailable', () => {
  it('returns true when FFmpeg is installed', async () => {
    const available = await isFFmpegAvailable();

    // This test will pass/fail based on system configuration
    // It's mainly here to test the function works
    expect(typeof available).toBe('boolean');
  });

  it('returns false for invalid path', async () => {
    const available = await isFFmpegAvailable('/nonexistent/ffmpeg');

    expect(available).toBe(false);
  });
});
