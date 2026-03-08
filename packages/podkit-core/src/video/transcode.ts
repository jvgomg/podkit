/**
 * Video transcoder - FFmpeg-based video transcoding for iPod
 *
 * Converts video files to iPod-compatible H.264/M4V format with
 * quality presets, hardware acceleration support, and progress reporting.
 *
 * @see ADR-006 for design decisions
 */

import { spawn } from 'node:child_process';
import type { VideoTranscodeSettings, VideoProfile } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default FFmpeg binary name
 */
const DEFAULT_FFMPEG = 'ffmpeg';

/**
 * Default FFprobe binary name
 */
const DEFAULT_FFPROBE = 'ffprobe';

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when video transcoding fails
 */
export class VideoTranscodeError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'VideoTranscodeError';
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Progress information during video transcoding
 */
export interface VideoTranscodeProgress {
  /** Current time position in seconds */
  time: number;
  /** Total duration in seconds */
  duration: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Current frame number (if available) */
  frame?: number;
  /** Current encoding speed (e.g., 1.5x) */
  speed?: number;
  /** Current bitrate in kbps */
  bitrate?: number;
}

/**
 * Options for video transcoding
 */
export interface VideoTranscodeOptions {
  /** Progress callback */
  onProgress?: (progress: VideoTranscodeProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Override FFmpeg binary path */
  ffmpegPath?: string;
  /** Override FFprobe binary path */
  ffprobePath?: string;
}

/**
 * Result of hardware acceleration detection
 */
export interface HardwareAccelerationInfo {
  /** Whether VideoToolbox is available (macOS) */
  videoToolbox: boolean;
  /** Platform identifier */
  platform: NodeJS.Platform;
}

/**
 * Spawn function type for dependency injection
 */
export type SpawnFn = typeof spawn;

/**
 * Internal options including test hooks
 */
interface InternalTranscodeOptions extends VideoTranscodeOptions {
  /** Custom spawn function for testing */
  _spawnFn?: SpawnFn;
}

// =============================================================================
// Hardware Acceleration Detection
// =============================================================================

/**
 * Detect available hardware acceleration
 *
 * Checks for VideoToolbox encoder availability on macOS by querying
 * FFmpeg's encoder list.
 *
 * @param ffmpegPath - Path to FFmpeg binary
 * @param spawnFn - Custom spawn function (for testing)
 * @returns Promise resolving to hardware acceleration info
 *
 * @example
 * ```typescript
 * const hw = await detectHardwareAcceleration();
 * if (hw.videoToolbox) {
 *   console.log('VideoToolbox available for hardware encoding');
 * }
 * ```
 */
export async function detectHardwareAcceleration(
  ffmpegPath: string = DEFAULT_FFMPEG,
  spawnFn: SpawnFn = spawn
): Promise<HardwareAccelerationInfo> {
  const platform = process.platform;

  // VideoToolbox is only available on macOS
  if (platform !== 'darwin') {
    return { videoToolbox: false, platform };
  }

  try {
    const result = await execCommand(ffmpegPath, ['-encoders'], spawnFn);
    const hasVideoToolbox = result.stdout.includes('h264_videotoolbox');
    return { videoToolbox: hasVideoToolbox, platform };
  } catch {
    // If FFmpeg check fails, assume no hardware acceleration
    return { videoToolbox: false, platform };
  }
}

// =============================================================================
// FFmpeg Argument Building
// =============================================================================

/**
 * Build FFmpeg arguments for video transcoding
 *
 * Constructs the full FFmpeg command-line arguments for transcoding
 * video to iPod-compatible format.
 *
 * @param input - Input file path
 * @param output - Output file path
 * @param settings - Transcode settings (resolution, bitrate, etc.)
 * @returns Array of FFmpeg arguments
 *
 * @example
 * ```typescript
 * const args = buildVideoTranscodeArgs(
 *   '/input.mkv',
 *   '/output.m4v',
 *   {
 *     targetWidth: 640,
 *     targetHeight: 480,
 *     targetVideoBitrate: 2000,
 *     targetAudioBitrate: 128,
 *     videoProfile: 'main',
 *     videoLevel: '3.1',
 *     crf: 21,
 *     frameRate: 30,
 *     useHardwareAcceleration: false,
 *   }
 * );
 * ```
 */
export function buildVideoTranscodeArgs(
  input: string,
  output: string,
  settings: VideoTranscodeSettings
): string[] {
  const args: string[] = [
    // Input file
    '-i', input,
  ];

  // Force 8-bit output (required for iPod compatibility and HDR/10-bit sources)
  args.push('-pix_fmt', 'yuv420p');

  // Video codec selection
  if (settings.useHardwareAcceleration) {
    // VideoToolbox hardware encoder (macOS)
    // Note: VideoToolbox doesn't support CRF, uses bitrate-based encoding
    args.push(
      '-c:v', 'h264_videotoolbox',
      '-profile:v', mapProfileForVideoToolbox(settings.videoProfile),
      '-b:v', `${settings.targetVideoBitrate}k`,
    );
  } else {
    // libx264 software encoder
    args.push(
      '-c:v', 'libx264',
      '-profile:v', settings.videoProfile,
      '-level', settings.videoLevel,
      '-crf', String(settings.crf),
      '-maxrate', `${settings.targetVideoBitrate}k`,
      '-bufsize', `${settings.targetVideoBitrate * 2}k`,
    );
  }

  // Video filter: scale with aspect ratio preservation and padding
  const scaleFilter = buildScaleFilter(settings.targetWidth, settings.targetHeight);
  args.push('-vf', scaleFilter);

  // Frame rate limit
  args.push('-r', String(settings.frameRate));

  // Audio codec: AAC stereo
  args.push(
    '-c:a', 'aac',
    '-b:a', `${settings.targetAudioBitrate}k`,
    '-ac', '2',
  );

  // Output optimizations
  args.push(
    // Hide banner
    '-hide_banner',
    // Overwrite output
    '-y',
    // Fast start for progressive playback
    '-movflags', '+faststart',
    // iPod-compatible container
    '-f', 'ipod',
  );

  // Output file (must come last)
  args.push(output);

  // Progress to stderr - must come after output file in FFmpeg 8.0+
  // Actually, -progress is a global option and should come early
  // Let's prepend it to be safe
  args.unshift('-progress', 'pipe:2');

  return args;
}

/**
 * Map H.264 profile name for VideoToolbox encoder
 *
 * VideoToolbox uses different profile names than libx264.
 */
function mapProfileForVideoToolbox(profile: VideoProfile): string {
  switch (profile) {
    case 'baseline':
      return 'baseline';
    case 'main':
      return 'main';
    default:
      return 'main';
  }
}

/**
 * Build FFmpeg scale filter with aspect ratio preservation
 *
 * Creates a filter that:
 * 1. Scales video to fit within target dimensions
 * 2. Maintains original aspect ratio
 * 3. Adds black bars (letterbox/pillarbox) if needed
 *
 * @param targetWidth - Maximum width
 * @param targetHeight - Maximum height
 * @returns FFmpeg filter string
 */
export function buildScaleFilter(targetWidth: number, targetHeight: number): string {
  // Scale to fit within target dimensions, preserving aspect ratio
  // Then pad to exact target dimensions with black bars
  return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
    `pad=${targetWidth}:${targetHeight}:-1:-1:black`;
}

// =============================================================================
// Progress Parsing
// =============================================================================

/**
 * Parse FFmpeg progress output from stderr
 *
 * FFmpeg outputs progress in key=value format when using -progress pipe:2
 *
 * @param stderrChunk - Chunk of stderr output
 * @param duration - Total duration in seconds
 * @returns Partial progress info or null if not parseable
 *
 * @example
 * ```typescript
 * const progress = parseVideoProgress('out_time_ms=5000000\n', 10);
 * // { time: 5, duration: 10, percent: 50 }
 * ```
 */
export function parseVideoProgress(
  stderrChunk: string,
  duration: number
): Partial<VideoTranscodeProgress> | null {
  const result: Partial<VideoTranscodeProgress> = {};
  let hasData = false;

  const lines = stderrChunk.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (!match) continue;

    const [, key, value] = match;

    switch (key) {
      case 'out_time_ms':
        // Time in microseconds
        const timeUs = parseInt(value!, 10);
        if (!isNaN(timeUs)) {
          result.time = timeUs / 1_000_000;
          hasData = true;
        }
        break;

      case 'out_time':
        // Time in HH:MM:SS.mmm format (fallback)
        if (!result.time) {
          const timeSec = parseTimeString(value!);
          if (timeSec !== null) {
            result.time = timeSec;
            hasData = true;
          }
        }
        break;

      case 'frame':
        const frame = parseInt(value!, 10);
        if (!isNaN(frame)) {
          result.frame = frame;
        }
        break;

      case 'speed':
        // Speed like "1.5x" or "0.5x"
        const speedMatch = value!.match(/^(\d+\.?\d*)x$/);
        if (speedMatch) {
          result.speed = parseFloat(speedMatch[1]!);
        }
        break;

      case 'bitrate':
        // Bitrate like "2000.0kbits/s"
        const bitrateMatch = value!.match(/^(\d+\.?\d*)kbits\/s$/);
        if (bitrateMatch) {
          result.bitrate = Math.round(parseFloat(bitrateMatch[1]!));
        }
        break;
    }
  }

  if (!hasData) return null;

  // Calculate progress percentage
  if (result.time !== undefined && duration > 0) {
    result.duration = duration;
    result.percent = Math.min(100, (result.time / duration) * 100);
  }

  return result;
}

/**
 * Parse FFmpeg time string format (HH:MM:SS.mmm)
 */
function parseTimeString(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+):(\d+):(\d+\.?\d*)$/);
  if (!match) return null;

  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseFloat(match[3]!);

  return hours * 3600 + minutes * 60 + seconds;
}

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Execute a command and return stdout/stderr
 */
async function execCommand(
  command: string,
  args: string[],
  spawnFn: SpawnFn = spawn
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(command, args, {
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

    proc.on('error', (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new VideoTranscodeError(`${command} not found`));
      } else {
        reject(new VideoTranscodeError(`Failed to execute ${command}: ${err.message}`));
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
 * Get video duration using ffprobe
 */
async function getVideoDuration(
  filePath: string,
  ffprobePath: string,
  spawnFn: SpawnFn = spawn
): Promise<number> {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath,
  ];

  try {
    const result = await execCommand(ffprobePath, args, spawnFn);

    if (result.exitCode !== 0) {
      return 0;
    }

    const data = JSON.parse(result.stdout) as { format?: { duration?: string } };
    const durationStr = data.format?.duration;
    return durationStr ? parseFloat(durationStr) : 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// Main Transcoding Function
// =============================================================================

/**
 * Transcode a video file to iPod-compatible format
 *
 * Converts the input video to H.264/AAC in an M4V container,
 * scaled and encoded according to the provided settings.
 *
 * @param input - Source video file path
 * @param output - Destination file path (should end in .m4v)
 * @param settings - Transcode settings (resolution, bitrate, quality)
 * @param options - Optional progress callback, abort signal, FFmpeg path
 * @returns Promise that resolves when transcoding completes
 * @throws VideoTranscodeError if transcoding fails
 *
 * @example
 * ```typescript
 * await transcodeVideo(
 *   '/movies/movie.mkv',
 *   '/output/movie.m4v',
 *   {
 *     targetWidth: 640,
 *     targetHeight: 480,
 *     targetVideoBitrate: 2000,
 *     targetAudioBitrate: 128,
 *     videoProfile: 'main',
 *     videoLevel: '3.1',
 *     crf: 21,
 *     frameRate: 30,
 *     useHardwareAcceleration: false,
 *   },
 *   {
 *     onProgress: (p) => console.log(`${p.percent.toFixed(1)}%`),
 *     signal: controller.signal,
 *   }
 * );
 * ```
 */
export async function transcodeVideo(
  input: string,
  output: string,
  settings: VideoTranscodeSettings,
  options: VideoTranscodeOptions = {}
): Promise<void> {
  const internalOptions = options as InternalTranscodeOptions;
  const ffmpegPath = options.ffmpegPath ?? DEFAULT_FFMPEG;
  const ffprobePath = options.ffprobePath ?? DEFAULT_FFPROBE;
  const spawnFn = internalOptions._spawnFn ?? spawn;

  // Check if already aborted
  if (options.signal?.aborted) {
    throw new VideoTranscodeError('Transcode aborted');
  }

  // Get input duration for progress calculation
  let duration = 0;
  if (options.onProgress) {
    duration = await getVideoDuration(input, ffprobePath, spawnFn);
  }

  // Build FFmpeg arguments
  const args = buildVideoTranscodeArgs(input, output, settings);

  return new Promise((resolve, reject) => {
    const proc = spawnFn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let progressBuffer = '';

    // Parse progress from stderr
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Buffer progress output and parse
      if (options.onProgress && duration > 0) {
        progressBuffer += chunk;

        // Try to parse progress when we have a complete line
        if (progressBuffer.includes('\n')) {
          const progress = parseVideoProgress(progressBuffer, duration);
          if (progress?.time !== undefined) {
            options.onProgress({
              time: progress.time,
              duration: progress.duration ?? duration,
              percent: progress.percent ?? 0,
              frame: progress.frame,
              speed: progress.speed,
              bitrate: progress.bitrate,
            });
          }
          // Keep only the last incomplete line
          const lastNewline = progressBuffer.lastIndexOf('\n');
          progressBuffer = progressBuffer.slice(lastNewline + 1);
        }
      }
    });

    // Ignore stdout (not used)
    proc.stdout.on('data', () => {});

    // Handle abort signal
    const abortHandler = () => {
      proc.kill('SIGTERM');
    };

    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    proc.on('error', (err: Error) => {
      options.signal?.removeEventListener('abort', abortHandler);

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new VideoTranscodeError(`FFmpeg not found: ${ffmpegPath}`));
      } else {
        reject(new VideoTranscodeError(`FFmpeg error: ${err.message}`));
      }
    });

    proc.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', abortHandler);

      // Check if killed by abort signal
      if (signal === 'SIGTERM' && options.signal?.aborted) {
        reject(new VideoTranscodeError('Transcode aborted'));
        return;
      }

      if (code !== 0) {
        // Extract a meaningful error message from stderr
        const errorMessage = extractFFmpegError(stderr) ||
          `FFmpeg exited with code ${code}`;
        reject(new VideoTranscodeError(errorMessage, code ?? undefined, stderr));
        return;
      }

      resolve();
    });
  });
}

/**
 * Extract a meaningful error message from FFmpeg stderr
 */
function extractFFmpegError(stderr: string): string | null {
  // Look for common error patterns
  const patterns = [
    /Error.*: (.+)/i,
    /Invalid (.+)/i,
    /No such file or directory/i,
    /does not contain any stream/i,
    /Conversion failed/i,
  ];

  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}
