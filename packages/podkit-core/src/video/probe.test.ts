/**
 * Tests for video probe functionality
 */

import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { probeVideo, VideoProbeError, type SpawnFn } from './probe.js';

// Sample ffprobe output for an MKV file with H.264 video and AAC audio
const SAMPLE_MKV_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      profile: 'High',
      level: 41,
      width: 1920,
      height: 1080,
      bit_rate: '5000000',
      avg_frame_rate: '24000/1001',
      r_frame_rate: '24000/1001',
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 6,
      sample_rate: '48000',
      bit_rate: '384000',
    },
  ],
  format: {
    format_name: 'matroska,webm',
    duration: '7200.123',
    bit_rate: '5384000',
  },
});

// Sample ffprobe output for an MP4 file
const SAMPLE_MP4_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      profile: 'Main',
      level: 31,
      width: 640,
      height: 480,
      bit_rate: '2000000',
      avg_frame_rate: '30/1',
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 2,
      sample_rate: '44100',
      bit_rate: '128000',
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '120.5',
    bit_rate: '2128000',
  },
});

// Video file with no audio stream
const VIDEO_ONLY_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'vp9',
      width: 3840,
      height: 2160,
      avg_frame_rate: '60/1',
    },
  ],
  format: {
    format_name: 'webm',
    duration: '300.0',
    bit_rate: '20000000',
  },
});

// Audio file (no video stream)
const AUDIO_ONLY_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'audio',
      codec_name: 'mp3',
      channels: 2,
      sample_rate: '44100',
      bit_rate: '320000',
    },
  ],
  format: {
    format_name: 'mp3',
    duration: '180.0',
    bit_rate: '320000',
  },
});

// HEVC video with AC3 audio
const HEVC_AC3_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      profile: 'Main 10',
      level: 150,
      width: 3840,
      height: 2160,
      bit_rate: '15000000',
      avg_frame_rate: '23976/1000',
    },
    {
      codec_type: 'audio',
      codec_name: 'ac3',
      channels: 6,
      sample_rate: '48000',
      bit_rate: '640000',
    },
  ],
  format: {
    format_name: 'matroska,webm',
    duration: '5400.0',
    bit_rate: '15640000',
  },
});

// Minimal output (missing optional fields)
const MINIMAL_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'mpeg2video',
      width: 720,
      height: 576,
    },
  ],
  format: {
    format_name: 'mpeg',
    duration: '600.0',
  },
});

/**
 * Create a mock spawn function that returns the configured output
 */
function createMockSpawn(config: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
}): SpawnFn {
  return ((command: string, args: readonly string[], _options?: SpawnOptions): ChildProcess => {
    // Create EventEmitter-based streams for stdout and stderr
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

    // Emit data and close on next tick
    process.nextTick(() => {
      if (config.error) {
        proc.emit('error', config.error);
        return;
      }

      // Emit stdout data
      if (config.stdout) {
        stdoutStream.emit('data', Buffer.from(config.stdout));
      }

      // Emit stderr data
      if (config.stderr) {
        stderrStream.emit('data', Buffer.from(config.stderr));
      }

      // Emit close event
      proc.emit('close', config.exitCode ?? 0);
    });

    return proc;
  }) as SpawnFn;
}

describe('probeVideo', () => {
  describe('parsing ffprobe output', () => {
    it('parses MKV file with H.264 and AAC', async () => {
      const mockSpawn = createMockSpawn({ stdout: SAMPLE_MKV_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mkv', { _spawnFn: mockSpawn });

      expect(result.filePath).toBe('/path/to/video.mkv');
      expect(result.container).toBe('mkv');
      expect(result.videoCodec).toBe('h264');
      expect(result.videoProfile).toBe('high');
      expect(result.videoLevel).toBe('4.1');
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.videoBitrate).toBe(5000);
      expect(result.frameRate).toBeCloseTo(23.976, 2);
      expect(result.audioCodec).toBe('aac');
      expect(result.audioBitrate).toBe(384);
      expect(result.audioChannels).toBe(6);
      expect(result.audioSampleRate).toBe(48000);
      expect(result.duration).toBe(7200.123);
      expect(result.hasVideoStream).toBe(true);
      expect(result.hasAudioStream).toBe(true);
    });

    it('parses MP4 file with standard settings', async () => {
      const mockSpawn = createMockSpawn({ stdout: SAMPLE_MP4_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });

      expect(result.container).toBe('mp4');
      expect(result.videoCodec).toBe('h264');
      expect(result.videoProfile).toBe('main');
      expect(result.videoLevel).toBe('3.1');
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.videoBitrate).toBe(2000);
      expect(result.frameRate).toBe(30);
      expect(result.audioCodec).toBe('aac');
      expect(result.audioBitrate).toBe(128);
      expect(result.audioChannels).toBe(2);
      expect(result.audioSampleRate).toBe(44100);
      expect(result.duration).toBe(120.5);
    });

    it('parses HEVC video with AC3 audio', async () => {
      const mockSpawn = createMockSpawn({ stdout: HEVC_AC3_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mkv', { _spawnFn: mockSpawn });

      expect(result.videoCodec).toBe('hevc');
      expect(result.videoProfile).toBe('main 10');
      expect(result.videoLevel).toBe('15.0');
      expect(result.width).toBe(3840);
      expect(result.height).toBe(2160);
      expect(result.audioCodec).toBe('ac3');
      expect(result.audioChannels).toBe(6);
    });

    it('parses file with minimal metadata', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mpg', { _spawnFn: mockSpawn });

      expect(result.container).toBe('mpg');
      expect(result.videoCodec).toBe('mpeg2video');
      expect(result.videoProfile).toBeNull();
      expect(result.videoLevel).toBeNull();
      expect(result.width).toBe(720);
      expect(result.height).toBe(576);
      expect(result.videoBitrate).toBe(0);
      expect(result.frameRate).toBe(0);
      expect(result.hasVideoStream).toBe(true);
      expect(result.hasAudioStream).toBe(false);
    });
  });

  describe('handling missing streams', () => {
    it('handles video file with no audio stream', async () => {
      const mockSpawn = createMockSpawn({ stdout: VIDEO_ONLY_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/video-only.webm', { _spawnFn: mockSpawn });

      expect(result.hasVideoStream).toBe(true);
      expect(result.hasAudioStream).toBe(false);
      expect(result.videoCodec).toBe('vp9');
      expect(result.width).toBe(3840);
      expect(result.height).toBe(2160);
      expect(result.audioCodec).toBe('');
      expect(result.audioBitrate).toBe(0);
      expect(result.audioChannels).toBe(0);
      expect(result.audioSampleRate).toBe(0);
    });

    it('handles audio-only file (no video stream)', async () => {
      const mockSpawn = createMockSpawn({ stdout: AUDIO_ONLY_OUTPUT, exitCode: 0 });

      const result = await probeVideo('/path/to/audio.mp3', { _spawnFn: mockSpawn });

      expect(result.hasVideoStream).toBe(false);
      expect(result.hasAudioStream).toBe(true);
      expect(result.videoCodec).toBe('');
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
      expect(result.audioCodec).toBe('mp3');
      expect(result.audioBitrate).toBe(320);
      expect(result.audioChannels).toBe(2);
    });
  });

  describe('error handling', () => {
    it('throws VideoProbeError for file not found', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'No such file or directory',
        exitCode: 1,
      });

      try {
        await probeVideo('/nonexistent/file.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('File not found');
      }
    });

    it('throws VideoProbeError for corrupt file', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'Invalid data found when processing input',
        exitCode: 1,
      });

      try {
        await probeVideo('/path/to/corrupt.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('Corrupt or invalid');
      }
    });

    it('throws VideoProbeError for invalid JSON output', async () => {
      const mockSpawn = createMockSpawn({
        stdout: 'not valid json',
        exitCode: 0,
      });

      try {
        await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('Failed to parse ffprobe JSON');
      }
    });

    it('throws VideoProbeError when ffprobe fails with exit code', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'Some error message',
        exitCode: 2,
      });

      try {
        await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('exit code 2');
        expect((err as VideoProbeError).exitCode).toBe(2);
      }
    });

    it('throws VideoProbeError when ffprobe is not found', async () => {
      const error = new Error('spawn ffprobe ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      const mockSpawn = createMockSpawn({ error });

      try {
        await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('ffprobe not found');
      }
    });

    it('throws VideoProbeError for moov atom not found', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'moov atom not found',
        exitCode: 1,
      });

      try {
        await probeVideo('/path/to/broken.mp4', { _spawnFn: mockSpawn });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoProbeError);
        expect((err as VideoProbeError).message).toContain('Corrupt or invalid');
      }
    });
  });

  describe('frame rate parsing', () => {
    it('parses fractional frame rates correctly', async () => {
      const outputWith2997 = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001', // 29.97 fps
          },
        ],
        format: { format_name: 'mp4', duration: '60' },
      });

      const mockSpawn = createMockSpawn({ stdout: outputWith2997, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
      expect(result.frameRate).toBeCloseTo(29.97, 2);
    });

    it('falls back to r_frame_rate when avg_frame_rate is missing', async () => {
      const outputWithRFrameRate = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '25/1',
          },
        ],
        format: { format_name: 'mp4', duration: '60' },
      });

      const mockSpawn = createMockSpawn({ stdout: outputWithRFrameRate, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
      expect(result.frameRate).toBe(25);
    });
  });

  describe('container format parsing', () => {
    it('parses WebM format', async () => {
      const webmOutput = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'vp9',
            width: 1920,
            height: 1080,
          },
        ],
        format: { format_name: 'matroska,webm', duration: '60' },
      });

      const mockSpawn = createMockSpawn({ stdout: webmOutput, exitCode: 0 });

      const result = await probeVideo('/path/to/video.webm', { _spawnFn: mockSpawn });
      expect(result.container).toBe('mkv');
    });

    it('parses AVI format', async () => {
      const aviOutput = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'mpeg4',
            width: 640,
            height: 480,
          },
        ],
        format: { format_name: 'avi', duration: '60' },
      });

      const mockSpawn = createMockSpawn({ stdout: aviOutput, exitCode: 0 });

      const result = await probeVideo('/path/to/video.avi', { _spawnFn: mockSpawn });
      expect(result.container).toBe('avi');
    });

    it('handles unknown format gracefully', async () => {
      const unknownOutput = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'rawvideo',
            width: 640,
            height: 480,
          },
        ],
        format: { duration: '60' },
      });

      const mockSpawn = createMockSpawn({ stdout: unknownOutput, exitCode: 0 });

      const result = await probeVideo('/path/to/video.raw', { _spawnFn: mockSpawn });
      expect(result.container).toBe('unknown');
    });
  });

  describe('bitrate estimation', () => {
    it('estimates video bitrate from format bitrate when stream bitrate is missing', async () => {
      const outputNoStreamBitrate = JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '24/1',
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
            channels: 2,
            sample_rate: '44100',
            bit_rate: '128000', // 128 kbps audio
          },
        ],
        format: {
          format_name: 'mp4',
          duration: '60',
          bit_rate: '5128000', // 5128 kbps total
        },
      });

      const mockSpawn = createMockSpawn({ stdout: outputNoStreamBitrate, exitCode: 0 });

      const result = await probeVideo('/path/to/video.mp4', { _spawnFn: mockSpawn });
      // Video bitrate should be estimated as total - audio = 5128 - 128 = 5000 kbps
      expect(result.videoBitrate).toBe(5000);
      expect(result.audioBitrate).toBe(128);
    });
  });

  describe('custom ffprobe path', () => {
    it('uses custom ffprobe path when provided', async () => {
      let calledCommand: string | undefined;
      const mockSpawn: SpawnFn = ((
        command: string,
        args: readonly string[],
        options: SpawnOptions
      ): ChildProcess => {
        calledCommand = command;
        return createMockSpawn({ stdout: SAMPLE_MP4_OUTPUT, exitCode: 0 })(command, args, options);
      }) as SpawnFn;

      await probeVideo('/path/to/video.mp4', {
        ffprobePath: '/custom/path/ffprobe',
        _spawnFn: mockSpawn,
      });

      expect(calledCommand).toBe('/custom/path/ffprobe');
    });
  });
});

describe('VideoProbeError', () => {
  it('has correct name property', () => {
    const error = new VideoProbeError('test error');
    expect(error.name).toBe('VideoProbeError');
  });

  it('stores exitCode and stderr', () => {
    const error = new VideoProbeError('test error', 1, 'stderr output');
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe('stderr output');
  });

  it('is an instance of Error', () => {
    const error = new VideoProbeError('test error');
    expect(error).toBeInstanceOf(Error);
  });
});
