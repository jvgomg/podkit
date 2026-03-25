/**
 * DeviceAdapter interface and DeviceTrack type
 *
 * Provides a generic abstraction over device-specific database implementations
 * (iPod, mass-storage DAPs, etc.). The sync engine works against this interface
 * rather than directly referencing IpodDatabase or IPodTrack.
 *
 * Design principle: thin interface, fat implementations. The interface covers
 * track CRUD + save/close + capabilities. Device-specific concerns (folder
 * structure, database management, artwork) are handled internally by each
 * implementation.
 *
 * @module
 */

import type { DeviceCapabilities } from './capabilities.js';

// =============================================================================
// DeviceTrack
// =============================================================================

/**
 * Metadata fields for creating or updating a track on a device.
 *
 * Maps to the subset of fields the sync engine needs to write.
 * Device-specific fields (iPod media type flags, ithmb artwork, etc.)
 * are handled by the adapter implementation.
 */
export interface DeviceTrackInput {
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;
  grouping?: string;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  size?: number;
  bpm?: number;
  soundcheck?: number;
  filetype?: string;
  mediaType?: number;
  compilation?: boolean;
  rating?: number;
  playCount?: number;
  skipCount?: number;

  // Video-specific fields
  tvShow?: string;
  tvEpisode?: string;
  sortTvShow?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  movieFlag?: boolean;
}

/**
 * Subset of metadata fields that can be updated on an existing track.
 */
export type DeviceTrackMetadata = Partial<DeviceTrackInput>;

/**
 * A track on the device, as seen by the sync engine.
 *
 * Combines track metadata (identity, matching fields, format info, sync
 * state) with operations (update, remove, copy, artwork). This matches
 * the pattern where a track object is both a data carrier and an
 * operation handle bound to the device database.
 *
 * Device-specific fields (iPod mediaType flags, ithmb references) stay
 * on the device-specific track type. The adapter maps between them.
 *
 * IPodTrack satisfies this interface naturally — the adapter can return
 * IPodTrack instances directly without mapping.
 */
export interface DeviceTrack {
  // Identity
  readonly filePath: string;

  // Core metadata (used by matcher/differ)
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist?: string;
  readonly genre?: string;
  readonly composer?: string;
  readonly comment?: string;

  // Track/disc info
  readonly trackNumber?: number;
  readonly discNumber?: number;
  readonly year?: number;

  // Technical info (used by differ/planner for format decisions)
  readonly duration: number;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly size: number;
  readonly filetype?: string;
  readonly soundcheck?: number;

  // Flags
  readonly hasArtwork: boolean;
  readonly hasFile: boolean;
  readonly compilation: boolean;
  readonly mediaType: number;

  // Video-specific
  readonly tvShow?: string;
  readonly tvEpisode?: string;
  readonly seasonNumber?: number;
  readonly episodeNumber?: number;
  readonly movieFlag?: boolean;

  // Operations (device-specific implementation)
  update(fields: DeviceTrackMetadata): DeviceTrack;
  remove(options?: { keepFile?: boolean }): void;
  copyFile(sourcePath: string): DeviceTrack;
  setArtwork(imagePath: string): DeviceTrack;
  setArtworkFromData(imageData: Buffer): DeviceTrack;
  removeArtwork(): DeviceTrack;
}

// =============================================================================
// DeviceAdapter
// =============================================================================

/**
 * Generic interface for device database operations.
 *
 * The sync engine calls these methods instead of IpodDatabase directly.
 * Each device type (iPod, mass-storage DAP, etc.) provides its own
 * implementation.
 *
 * The adapter owns the device database lifecycle: open is handled before
 * construction, save() persists changes, close() releases resources.
 */
export interface DeviceAdapter {
  /** Device capabilities (codec support, artwork handling, etc.) */
  readonly capabilities: DeviceCapabilities;

  /** Mount point or root path of the device */
  readonly mountPoint: string;

  // Track lifecycle

  /** Get all tracks currently on the device */
  getTracks(): DeviceTrack[];

  /** Add a new track to the device database */
  addTrack(input: DeviceTrackInput): DeviceTrack;

  /** Update metadata on an existing track */
  updateTrack(track: DeviceTrack, fields: DeviceTrackMetadata): DeviceTrack;

  /** Remove a track from the device database */
  removeTrack(track: DeviceTrack, options?: { deleteFile?: boolean }): void;

  /** Replace the audio file of an existing track (for upgrades/re-transcodes) */
  replaceTrackFile(track: DeviceTrack, newFilePath: string): DeviceTrack;

  // Persistence

  /** Save all pending changes to the device database */
  save(): Promise<void>;

  /** Close the database and release resources */
  close(): void;
}
