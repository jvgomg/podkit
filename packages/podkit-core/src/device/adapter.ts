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

import type { DeviceCapabilities } from '@podkit/device-types';
import type { SyncTagData, SyncTagUpdate } from '../metadata/sync-tags.js';
import type { AudioNormalization } from '../metadata/normalization.js';
import type { TransferMode } from '../transcode/types.js';

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
  /** Audio normalization data */
  normalization?: AudioNormalization;
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

  /**
   * The effective transfer mode for this sync.
   *
   * Adapters consult it on `addTrack` to decide whether to mirror the
   * input metadata into the on-disk file tags. Mass-storage always writes
   * tags; iPod writes tags only under `portable`.
   */
  transferMode?: TransferMode;
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

  /**
   * The effective transfer mode for this sync.
   *
   * Adapters use this to decide whether to write metadata into the on-disk
   * file tags (in addition to whatever device-side database they own).
   *
   * - Mass-storage: always writes file tags regardless of mode (firmware
   *   reads tags directly), so this field is informational only.
   * - iPod: writes file tags only when transferMode === 'portable'. For
   *   `fast` and `optimized` the iTunesDB is authoritative and the
   *   underlying file is left untouched.
   */
  transferMode?: TransferMode;
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
  readonly normalization?: AudioNormalization;

  // Flags
  readonly hasArtwork: boolean;
  readonly hasFile: boolean;
  readonly compilation: boolean;
  readonly mediaType: number;

  // Sync tag (parsed from device-specific storage, e.g. comment field)
  readonly syncTag: SyncTagData | null;

  /**
   * Where this device stores artwork for this track. The pipeline uses this
   * to pick the correct write path AND to decide whether claiming success
   * via `syncTag.artworkHash` is honest:
   *
   *   - `'database'` → `setArtworkFromData` writes the bytes into a device-
   *     side database (e.g. iPod iTunesDB / ArtworkDB).
   *   - `'embedded'` → `updateTrack({ embeddedPictureData })` routes through
   *     the mass-storage tag writer (node-taglib-sharp) and embeds the
   *     picture in the file body.
   *   - `'sidecar'`  → a peer image (e.g. `cover.jpg`) is the device's
   *     artwork. The write path is not yet implemented; the pipeline treats
   *     this as a noop until a follow-up adds `writeSidecar()`.
   *   - `'noop'`     → device has no artwork support (empty
   *     `artworkSources`). The pipeline must skip BOTH the write AND the
   *     `syncTag.artworkHash` write — claiming success when no bytes landed
   *     causes the next sync to re-fire `artwork-added` on every track (the
   *     churn loop documented in doc-041 §3.6).
   *
   * Derived from device capabilities at track-construction time. Per-device,
   * not per-track: every track from the same adapter instance carries the
   * same value (mass-storage's `artworkSources[0]` is device-level).
   */
  readonly artworkSink: 'database' | 'embedded' | 'sidecar' | 'noop';

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
