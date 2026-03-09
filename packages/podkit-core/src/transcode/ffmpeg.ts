/**
 * FFmpeg Transcoder - Audio transcoding using FFmpeg
 *
 * Implements the Transcoder interface using FFmpeg for converting audio files
 * to iPod-compatible AAC/M4A or ALAC format.
 *
 * Encoder priority for AAC: aac_at (macOS) > libfdk_aac (custom build) > aac (native)
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type {
  Transcoder,
  TranscoderCapabilities,
  TranscodeResult,
  TranscodeOptions,
  AudioMetadata,
  QualityPreset,
} from './types.js';
import { AAC_PRESETS } from './types.js';
import { parseFFmpegProgressLine } from './progress.js';

/**
 * Error thrown when FFmpeg is not available
 */
export class FFmpegNotFoundError extends Error {
  constructor(message: string = 'FFmpeg not found') {
    super(message);
    this.name = 'FFmpegNotFoundError';
  }
}

/**
 * Error thrown when transcoding fails
 */
export class TranscodeError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'TranscodeError';
  }
}

/**
 * AAC encoders in priority order (best first)
 */
const ENCODER_PRIORITY = ['aac_at', 'libfdk_aac', 'aac'] as const;

/**
 * Default FFmpeg binary name
 */
const DEFAULT_FFMPEG = 'ffmpeg';

/**
 * Default FFprobe binary name
 */
const DEFAULT_FFPROBE = 'ffprobe';

/**
 * FFmpeg transcoder configuration
 */
export interface FFmpegTranscoderConfig {
  /** Override FFmpeg binary path */
  ffmpegPath?: string;
  /** Override FFprobe binary path */
  ffprobePath?: string;
}

/**
 * Build FFmpeg arguments for VBR encoding
 */
export function buildVbrArgs(encoder: string, quality: number): string[] {
  switch (encoder) {
    case 'libfdk_aac':
      // libfdk_aac uses -vbr 1-5 scale
      // Also set cutoff to preserve high frequencies
      return ['-vbr', String(quality), '-cutoff', '18000'];
    case 'aac_at':
      // aac_at uses -q:a 0-14 scale (14 = highest)
      // Map our 1-5 to aac_at's scale
      const aacAtQuality = Math.round(quality * 2.8);
      return ['-q:a', String(aacAtQuality)];
    case 'aac':
    default:
      // Native AAC uses -q:a 0.1-5 scale
      return ['-q:a', String(quality)];
  }
}

/**
 * Build FFmpeg command arguments for transcoding
 *
 * @param input - Input file path
 * @param output - Output file path
 * @param encoder - AAC encoder to use (ignored for ALAC)
 * @param preset - Quality preset name
 * @returns Array of FFmpeg arguments
 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  encoder: string,
  preset: QualityPreset
): string[] {
  // Handle ALAC encoding
  if (preset === 'alac') {
    return buildAlacArgs(input, output);
  }

  const aacPreset = AAC_PRESETS[preset];

  const args: string[] = [
    // Input
    '-i',
    input,

    // Audio codec
    '-c:a',
    encoder,
  ];

  // Apply quality settings based on mode (VBR vs CBR)
  if (aacPreset.mode === 'vbr' && aacPreset.quality !== undefined) {
    // VBR mode
    args.push(...buildVbrArgs(encoder, aacPreset.quality));
  } else {
    // CBR mode
    args.push('-b:a', `${aacPreset.targetKbps}k`);
  }

  // Sample rate (44100 Hz standard)
  args.push('-ar', '44100');

  // Preserve metadata from source
  args.push('-map_metadata', '0');

  // Copy embedded artwork if present
  args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');

  // No video stream (only copy artwork)
  args.push('-vn');

  // Output format (M4A container optimized for iPod)
  args.push('-f', 'ipod');

  // Overwrite output file
  args.push('-y');

  // Progress output for parsing
  args.push('-progress', 'pipe:1');

  // Output file
  args.push(output);

  return args;
}

/**
 * Build FFmpeg command arguments for ALAC encoding (lossless)
 *
 * @param input - Input file path
 * @param output - Output file path
 * @returns Array of FFmpeg arguments
 */
export function buildAlacArgs(input: string, output: string): string[] {
  const args: string[] = [
    // Input
    '-i',
    input,

    // ALAC audio codec
    '-c:a',
    'alac',
  ];

  // Sample rate (44100 Hz standard)
  args.push('-ar', '44100');

  // Preserve metadata from source
  args.push('-map_metadata', '0');

  // Copy embedded artwork if present
  args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');

  // No video stream (only copy artwork)
  args.push('-vn');

  // Output format (M4A container optimized for iPod)
  args.push('-f', 'ipod');

  // Overwrite output file
  args.push('-y');

  // Progress output for parsing
  args.push('-progress', 'pipe:1');

  // Output file
  args.push(output);

  return args;
}

/**
 * FFmpeg-based transcoder implementation
 */
export class FFmpegTranscoder implements Transcoder {
  private ffmpegPath: string;
  private ffprobePath: string;
  private capabilities: TranscoderCapabilities | null = null;

  constructor(config: FFmpegTranscoderConfig = {}) {
    this.ffmpegPath = config.ffmpegPath ?? DEFAULT_FFMPEG;
    this.ffprobePath = config.ffprobePath ?? DEFAULT_FFPROBE;
  }

  /**
   * Execute a command and return stdout/stderr
   */
  private async exec(
    command: string,
    args: string[],
    options: { signal?: AbortSignal } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          proc.kill('SIGTERM');
          reject(new Error('Operation aborted'));
        });
      }

      proc.on('error', (err: Error) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new FFmpegNotFoundError(`${command} not found`));
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });
    });
  }

  /**
   * Detect FFmpeg installation and capabilities
   */
  async detect(): Promise<TranscoderCapabilities> {
    // Return cached capabilities if available
    if (this.capabilities) {
      return this.capabilities;
    }

    // Get FFmpeg version
    let version: string;
    try {
      const result = await this.exec(this.ffmpegPath, ['-version']);
      const match = result.stdout.match(/ffmpeg version (\S+)/);
      version = match?.[1] ?? 'unknown';
    } catch (err) {
      if (err instanceof FFmpegNotFoundError) {
        throw err;
      }
      throw new FFmpegNotFoundError('Failed to detect FFmpeg version');
    }

    // Get available AAC encoders
    const encoderResult = await this.exec(this.ffmpegPath, ['-encoders']);
    const aacEncoders: string[] = [];

    // Parse encoder list for AAC encoders
    for (const encoder of ENCODER_PRIORITY) {
      if (encoderResult.stdout.includes(encoder)) {
        aacEncoders.push(encoder);
      }
    }

    if (aacEncoders.length === 0) {
      throw new TranscodeError('No AAC encoder available');
    }

    // Select best available encoder
    const preferredEncoder = aacEncoders[0]!;

    this.capabilities = {
      version,
      path: this.ffmpegPath,
      aacEncoders,
      preferredEncoder,
    };

    return this.capabilities;
  }

  /**
   * Transcode an audio file to iPod-compatible format
   */
  async transcode(
    input: string,
    output: string,
    preset: QualityPreset,
    options: TranscodeOptions = {}
  ): Promise<TranscodeResult> {
    // Check if already aborted
    if (options.signal?.aborted) {
      throw new Error('Transcode aborted');
    }

    // Ensure capabilities are detected
    const caps = await this.detect();

    // Use specified FFmpeg path or default
    const ffmpegPath = options.ffmpegPath ?? this.ffmpegPath;

    // Build FFmpeg arguments
    const args = buildTranscodeArgs(input, output, caps.preferredEncoder, preset);

    // Track timing
    const startTime = Date.now();

    // Get input duration for progress calculation
    let inputDuration: number | undefined;
    try {
      const meta = await this.probe(input);
      inputDuration = meta.duration / 1000; // Convert to seconds
    } catch {
      // Ignore probe errors, progress just won't show percentage
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      // Parse progress from stdout
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const progress = parseFFmpegProgressLine(line);
          if (progress?.time !== undefined && options.onProgress) {
            const percent =
              inputDuration !== undefined && inputDuration > 0
                ? Math.min(100, (progress.time / inputDuration) * 100)
                : 0;

            options.onProgress({
              time: progress.time,
              duration: inputDuration ?? 0,
              percent,
            });
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          proc.kill('SIGTERM');
          reject(new Error('Transcode aborted'));
        });
      }

      proc.on('error', (err: Error) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new FFmpegNotFoundError(`${ffmpegPath} not found`));
        } else {
          reject(new TranscodeError(err.message));
        }
      });

      proc.on('close', async (code) => {
        const duration = Date.now() - startTime;

        if (code !== 0) {
          reject(
            new TranscodeError(`FFmpeg exited with code ${code}`, code ?? undefined, stderr)
          );
          return;
        }

        // Get output file info
        try {
          const fileInfo = await stat(output);
          const outputMeta = await this.probe(output);

          resolve({
            outputPath: output,
            size: fileInfo.size,
            duration,
            bitrate: outputMeta.bitrate,
          });
        } catch (err) {
          reject(
            new TranscodeError(
              `Failed to read output file: ${err instanceof Error ? err.message : err}`
            )
          );
        }
      });
    });
  }

  /**
   * Probe an audio file for metadata using ffprobe
   */
  async probe(file: string): Promise<AudioMetadata> {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration,bit_rate:stream=codec_name,sample_rate,channels',
      '-of',
      'json',
      file,
    ];

    const result = await this.exec(this.ffprobePath, args);

    if (result.exitCode !== 0) {
      throw new TranscodeError(`ffprobe failed: ${result.stderr}`, result.exitCode);
    }

    let data: {
      format?: {
        duration?: string;
        bit_rate?: string;
      };
      streams?: Array<{
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };

    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw new TranscodeError('Failed to parse ffprobe output');
    }

    const format = data.format ?? {};
    const audioStream = data.streams?.find((s) => s.codec_name) ?? {};

    const durationSec = parseFloat(format.duration ?? '0');
    const bitrate = parseInt(format.bit_rate ?? '0', 10);
    const sampleRate = parseInt(audioStream.sample_rate ?? '44100', 10);
    const channels = audioStream.channels ?? 2;
    const codec = audioStream.codec_name ?? 'unknown';

    return {
      duration: Math.round(durationSec * 1000), // Convert to milliseconds
      bitrate: Math.round(bitrate / 1000), // Convert to kbps
      sampleRate,
      channels,
      codec,
      format: 'm4a',
    };
  }

  /**
   * Get the path to the FFmpeg binary
   */
  getFFmpegPath(): string {
    return this.ffmpegPath;
  }

  /**
   * Get the path to the FFprobe binary
   */
  getFFprobePath(): string {
    return this.ffprobePath;
  }
}

/**
 * Create an FFmpeg transcoder instance
 */
export function createFFmpegTranscoder(config: FFmpegTranscoderConfig = {}): FFmpegTranscoder {
  return new FFmpegTranscoder(config);
}

/**
 * Check if FFmpeg is available on the system
 */
export async function isFFmpegAvailable(ffmpegPath?: string): Promise<boolean> {
  const transcoder = new FFmpegTranscoder({ ffmpegPath });
  try {
    await transcoder.detect();
    return true;
  } catch {
    return false;
  }
}
