/**
 * Low-level wrapper around the gpod-tool CLI.
 *
 * These functions shell out to gpod-tool and parse JSON responses.
 * For test utilities, use the higher-level functions in test-ipod.ts.
 *
 * @module
 */

import { $ } from 'bun';
import type {
  IpodModelNumber,
  DatabaseInfo,
  TrackInfo,
  TrackInput,
  AddTrackResult,
  VerifyResult,
} from './types';

/**
 * Error thrown when gpod-tool command fails.
 */
export class GpodToolError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'GpodToolError';
  }
}

/**
 * Run gpod-tool command and parse JSON response.
 * @internal
 */
async function runGpodTool<T>(args: string[], errorContext: string): Promise<T> {
  const command = `gpod-tool ${args.join(' ')}`;
  const result = await $`gpod-tool ${args}`.nothrow().quiet();
  const stdout = result.stdout.toString();

  let json: T & { success?: boolean; valid?: boolean; error?: string };
  try {
    // libgpod's sqlite generation (for Nano 5+) writes directly to stdout,
    // so we extract the JSON object from the output (noise always precedes it)
    const jsonStart = stdout.indexOf('{\n');
    const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
    json = JSON.parse(jsonStr);
  } catch {
    throw new GpodToolError(
      `Failed to parse gpod-tool output: ${errorContext}`,
      command,
      result.exitCode,
      result.stderr.toString()
    );
  }

  // Check for explicit failure (success: false)
  if ('success' in json && json.success === false) {
    throw new GpodToolError(
      json.error ?? 'Unknown error',
      command,
      result.exitCode,
      result.stderr.toString()
    );
  }

  return json;
}

/**
 * Check if gpod-tool is available in PATH.
 */
export async function isGpodToolAvailable(): Promise<boolean> {
  try {
    const result = await $`gpod-tool --version`.nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get gpod-tool version.
 */
export async function getGpodToolVersion(): Promise<string> {
  const result = await $`gpod-tool --version`.text();
  return result.trim();
}

/**
 * Initialize a new iPod database structure.
 *
 * @param path - Directory path for the iPod (will be created if needed)
 * @param options - Model and name options
 * @returns Path to the created iPod
 * @throws {GpodToolError} If initialization fails
 */
export async function init(
  path: string,
  options: { model?: IpodModelNumber; name?: string; firewireId?: string } = {}
): Promise<{ path: string; model: string; name: string }> {
  const args: string[] = ['init', path, '--json'];

  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.name) {
    args.push('--name', options.name);
  }
  if (options.firewireId) {
    args.push('--firewire-id', options.firewireId);
  }

  const json = await runGpodTool<{
    success: boolean;
    path: string;
    model: string;
    name: string;
  }>(args, `init ${path}`);

  return {
    path: json.path,
    model: json.model,
    name: json.name,
  };
}

/**
 * Get information about an iPod database.
 *
 * @param path - Path to the iPod directory
 * @returns Database information
 * @throws {GpodToolError} If reading fails
 */
export async function info(path: string): Promise<DatabaseInfo> {
  const json = await runGpodTool<{
    success: boolean;
    path: string;
    device: {
      model_number: string | null;
      model_name: string;
      supports_artwork: boolean;
      supports_video: boolean;
    };
    track_count: number;
    playlist_count: number;
  }>(['info', path, '--json'], `info ${path}`);

  return {
    path: json.path,
    device: {
      modelNumber: json.device.model_number,
      modelName: json.device.model_name,
      supportsArtwork: json.device.supports_artwork,
      supportsVideo: json.device.supports_video,
    },
    trackCount: json.track_count,
    playlistCount: json.playlist_count,
  };
}

/**
 * List all tracks in an iPod database.
 *
 * @param path - Path to the iPod directory
 * @returns Array of track information
 * @throws {GpodToolError} If reading fails
 */
export async function tracks(path: string): Promise<TrackInfo[]> {
  const json = await runGpodTool<{
    success: boolean;
    tracks: Array<{
      id: number;
      title: string;
      artist: string | null;
      album: string | null;
      track_number: number;
      duration_ms: number;
      bitrate: number;
      sample_rate: number;
      size: number;
      has_artwork: boolean;
    }>;
  }>(['tracks', path, '--json'], `tracks ${path}`);

  return json.tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    trackNumber: t.track_number,
    durationMs: t.duration_ms,
    bitrate: t.bitrate,
    sampleRate: t.sample_rate,
    size: t.size,
    hasArtwork: t.has_artwork,
  }));
}

/**
 * Add a track to an iPod database (metadata only, no file copy).
 *
 * @param path - Path to the iPod directory
 * @param track - Track metadata
 * @returns Added track information
 * @throws {GpodToolError} If adding fails
 */
export async function addTrack(path: string, track: TrackInput): Promise<AddTrackResult> {
  const args: string[] = ['add-track', path, '--json', '--title', track.title];

  if (track.artist) {
    args.push('--artist', track.artist);
  }
  if (track.album) {
    args.push('--album', track.album);
  }
  if (track.trackNumber !== undefined) {
    args.push('--track-num', String(track.trackNumber));
  }
  if (track.durationMs !== undefined) {
    args.push('--duration', String(track.durationMs));
  }
  if (track.bitrate !== undefined) {
    args.push('--bitrate', String(track.bitrate));
  }
  if (track.sampleRate !== undefined) {
    args.push('--sample-rate', String(track.sampleRate));
  }

  const json = await runGpodTool<{
    success: boolean;
    track_id: number;
    title: string;
    artist: string | null;
    album: string | null;
  }>(args, `add-track ${path}`);

  return {
    trackId: json.track_id,
    title: json.title,
    artist: json.artist,
    album: json.album,
  };
}

/**
 * Verify an iPod database can be parsed.
 *
 * @param path - Path to the iPod directory
 * @returns Verification result (does not throw on invalid database)
 */
export async function verify(path: string): Promise<VerifyResult> {
  const result = await $`gpod-tool verify ${path} --json`.nothrow().quiet();
  const stdout = result.stdout.toString();

  let json: {
    valid: boolean;
    path?: string;
    track_count?: number;
    playlist_count?: number;
    error?: string;
  };

  try {
    json = JSON.parse(stdout);
  } catch {
    return {
      valid: false,
      path: path,
      trackCount: 0,
      playlistCount: 0,
      error: `Failed to parse output: ${stdout}`,
    };
  }

  if (json.valid) {
    return {
      valid: true,
      path: json.path ?? path,
      trackCount: json.track_count ?? 0,
      playlistCount: json.playlist_count ?? 0,
    };
  } else {
    return {
      valid: false,
      path: path,
      trackCount: 0,
      playlistCount: 0,
      error: json.error,
    };
  }
}
