/**
 * Video probe - Analyze video files using ffprobe
 *
 * Extracts codec, resolution, bitrate, and other technical metadata
 * from video files to support compatibility checking and transcoding decisions.
 */

import { spawn } from 'node:child_process';
import type { VideoSourceAnalysis } from './types.js';

/**
 * Default FFprobe binary name
 */
const DEFAULT_FFPROBE = 'ffprobe';

/**
 * Error thrown when video probing fails
 */
export class VideoProbeError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'VideoProbeError';
  }
}

/**
 * FFprobe JSON output format types
 */
export interface FFprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
}

export interface FFprobeStream {
  codec_type?: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  bit_rate?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
}

export interface FFprobeOutput {
  format?: FFprobeFormat;
  streams?: FFprobeStream[];
}

/**
 * Spawn function type for dependency injection
 */
export type SpawnFn = typeof spawn;

/**
 * Configuration for the video probe
 */
export interface VideoProbeConfig {
  /** Override FFprobe binary path */
  ffprobePath?: string;
  /** Custom spawn function for testing */
  _spawnFn?: SpawnFn;
}

/**
 * Parse a frame rate string (e.g., "24000/1001" or "30/1") into fps
 */
function parseFrameRate(frameRateStr: string | undefined): number {
  if (!frameRateStr) return 0;

  const parts = frameRateStr.split('/');
  if (parts.length === 2) {
    const num = parseInt(parts[0]!, 10);
    const den = parseInt(parts[1]!, 10);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  // Try parsing as a plain number
  const parsed = parseFloat(frameRateStr);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse H.264 level from ffprobe level number
 *
 * FFprobe returns level as an integer (e.g., 30 for level 3.0, 31 for level 3.1)
 */
function parseH264Level(level: number | undefined): string | null {
  if (level === undefined || level <= 0) return null;

  // Level is reported as integer * 10 (e.g., 31 = 3.1)
  const major = Math.floor(level / 10);
  const minor = level % 10;
  return `${major}.${minor}`;
}

/**
 * Extract container format from ffprobe format_name
 *
 * format_name can be a comma-separated list (e.g., "mov,mp4,m4a,3gp,3g2,mj2")
 * We return the most specific/common name.
 */
function parseContainerFormat(formatName: string | undefined): string {
  if (!formatName) return 'unknown';

  // Common mappings for multi-name formats
  const formatMap: Record<string, string> = {
    'mov,mp4,m4a,3gp,3g2,mj2': 'mp4',
    'matroska,webm': 'mkv',
    'mpegts': 'ts',
    'mpeg': 'mpg',
    'avi': 'avi',
    'asf': 'wmv',
  };

  // Check for known multi-format strings
  if (formatMap[formatName]) {
    return formatMap[formatName]!;
  }

  // Take the first format name if comma-separated
  const first = formatName.split(',')[0];
  return first ?? 'unknown';
}

/**
 * Execute ffprobe and return stdout/stderr
 */
async function execFFprobe(
  ffprobePath: string,
  args: string[],
  spawnFn: SpawnFn = spawn
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(ffprobePath, args, {
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
        reject(new VideoProbeError(`ffprobe not found: ${ffprobePath}`));
      } else {
        reject(new VideoProbeError(`Failed to execute ffprobe: ${err.message}`));
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
 * Probe a video file to extract technical metadata
 *
 * Uses ffprobe to analyze the video file and extract:
 * - Container format
 * - Video codec, profile, level, resolution, bitrate, frame rate
 * - Audio codec, bitrate, channels, sample rate
 * - Duration
 * - Stream presence flags
 *
 * @param filePath - Path to the video file to analyze
 * @param config - Optional configuration (ffprobe path)
 * @returns Promise resolving to VideoSourceAnalysis
 * @throws VideoProbeError if probing fails
 *
 * @example
 * ```typescript
 * const analysis = await probeVideo('/path/to/video.mkv');
 * console.log(`Resolution: ${analysis.width}x${analysis.height}`);
 * console.log(`Video codec: ${analysis.videoCodec}`);
 * ```
 */
export async function probeVideo(
  filePath: string,
  config: VideoProbeConfig = {}
): Promise<VideoSourceAnalysis> {
  const ffprobePath = config.ffprobePath ?? DEFAULT_FFPROBE;
  const spawnFn = config._spawnFn ?? spawn;

  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const result = await execFFprobe(ffprobePath, args, spawnFn);

  if (result.exitCode !== 0) {
    // Check for common error patterns
    if (result.stderr.includes('No such file or directory')) {
      throw new VideoProbeError(
        `File not found: ${filePath}`,
        result.exitCode,
        result.stderr
      );
    }
    if (result.stderr.includes('Invalid data found') ||
        result.stderr.includes('invalid data') ||
        result.stderr.includes('moov atom not found')) {
      throw new VideoProbeError(
        `Corrupt or invalid video file: ${filePath}`,
        result.exitCode,
        result.stderr
      );
    }
    throw new VideoProbeError(
      `ffprobe failed with exit code ${result.exitCode}`,
      result.exitCode,
      result.stderr
    );
  }

  // Parse JSON output
  let data: FFprobeOutput;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new VideoProbeError(
      'Failed to parse ffprobe JSON output',
      undefined,
      result.stdout
    );
  }

  // Find video and audio streams
  const streams = data.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const format = data.format ?? {};

  // Extract container format
  const container = parseContainerFormat(format.format_name);

  // Extract duration (from format, in seconds)
  const duration = parseFloat(format.duration ?? '0');

  // Video stream analysis
  const hasVideoStream = videoStream !== undefined;
  const videoCodec = videoStream?.codec_name ?? '';
  const videoProfile = videoStream?.profile?.toLowerCase() ?? null;
  const videoLevel = parseH264Level(videoStream?.level);
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;

  // Video bitrate: prefer stream bitrate, fall back to calculating from format
  let videoBitrate = 0;
  if (videoStream?.bit_rate) {
    videoBitrate = Math.round(parseInt(videoStream.bit_rate, 10) / 1000);
  } else if (format.bit_rate && !audioStream?.bit_rate) {
    // If only video stream and no stream bitrate, use format bitrate
    videoBitrate = Math.round(parseInt(format.bit_rate, 10) / 1000);
  } else if (format.bit_rate && audioStream?.bit_rate) {
    // Estimate video bitrate by subtracting audio from total
    const totalBitrate = parseInt(format.bit_rate, 10);
    const audioBitrateVal = parseInt(audioStream.bit_rate, 10);
    videoBitrate = Math.round((totalBitrate - audioBitrateVal) / 1000);
  }

  // Frame rate: prefer avg_frame_rate, fall back to r_frame_rate
  const frameRate = parseFrameRate(videoStream?.avg_frame_rate) ||
                    parseFrameRate(videoStream?.r_frame_rate);

  // Audio stream analysis
  const hasAudioStream = audioStream !== undefined;
  const audioCodec = audioStream?.codec_name ?? '';
  const audioBitrate = audioStream?.bit_rate
    ? Math.round(parseInt(audioStream.bit_rate, 10) / 1000)
    : 0;
  const audioChannels = audioStream?.channels ?? 0;
  const audioSampleRate = audioStream?.sample_rate
    ? parseInt(audioStream.sample_rate, 10)
    : 0;

  return {
    filePath,
    container,
    videoCodec,
    videoProfile,
    videoLevel,
    width,
    height,
    videoBitrate,
    frameRate,
    audioCodec,
    audioBitrate,
    audioChannels,
    audioSampleRate,
    duration,
    hasVideoStream,
    hasAudioStream,
  };
}
