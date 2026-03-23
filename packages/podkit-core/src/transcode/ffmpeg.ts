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
  EncodingMode,
  TransferMode,
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
export function buildVbrArgs(encoder: string, quality: number, targetKbps?: number): string[] {
  switch (encoder) {
    case 'libfdk_aac':
      // libfdk_aac uses -vbr 1-5 scale
      // Also set cutoff to preserve high frequencies
      return ['-vbr', String(quality), '-cutoff', '18000'];
    case 'aac_at':
      // aac_at uses -q:a 0-14 scale where 0 = highest quality, 14 = lowest.
      // Map target bitrate to aac_at quality (empirically measured):
      //   q=0  ~350 kbps (max)
      //   q=2  ~265 kbps (high)
      //   q=4  ~200 kbps (medium)
      //   q=6  ~145 kbps (low)
      //   q=8  ~107 kbps
      const aacAtQuality =
        targetKbps !== undefined
          ? aacAtQualityFromBitrate(targetKbps)
          : aacAtQualityFromLevel(quality);
      return ['-q:a', String(aacAtQuality)];
    case 'aac':
    default:
      // Native AAC uses -q:a 0.1-5 scale (5 = highest quality)
      return ['-q:a', String(quality)];
  }
}

/**
 * Map a target bitrate to the closest aac_at -q:a value.
 *
 * Empirically measured scale (CHVRCHES, Foals, Mk.gee):
 *   q=0 ~350, q=1 ~290, q=2 ~265, q=3 ~220, q=4 ~200,
 *   q=5 ~155, q=6 ~145, q=7 ~121, q=8 ~107
 */
function aacAtQualityFromBitrate(targetKbps: number): number {
  // Ordered from highest quality (lowest q) to lowest
  const scale: Array<[number, number]> = [
    [320, 0],
    [256, 2],
    [192, 4],
    [128, 6],
    [96, 8],
  ];
  // Find the closest target
  let best = scale[0]![1];
  let bestDist = Math.abs(targetKbps - scale[0]![0]);
  for (const [kbps, q] of scale) {
    const dist = Math.abs(targetKbps - kbps);
    if (dist < bestDist) {
      bestDist = dist;
      best = q;
    }
  }
  return best;
}

/**
 * Fallback: map our internal 1-5 quality level to aac_at scale.
 */
function aacAtQualityFromLevel(quality: number): number {
  const map: Record<number, number> = { 5: 0, 4: 4, 3: 5, 2: 6, 1: 8 };
  return map[quality] ?? Math.max(0, Math.round(14 - quality * 2.8));
}

/**
 * Resolved AAC transcode configuration for FFmpeg argument building.
 *
 * This is the resolved form after the planner has:
 * - Resolved `max` to either ALAC or `high`
 * - Applied bitrate capping for incompatible lossy sources
 * - Applied custom bitrate overrides
 */
export interface AacTranscodeConfig {
  /** Target bitrate in kbps */
  bitrateKbps: number;
  /** Encoding mode */
  encoding: EncodingMode;
  /** VBR quality level from the preset (used for non-aac_at encoders) */
  quality?: number;
}

/**
 * Build FFmpeg command arguments for transcoding.
 *
 * Accepts either a `QualityPreset` name (for backward compatibility and simple cases)
 * or an `AacTranscodeConfig` object for full control over bitrate and encoding mode.
 *
 * The `'lossless'` string triggers ALAC encoding.
 * The `'max'` preset should never reach this function — the planner resolves it
 * to either `'lossless'` or an AAC config before calling.
 *
 * @param input - Input file path
 * @param output - Output file path
 * @param encoder - AAC encoder to use (ignored for ALAC)
 * @param preset - Quality preset name or resolved AAC config
 * @returns Array of FFmpeg arguments
 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  encoder: string,
  preset: QualityPreset | 'lossless' | AacTranscodeConfig,
  options?: { transferMode?: TransferMode }
): string[] {
  // Handle ALAC encoding
  if (preset === 'lossless') {
    return buildAlacArgs(input, output, options);
  }

  // Resolve preset to AAC config
  let bitrateKbps: number;
  let encoding: EncodingMode;
  let quality: number | undefined;

  if (typeof preset === 'object') {
    // Resolved config from planner
    bitrateKbps = preset.bitrateKbps;
    encoding = preset.encoding;
    quality = preset.quality;
  } else {
    // QualityPreset string — look up from AAC_PRESETS
    // max resolves to high
    const presetKey = preset === 'max' ? 'high' : preset;
    const aacPreset = AAC_PRESETS[presetKey];
    bitrateKbps = aacPreset.targetKbps;
    encoding = aacPreset.mode === 'vbr' ? 'vbr' : 'cbr';
    quality = aacPreset.quality;
  }

  const args: string[] = [
    // Input
    '-i',
    input,

    // Audio codec
    '-c:a',
    encoder,
  ];

  // Apply quality settings based on encoding mode (VBR vs CBR)
  if (encoding === 'vbr' && quality !== undefined) {
    // VBR mode — pass targetKbps so aac_at can pick the right quality level
    args.push(...buildVbrArgs(encoder, quality, bitrateKbps));
  } else {
    // CBR mode
    args.push('-b:a', `${bitrateKbps}k`);
  }

  // Sample rate (44100 Hz standard)
  args.push('-ar', '44100');

  // Preserve metadata from source
  args.push('-map_metadata', '0');

  // Embedded artwork handling based on transfer mode
  const transferMode = options?.transferMode ?? 'fast';
  if (transferMode === 'portable') {
    // Preserve embedded artwork for exportable files
    args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  } else {
    // Strip embedded artwork — iPods read artwork from their internal database
    args.push('-vn');
  }

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
export function buildAlacArgs(
  input: string,
  output: string,
  options?: { transferMode?: TransferMode }
): string[] {
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

  // Embedded artwork handling based on transfer mode
  const transferMode = options?.transferMode ?? 'fast';
  if (transferMode === 'portable') {
    // Preserve embedded artwork for exportable files
    args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  } else {
    // Strip embedded artwork — iPods read artwork from their internal database
    args.push('-vn');
  }

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
 * Optimized copy output format — determines container format flag
 */
export type OptimizedCopyFormat = 'alac' | 'mp3' | 'm4a';

/**
 * Build FFmpeg arguments for optimized-copy (stream copy with artwork stripping).
 *
 * Used when transferMode='optimized' for copy-format files (MP3, M4A, ALAC→ALAC).
 * Audio is copied without re-encoding; only artwork is stripped.
 */
export function buildOptimizedCopyArgs(
  input: string,
  output: string,
  format: OptimizedCopyFormat
): string[] {
  const args: string[] = [
    '-i',
    input,
    '-c:a',
    'copy',
    '-map_metadata',
    '0',
    '-vn', // Strip embedded artwork
  ];

  // MP3 doesn't use -f ipod container format
  if (format !== 'mp3') {
    args.push('-f', 'ipod');
  }

  args.push('-y');
  args.push('-progress', 'pipe:1');
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
    preset: QualityPreset | 'lossless' | AacTranscodeConfig,
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
    const args = buildTranscodeArgs(input, output, caps.preferredEncoder, preset, {
      transferMode: options.transferMode,
    });

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
          reject(new TranscodeError(`FFmpeg exited with code ${code}`, code ?? undefined, stderr));
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
