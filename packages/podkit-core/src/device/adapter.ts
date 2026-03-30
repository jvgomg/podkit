/**
 * DeviceAdapter interface and DeviceTrack type
 *
 * Provides a generic abstraction over device-specific database implementations
 * (iPod, mass-storage DAPs, etc.). The sync engine works against this interface
 * rather than directly referencing IpodDatabase or IpodTrack.
 *
 * Design principle: thin interface, fat implementations. The interface covers
 * track CRUD + save/close + capabilities. Device-specific concerns (folder
 * structure, database management, artwork) are handled internally by each
 * implementation.
 *
 * @module
 */

import type { DeviceCapabilities } from './capabilities.js';
import type { SyncTagData, SyncTagUpdate } from '../metadata/sync-tags.js';

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
  /** Raw ReplayGain track gain in dB — passed through to mass-storage tag writer */
  replayGainTrackGain?: number;
  /** Raw ReplayGain track peak (linear) — passed through to mass-storage tag writer */
  replayGainTrackPeak?: number;
  filetype?: string;
  mediaType?: number;
  compilation?: boolean;
  rating?: number;
  playCount?: number;
  skipCount?: number;

  // Sync tag (adapter-managed, written to device-specific storage)
  syncTag?: SyncTagData;

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
 *
 * Extends DeviceTrackInput with write-control flags for device-specific behavior.
 */
export type DeviceTrackMetadata = Partial<DeviceTrackInput> & {
  /**
   * Force writing ReplayGain tags to the file, even if soundcheck hasn't changed.
   *
   * Used after transcoding to ensure M4A files (where FFmpeg can't write ReplayGain
   * metadata) get tags via the tag writer. Not needed for direct-copy operations
   * where the source file already has correct tags.
   *
   * Only meaningful for mass-storage devices with audioNormalization: 'replaygain'.
   * Ignored by iPod adapter (which uses the iTunesDB soundcheck field).
   */
  writeReplayGainTags?: boolean;

  /**
   * Artwork image data to embed in the audio file via the tag writer.
   *
   * Used for OGG/Opus files where FFmpeg cannot embed artwork (upstream limitation).
   * The pipeline extracts and optionally resizes artwork, then passes the buffer here
   * for post-processing via node-taglib-sharp.
   *
   * Only meaningful for mass-storage devices with artworkSources: ['embedded'].
   * Ignored by iPod adapter (which uses ithmb artwork).
   */
  embeddedPictureData?: Buffer;
};

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
 * IpodTrack extends this interface — the adapter can return IpodTrack
 * instances directly without mapping or casting.
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

  // Sync tag (parsed from device-specific storage, e.g. comment field)
  readonly syncTag: SyncTagData | null;

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
export interface DeviceAdapter<T extends DeviceTrack = DeviceTrack> {
  /** Device capabilities (codec support, artwork handling, etc.) */
  readonly capabilities: DeviceCapabilities;

  /** Mount point or root path of the device */
  readonly mountPoint: string;

  // Track lifecycle

  /** Get all tracks currently on the device */
  getTracks(): T[];

  /** Add a new track to the device database */
  addTrack(input: DeviceTrackInput): T;

  /** Update metadata on an existing track */
  updateTrack(track: T, fields: DeviceTrackMetadata): T;

  /** Remove a track from the device database */
  removeTrack(track: T, options?: { deleteFile?: boolean }): void;

  /** Copy a source file to the track's allocated path on the device */
  copyTrackFile(track: T, sourcePath: string): T;

  /** Replace the audio file of an existing track (for upgrades/re-transcodes) */
  replaceTrackFile(track: T, newFilePath: string): T;

  /** Remove artwork from a track */
  removeTrackArtwork(track: T): T;

  // Sync tags

  /** Write or update sync tag on a track (merge semantics) */
  writeSyncTag(track: T, update: SyncTagUpdate): T;

  /** Remove sync tag from a track */
  clearSyncTag(track: T): T;

  // Persistence

  /** Save all pending changes to the device database */
  save(): Promise<void>;

  /** Close the database and release resources */
  close(): void;
}
