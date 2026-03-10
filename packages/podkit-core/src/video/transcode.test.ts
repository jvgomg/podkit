/**
 * Tests for video transcoder
 */

import { describe, it, expect } from 'bun:test';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { VideoTranscodeSettings } from './types.js';
import type { SpawnFn } from './transcode.js';
import {
  buildVideoTranscodeArgs,
  buildScaleFilter,
  parseVideoProgress,
  detectHardwareAcceleration,
  transcodeVideo,
  VideoTranscodeError,
} from './transcode.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const defaultSettings: VideoTranscodeSettings = {
  targetWidth: 640,
  targetHeight: 480,
  targetVideoBitrate: 2000,
  targetAudioBitrate: 128,
  videoProfile: 'main',
  videoLevel: '3.1',
  crf: 21,
  frameRate: 30,
  useHardwareAcceleration: false,
};

const baselineSettings: VideoTranscodeSettings = {
  targetWidth: 320,
  targetHeight: 240,
  targetVideoBitrate: 600,
  targetAudioBitrate: 128,
  videoProfile: 'baseline',
  videoLevel: '3.0',
  crf: 23,
  frameRate: 30,
  useHardwareAcceleration: false,
};

const hardwareSettings: VideoTranscodeSettings = {
  ...defaultSettings,
  useHardwareAcceleration: true,
};

// =============================================================================
// Mock Process Helpers
// =============================================================================

interface MockSpawnConfig {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
  /** Delay before emitting output (in ms) */
  delay?: number;
}

/**
 * Create a mock spawn function for a single command invocation
 */
function createMockSpawn(config: MockSpawnConfig): SpawnFn {
  return ((command: string, args: readonly string[], _options?: SpawnOptions): ChildProcess => {
    const stdoutStream = new EventEmitter();
    const stderrStream = new EventEmitter();
    const proc = new EventEmitter() as ChildProcess;

    // Assign stream properties
    (proc as unknown as Record<string, unknown>).stdout = stdoutStream;
    (proc as unknown as Record<string, unknown>).stderr = stderrStream;
    (proc as unknown as Record<string, unknown>).stdin = null;
    (proc as unknown as Record<string, unknown>).stdio = [
      null,
      stdoutStream,
      stderrStream,
      null,
      null,
    ];
    (proc as unknown as Record<string, unknown>).pid = 12345;
    (proc as unknown as Record<string, unknown>).killed = false;
    (proc as unknown as Record<string, unknown>).connected = false;
    (proc as unknown as Record<string, unknown>).exitCode = null;
    (proc as unknown as Record<string, unknown>).signalCode = null;
    (proc as unknown as Record<string, unknown>).spawnargs = [command, ...args];
    (proc as unknown as Record<string, unknown>).spawnfile = command;
    (proc as unknown as Record<string, unknown>).kill = (_signal?: NodeJS.Signals) => {
      (proc as unknown as Record<string, unknown>).killed = true;
      return true;
    };

    const emitOutput = () => {
      if (config.error) {
        proc.emit('error', config.error);
        return;
      }

      if (config.stdout) {
        stdoutStream.emit('data', Buffer.from(config.stdout));
      }

      if (config.stderr) {
        stderrStream.emit('data', Buffer.from(config.stderr));
      }

      proc.emit('close', config.exitCode ?? 0);
    };

    if (config.delay) {
      setTimeout(emitOutput, config.delay);
    } else {
      process.nextTick(emitOutput);
    }

    return proc;
  }) as SpawnFn;
}

/**
 * Create a mock spawn that handles multiple commands differently
 */
function createMultiMockSpawn(handlers: Record<string, MockSpawnConfig>): SpawnFn {
  return ((command: string, args: readonly string[], options?: SpawnOptions): ChildProcess => {
    const config = handlers[command] ?? { exitCode: 0 };
    const innerSpawn = createMockSpawn(config);
    return innerSpawn(command, args, options ?? {});
  }) as SpawnFn;
}

// =============================================================================
// buildVideoTranscodeArgs Tests
// =============================================================================

describe('buildVideoTranscodeArgs', () => {
  it('builds correct args for iPod Classic profile (main)', () => {
    const args = buildVideoTranscodeArgs('/input.mkv', '/output.m4v', defaultSettings);

    // Input
    expect(args).toContain('-i');
    expect(args).toContain('/input.mkv');

    // Video codec (libx264)
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-profile:v');
    expect(args).toContain('main');
    expect(args).toContain('-level');
    expect(args).toContain('3.1');

    // Quality settings
    expect(args).toContain('-crf');
    expect(args).toContain('21');
    expect(args).toContain('-maxrate');
    expect(args).toContain('2000k');
    expect(args).toContain('-bufsize');
    expect(args).toContain('4000k'); // 2x maxrate

    // Frame rate
    expect(args).toContain('-r');
    expect(args).toContain('30');

    // Audio
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-b:a');
    expect(args).toContain('128k');
    expect(args).toContain('-ac');
    expect(args).toContain('2');

    // Output format
    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
    expect(args).toContain('-f');
    expect(args).toContain('ipod');
    expect(args).toContain('-y');

    // Output file
    expect(args[args.length - 1]).toBe('/output.m4v');
  });

  it('builds correct args for iPod Video profile (baseline)', () => {
    const args = buildVideoTranscodeArgs('/input.avi', '/output.m4v', baselineSettings);

    expect(args).toContain('-profile:v');
    expect(args).toContain('baseline');
    expect(args).toContain('-level');
    expect(args).toContain('3.0');
    expect(args).toContain('-crf');
    expect(args).toContain('23');
    expect(args).toContain('-maxrate');
    expect(args).toContain('600k');
  });

  it('builds correct args for hardware acceleration (VideoToolbox)', () => {
    const args = buildVideoTranscodeArgs('/input.mkv', '/output.m4v', hardwareSettings);

    // VideoToolbox encoder
    expect(args).toContain('-c:v');
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-profile:v');
    expect(args).toContain('main');
    expect(args).toContain('-b:v');
    expect(args).toContain('2000k');

    // Should NOT have CRF (not supported by VideoToolbox)
    expect(args).not.toContain('-crf');
    expect(args).not.toContain('-maxrate');
    expect(args).not.toContain('-bufsize');
  });

  it('includes scale filter', () => {
    const args = buildVideoTranscodeArgs('/input.mkv', '/output.m4v', defaultSettings);

    expect(args).toContain('-vf');
    const vfIndex = args.indexOf('-vf');
    const filterValue = args[vfIndex + 1];
    expect(filterValue).toContain('scale=640:480');
    expect(filterValue).toContain('force_original_aspect_ratio=decrease');
    expect(filterValue).toContain('pad=640:480');
  });

  it('includes progress output to stderr', () => {
    const args = buildVideoTranscodeArgs('/input.mkv', '/output.m4v', defaultSettings);

    expect(args).toContain('-progress');
    expect(args).toContain('pipe:2');
  });

  it('hides banner', () => {
    const args = buildVideoTranscodeArgs('/input.mkv', '/output.m4v', defaultSettings);

    expect(args).toContain('-hide_banner');
  });
});

// =============================================================================
// buildScaleFilter Tests
// =============================================================================

describe('buildScaleFilter', () => {
  it('builds scale filter for 640x480', () => {
    const filter = buildScaleFilter(640, 480);

    expect(filter).toBe(
      'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:-1:-1:black'
    );
  });

  it('builds scale filter for 320x240', () => {
    const filter = buildScaleFilter(320, 240);

    expect(filter).toBe(
      'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:-1:-1:black'
    );
  });
});

// =============================================================================
// parseVideoProgress Tests
// =============================================================================

describe('parseVideoProgress', () => {
  it('parses out_time_ms correctly', () => {
    const progress = parseVideoProgress('out_time_ms=5000000\n', 10);

    expect(progress).not.toBeNull();
    expect(progress?.time).toBe(5);
    expect(progress?.duration).toBe(10);
    expect(progress?.percent).toBe(50);
  });

  it('parses out_time fallback format', () => {
    const progress = parseVideoProgress('out_time=00:01:30.500\n', 180);

    expect(progress).not.toBeNull();
    expect(progress?.time).toBeCloseTo(90.5, 2);
    expect(progress?.percent).toBeCloseTo(50.28, 1);
  });

  it('parses frame number', () => {
    const progress = parseVideoProgress('out_time_ms=5000000\nframe=150\n', 10);

    expect(progress?.frame).toBe(150);
  });

  it('parses encoding speed', () => {
    const progress = parseVideoProgress('out_time_ms=5000000\nspeed=1.5x\n', 10);

    expect(progress?.speed).toBe(1.5);
  });

  it('parses bitrate', () => {
    const progress = parseVideoProgress('out_time_ms=5000000\nbitrate=2000.0kbits/s\n', 10);

    expect(progress?.bitrate).toBe(2000);
  });

  it('handles multiple progress lines', () => {
    const progressOutput = [
      'frame=150',
      'fps=30.0',
      'stream_0_0_q=24.0',
      'bitrate=1800.5kbits/s',
      'out_time_ms=5000000',
      'speed=1.2x',
      'progress=continue',
    ].join('\n');

    const progress = parseVideoProgress(progressOutput, 10);

    expect(progress?.time).toBe(5);
    expect(progress?.frame).toBe(150);
    expect(progress?.speed).toBe(1.2);
    expect(progress?.bitrate).toBe(1801);
    expect(progress?.percent).toBe(50);
  });

  it('returns null for non-progress output', () => {
    const progress = parseVideoProgress('Random log output\n', 10);

    expect(progress).toBeNull();
  });

  it('returns null for empty string', () => {
    const progress = parseVideoProgress('', 10);

    expect(progress).toBeNull();
  });

  it('handles 100% completion', () => {
    const progress = parseVideoProgress('out_time_ms=10000000\n', 10);

    expect(progress?.percent).toBe(100);
  });

  it('caps progress at 100%', () => {
    // Sometimes FFmpeg reports time slightly over duration
    const progress = parseVideoProgress('out_time_ms=10500000\n', 10);

    expect(progress?.percent).toBe(100);
  });

  it('handles zero duration gracefully', () => {
    const progress = parseVideoProgress('out_time_ms=5000000\n', 0);

    expect(progress).not.toBeNull();
    expect(progress?.time).toBe(5);
    expect(progress?.percent).toBeUndefined();
  });
});

// =============================================================================
// detectHardwareAcceleration Tests
// =============================================================================

describe('detectHardwareAcceleration', () => {
  it('detects VideoToolbox on macOS when available', async () => {
    const mockSpawn = createMockSpawn({
      stdout: 'Encoders:\n h264_videotoolbox\n',
      exitCode: 0,
    });

    // Override process.platform for test
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = await detectHardwareAcceleration('ffmpeg', mockSpawn);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });

    expect(result.videoToolbox).toBe(true);
    expect(result.platform).toBe('darwin');
  });

  it('returns false when VideoToolbox not available', async () => {
    const mockSpawn = createMockSpawn({
      stdout: 'Encoders:\n libx264\n aac\n',
      exitCode: 0,
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = await detectHardwareAcceleration('ffmpeg', mockSpawn);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });

    expect(result.videoToolbox).toBe(false);
  });

  it('returns false on non-macOS platforms', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const result = await detectHardwareAcceleration();

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });

    expect(result.videoToolbox).toBe(false);
    expect(result.platform).toBe('linux');
  });

  it('returns false if FFmpeg check fails', async () => {
    const error = new Error('Command not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    const mockSpawn = createMockSpawn({ error });

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = await detectHardwareAcceleration('ffmpeg', mockSpawn);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });

    expect(result.videoToolbox).toBe(false);
  });
});

// =============================================================================
// transcodeVideo Tests
// =============================================================================

describe('transcodeVideo', () => {
  it('transcodes video successfully', async () => {
    const mockSpawn = createMockSpawn({ exitCode: 0 });

    await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
      _spawnFn: mockSpawn,
    } as Parameters<typeof transcodeVideo>[3]);

    // Test passes if no error is thrown
  });

  it('throws VideoTranscodeError on FFmpeg failure', async () => {
    const mockSpawn = createMockSpawn({
      stderr: 'Error: Invalid input file\n',
      exitCode: 1,
    });

    let error: Error | undefined;
    try {
      await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
        _spawnFn: mockSpawn,
      } as Parameters<typeof transcodeVideo>[3]);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeInstanceOf(VideoTranscodeError);
    expect(error?.message).toContain('Invalid input file');
  });

  it('throws error when FFmpeg is not found', async () => {
    const error = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    const mockSpawn = createMockSpawn({ error });

    let thrownError: Error | undefined;
    try {
      await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
        _spawnFn: mockSpawn,
      } as Parameters<typeof transcodeVideo>[3]);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeInstanceOf(VideoTranscodeError);
    expect(thrownError?.message).toContain('FFmpeg not found');
  });

  it('throws immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const mockSpawn = createMockSpawn({ exitCode: 0 });

    let error: Error | undefined;
    try {
      await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
        signal: controller.signal,
        _spawnFn: mockSpawn,
      } as Parameters<typeof transcodeVideo>[3]);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeInstanceOf(VideoTranscodeError);
    expect(error?.message).toContain('aborted');
  });

  it('reports progress during transcoding', async () => {
    const progressUpdates: Array<{ time: number; percent: number }> = [];

    // Create mock that handles both ffprobe and ffmpeg
    const mockSpawn = createMultiMockSpawn({
      ffprobe: {
        stdout: JSON.stringify({ format: { duration: '10' } }),
        exitCode: 0,
      },
      ffmpeg: {
        stderr: 'out_time_ms=5000000\n',
        exitCode: 0,
      },
    });

    await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
      onProgress: (p) => progressUpdates.push({ time: p.time, percent: p.percent }),
      _spawnFn: mockSpawn,
    } as Parameters<typeof transcodeVideo>[3]);

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.some((p) => p.percent === 50)).toBe(true);
  });

  it('uses custom ffmpeg path when provided', async () => {
    let capturedCommand = '';
    const mockSpawn: SpawnFn = ((
      command: string,
      args: readonly string[],
      options?: SpawnOptions
    ) => {
      capturedCommand = command;
      const innerSpawn = createMockSpawn({ exitCode: 0 });
      return innerSpawn(command, args, options ?? {});
    }) as SpawnFn;

    await transcodeVideo('/input.mkv', '/output.m4v', defaultSettings, {
      ffmpegPath: '/custom/ffmpeg',
      _spawnFn: mockSpawn,
    } as Parameters<typeof transcodeVideo>[3]);

    expect(capturedCommand).toBe('/custom/ffmpeg');
  });
});

// =============================================================================
// VideoTranscodeError Tests
// =============================================================================

describe('VideoTranscodeError', () => {
  it('has correct name', () => {
    const error = new VideoTranscodeError('Test error');
    expect(error.name).toBe('VideoTranscodeError');
  });

  it('includes exit code', () => {
    const error = new VideoTranscodeError('FFmpeg failed', 1);
    expect(error.exitCode).toBe(1);
  });

  it('includes stderr', () => {
    const error = new VideoTranscodeError('FFmpeg failed', 1, 'Error output');
    expect(error.stderr).toBe('Error output');
  });

  it('is an instance of Error', () => {
    const error = new VideoTranscodeError('Test');
    expect(error).toBeInstanceOf(Error);
  });
});
