/**
 * iPod model numbers for test environments.
 *
 * Model numbers like "MA147" identify specific iPod hardware variants,
 * distinct from the IpodModel enum in libgpod-node which represents
 * color variants like 'color', 'mini_blue', etc.
 *
 * @see docs/IPOD-INTERNALS.md for full model list
 */
export type IpodModelNumber =
  | 'MA147' // iPod Video 60GB (5th gen) - default
  | 'MA002' // iPod Video 30GB (5th gen)
  | 'MB565' // iPod Classic 120GB (6th gen)
  | 'MA477' // iPod Nano 2GB (2nd gen)
  | string; // Allow other model numbers

/**
 * Options for creating a test iPod.
 */
export interface CreateTestIpodOptions {
  /**
   * iPod model number.
   * @default 'MA147' (iPod Video 60GB)
   */
  model?: IpodModelNumber;

  /**
   * Display name for the iPod.
   * @default 'Test iPod'
   */
  name?: string;

  /**
   * Custom path for the test iPod. If not provided, a temp directory is created.
   */
  path?: string;
}

/**
 * A test iPod instance with cleanup capability.
 */
export interface TestIpod {
  /** Absolute path to the test iPod directory */
  readonly path: string;

  /** Model number used */
  readonly model: IpodModelNumber;

  /** iPod display name */
  readonly name: string;

  /**
   * Clean up the test iPod (delete directory).
   * Safe to call multiple times.
   */
  cleanup(): Promise<void>;
}

/**
 * Device information returned by gpod-tool info.
 */
export interface TestDeviceInfo {
  modelNumber: string | null;
  modelName: string;
  supportsArtwork: boolean;
  supportsVideo: boolean;
}

/**
 * Database information returned by gpod-tool info.
 */
export interface DatabaseInfo {
  path: string;
  device: TestDeviceInfo;
  trackCount: number;
  playlistCount: number;
}

/**
 * Track metadata for adding to test iPod.
 */
export interface TrackInput {
  title: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  durationMs?: number;
  bitrate?: number;
  sampleRate?: number;
}

/**
 * Track information returned by gpod-tool tracks.
 */
export interface TrackInfo {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  trackNumber: number;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  size: number;
  hasArtwork: boolean;
}

/**
 * Result of adding a track.
 */
export interface AddTrackResult {
  trackId: number;
  title: string;
  artist: string | null;
  album: string | null;
}

/**
 * Result of verification.
 */
export interface VerifyResult {
  valid: boolean;
  path: string;
  trackCount: number;
  playlistCount: number;
  error?: string;
}
