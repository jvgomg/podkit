/**
 * MassStorageAdapter — DeviceAdapter for file-based music players
 *
 * Implements the DeviceAdapter interface for mass-storage DAPs (Echo Mini,
 * Rockbox, generic DAPs). Unlike iPod (proprietary database via libgpod),
 * mass-storage devices use a plain filesystem:
 *
 * - "Adding a track" = allocating a path + copying a file
 * - "Removing a track" = deleting a file
 * - Metadata lives in file tags, not a separate database
 * - The manifest (.podkit/state.json) tracks which files podkit manages
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as mm from 'music-metadata';

import type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './adapter.js';
import type { DeviceCapabilities } from './capabilities.js';
import type { SyncTagData, SyncTagUpdate } from '../metadata/sync-tags.js';
import { parseSyncTag, writeSyncTag } from '../metadata/sync-tags.js';
import {
  DEFAULT_CONTENT_PATHS,
  PODKIT_DIR,
  MANIFEST_FILE,
  generateTrackPath,
  generateVideoPath,
  deduplicatePath,
  isAudioExtension,
  isVideoExtension,
  createEmptyManifest,
  normalizeContentPaths,
  validateContentPaths,
  type MassStorageManifest,
  type ContentPaths,
} from './mass-storage-utils.js';
import { isVideoMediaType } from '../ipod/video.js';
import { CODEC_METADATA } from '../transcode/codecs.js';
import { TagLibTagWriter, type TagWriter } from './mass-storage-tag-writer.js';
import type { AudioNormalization } from '../metadata/normalization.js';
import {
  soundcheckToReplayGainDb,
  replayGainToSoundcheck,
  normalizationToSoundcheck,
} from '../metadata/normalization.js';

// =============================================================================
// Types
// =============================================================================

/** Options for the metadata reader function (injectable for testing) */
export interface MetadataReaderOptions {
  skipCovers?: boolean;
  duration?: boolean;
}

/**
 * Result from the metadata reader, containing the subset of fields
 * that MassStorageAdapter needs.
 */
export interface MetadataReaderResult {
  common: {
    title?: string;
    artist?: string;
    album?: string;
    albumartist?: string;
    genre?: string[];
    composer?: string[];
    comment?: Array<string | { text?: string }>;
    grouping?: string;
    track?: { no: number | null; of: number | null };
    disk?: { no: number | null; of: number | null };
    year?: number;
    compilation?: boolean;
    picture?: Array<{ data: Buffer }>;
    replaygain_track_gain?: { dB: number; ratio?: number };
    replaygain_track_peak?: { ratio: number };
    replaygain_album_gain?: { dB: number; ratio?: number };
    replaygain_album_peak?: { ratio: number };
  };
  format: {
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    codec?: string;
  };
}

/**
 * Function signature for reading audio metadata from a file.
 * Defaults to music-metadata's parseFile, but can be overridden in tests.
 */
export type MetadataReader = (
  filePath: string,
  options?: MetadataReaderOptions
) => Promise<MetadataReaderResult>;

/** Options for MassStorageAdapter.open() */
export interface MassStorageAdapterOptions {
  /** Override the metadata reader (for testing) */
  metadataReader?: MetadataReader;
  /** Override the tag writer (for testing) */
  tagWriter?: TagWriter;
  /** Override content directory paths */
  contentPaths?: Partial<ContentPaths>;
  /** @deprecated Use contentPaths.musicDir instead */
  musicDir?: string;
}

// =============================================================================
// MassStorageTrack
// =============================================================================

/**
 * A track on a mass-storage device.
 *
 * Implements DeviceTrack with filesystem-backed operations.
 * Metadata is read from file tags at construction time.
 */
export class MassStorageTrack implements DeviceTrack {
  // Identity
  readonly filePath: string;

  // Core metadata
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
  readonly totalDiscs?: number;
  readonly year?: number;

  // Technical info
  readonly duration: number;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly size: number;
  readonly filetype?: string;
  readonly normalization?: AudioNormalization;

  /** Soundcheck value derived from normalization data (for DeviceTrack interface compat) */
  get soundcheck(): number | undefined {
    return this.normalization ? normalizationToSoundcheck(this.normalization) : undefined;
  }

  // Flags
  readonly hasArtwork: boolean;
  readonly hasFile: boolean;
  readonly compilation: boolean;
  readonly mediaType: number;

  // Sync tag (parsed from comment)
  readonly syncTag: SyncTagData | null;

  // Video-specific (not used for audio-only devices, but required by interface)
  readonly tvShow?: string;
  readonly tvEpisode?: string;
  readonly seasonNumber?: number;
  readonly episodeNumber?: number;
  readonly movieFlag?: boolean;

  // Implementation-specific
  /** Whether this file was placed by podkit (tracked in manifest) */
  readonly managed: boolean;

  /** Absolute path to the device mount point */
  private readonly mountPoint: string;

  /** Content path roots for empty directory cleanup */
  private readonly contentRoots: string[];

  constructor(opts: {
    mountPoint: string;
    filePath: string;
    contentRoots?: string[];
    title: string;
    artist: string;
    album: string;
    albumArtist?: string;
    genre?: string;
    composer?: string;
    comment?: string;
    trackNumber?: number;
    discNumber?: number;
    totalDiscs?: number;
    year?: number;
    duration: number;
    bitrate: number;
    sampleRate: number;
    size: number;
    filetype?: string;
    normalization?: AudioNormalization;
    hasArtwork: boolean;
    hasFile: boolean;
    compilation: boolean;
    mediaType?: number;
    managed: boolean;
  }) {
    this.mountPoint = opts.mountPoint;
    this.contentRoots = opts.contentRoots ?? [DEFAULT_CONTENT_PATHS.musicDir];
    this.filePath = opts.filePath;
    this.title = opts.title;
    this.artist = opts.artist;
    this.album = opts.album;
    this.albumArtist = opts.albumArtist;
    this.genre = opts.genre;
    this.composer = opts.composer;
    this.comment = opts.comment;
    this.trackNumber = opts.trackNumber;
    this.discNumber = opts.discNumber;
    this.totalDiscs = opts.totalDiscs;
    this.year = opts.year;
    this.duration = opts.duration;
    this.bitrate = opts.bitrate;
    this.sampleRate = opts.sampleRate;
    this.size = opts.size;
    this.filetype = opts.filetype;
    this.normalization = opts.normalization;
    this.hasArtwork = opts.hasArtwork;
    this.hasFile = opts.hasFile;
    this.compilation = opts.compilation ?? false;
    this.mediaType = opts.mediaType ?? 1; // 1 = audio
    this.managed = opts.managed;
    this.syncTag = parseSyncTag(this.comment);
  }

  /**
   * Update in-memory metadata fields, returning a new track instance.
   *
   * Callers should use `adapter.updateTrack()` rather than calling this
   * directly — the adapter intercepts comment changes and queues them
   * for persistence via the tag writer during save().
   */
  update(fields: DeviceTrackMetadata): MassStorageTrack {
    return new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.contentRoots,
      filePath: this.filePath,
      title: fields.title ?? this.title,
      artist: fields.artist ?? this.artist,
      album: fields.album ?? this.album,
      albumArtist: fields.albumArtist ?? this.albumArtist,
      genre: fields.genre ?? this.genre,
      composer: fields.composer ?? this.composer,
      comment: fields.comment ?? this.comment,
      trackNumber: fields.trackNumber ?? this.trackNumber,
      discNumber: fields.discNumber ?? this.discNumber,
      totalDiscs: this.totalDiscs,
      year: fields.year ?? this.year,
      duration: fields.duration ?? this.duration,
      bitrate: fields.bitrate ?? this.bitrate,
      sampleRate: fields.sampleRate ?? this.sampleRate,
      size: fields.size ?? this.size,
      filetype: fields.filetype ?? this.filetype,
      normalization: fields.normalization ?? this.normalization,
      hasArtwork: this.hasArtwork,
      hasFile: this.hasFile,
      compilation: fields.compilation ?? this.compilation,
      mediaType: fields.mediaType ?? this.mediaType,
      managed: this.managed,
    });
  }

  /**
   * Remove the track's file from disk.
   * Also removes empty parent directories up to the Music/ or Video/ boundary.
   */
  remove(options?: { keepFile?: boolean }): void {
    if (options?.keepFile) {
      return;
    }

    const absolutePath = path.join(this.mountPoint, this.filePath);

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Clean up empty parent directories up to the content root
    const matchedRoot = this.contentRoots
      .map((r) => (r ? path.join(this.mountPoint, r) : this.mountPoint))
      .filter((r) => absolutePath.startsWith(r + '/') || absolutePath.startsWith(r + path.sep))
      .sort((a, b) => b.length - a.length)[0];
    if (!matchedRoot) return;
    const contentRoot = matchedRoot;
    let dir = path.dirname(absolutePath);
    while (dir !== contentRoot && dir.startsWith(contentRoot) && dir !== this.mountPoint) {
      try {
        const entries = fs.readdirSync(dir);
        if (entries.length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }

  /**
   * Copy a source file to this track's allocated path on the device.
   * Creates parent directories if needed.
   */
  copyFile(sourcePath: string): MassStorageTrack {
    const absolutePath = path.join(this.mountPoint, this.filePath);
    const dir = path.dirname(absolutePath);

    // Create parent directories
    fs.mkdirSync(dir, { recursive: true });

    // Copy the file
    fs.copyFileSync(sourcePath, absolutePath);

    // Update size from the copied file
    const stats = fs.statSync(absolutePath);

    return new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.contentRoots,
      filePath: this.filePath,
      title: this.title,
      artist: this.artist,
      album: this.album,
      albumArtist: this.albumArtist,
      genre: this.genre,
      composer: this.composer,
      comment: this.comment,
      trackNumber: this.trackNumber,
      discNumber: this.discNumber,
      totalDiscs: this.totalDiscs,
      year: this.year,
      duration: this.duration,
      bitrate: this.bitrate,
      sampleRate: this.sampleRate,
      size: stats.size,
      filetype: this.filetype,
      normalization: this.normalization,
      hasArtwork: this.hasArtwork,
      hasFile: true,
      compilation: this.compilation,
      mediaType: this.mediaType,
      managed: this.managed,
    });
  }

  /**
   * Set artwork on the track.
   *
   * No-op for mass-storage devices — artwork embedding is handled by the
   * FFmpeg pipeline for most formats, and by the tag writer (via
   * embeddedPictureData in updateTrack) for OGG containers where FFmpeg
   * can't embed. Unlike iPod, which stores artwork in a separate database,
   * mass-storage devices read artwork directly from embedded tags.
   */
  setArtwork(_imagePath: string): MassStorageTrack {
    return this;
  }

  /**
   * Set artwork from raw image data.
   *
   * No-op — see setArtwork() for rationale.
   */
  setArtworkFromData(_imageData: Buffer): MassStorageTrack {
    return this;
  }

  /**
   * Remove artwork from the track.
   *
   * No-op — mass-storage devices with embedded artwork as their primary
   * source should never have artwork stripped, since the device needs it.
   * For devices that could benefit from stripping (e.g., sidecar-artwork
   * devices in optimized mode), this would require tag rewriting.
   */
  removeArtwork(): MassStorageTrack {
    return this;
  }
}

// =============================================================================
// MassStorageAdapter
// =============================================================================

/**
 * DeviceAdapter implementation for mass-storage DAPs.
 *
 * Use the static `open()` factory method to create instances — it performs
 * the async filesystem scan and caches the track list so that `getTracks()`
 * can be synchronous (matching the DeviceAdapter interface contract).
 */
export class MassStorageAdapter implements DeviceAdapter<MassStorageTrack> {
  readonly capabilities: DeviceCapabilities;
  readonly mountPoint: string;

  private tracks: MassStorageTrack[] = [];
  private manifest: MassStorageManifest;
  private managedFiles: Set<string>;
  private allocatedPaths: Set<string>;
  private readonly contentPaths: ContentPaths;
  private readonly metadataReader: MetadataReader;
  private readonly tagWriter: TagWriter;

  /**
   * Pending comment tag writes, keyed by relative file path.
   * Accumulated by updateTrack() and flushed by save().
   */
  private pendingCommentWrites = new Map<string, string>();

  /**
   * Pending ReplayGain tag writes, keyed by relative file path.
   * Accumulated by updateTrack() when soundcheck changes on a replaygain device.
   * Flushed by save().
   */
  private pendingReplayGainWrites = new Map<
    string,
    { trackGain: number; trackPeak?: number; albumGain?: number; albumPeak?: number }
  >();

  /**
   * Pending picture writes, keyed by relative file path.
   * Accumulated by updateTrack() for OGG/Opus files where FFmpeg can't embed artwork.
   * Flushed by save() via tagWriter.writePicture().
   */
  private pendingPictureWrites = new Map<string, Buffer>();

  private constructor(
    mountPoint: string,
    capabilities: DeviceCapabilities,
    options?: MassStorageAdapterOptions
  ) {
    this.mountPoint = mountPoint;
    this.capabilities = capabilities;

    // Resolve content paths: explicit contentPaths > legacy musicDir > defaults
    const pathOverrides: Partial<ContentPaths> = { ...options?.contentPaths };
    if (options?.musicDir !== undefined && pathOverrides.musicDir === undefined) {
      pathOverrides.musicDir = options.musicDir;
    }
    this.contentPaths = normalizeContentPaths(pathOverrides);
    validateContentPaths(this.contentPaths);

    this.metadataReader = options?.metadataReader ?? defaultMetadataReader;
    this.tagWriter = options?.tagWriter ?? new TagLibTagWriter();
    this.manifest = createEmptyManifest();
    this.managedFiles = new Set();
    this.allocatedPaths = new Set();
  }

  private getContentRoots(): string[] {
    return [
      ...new Set([
        this.contentPaths.musicDir,
        this.contentPaths.moviesDir,
        this.contentPaths.tvShowsDir,
      ]),
    ];
  }

  /**
   * Create and initialize a MassStorageAdapter.
   *
   * Scans the device filesystem for audio files and reads the manifest.
   * The track list is cached so getTracks() is synchronous.
   */
  /**
   * Build ReplayGain data from AudioNormalization.
   * Prefers trackGain (dB) when available, otherwise back-converts from soundcheckValue.
   */
  private buildReplayGainData(
    normalization?: AudioNormalization
  ): { trackGain: number; trackPeak?: number; albumGain?: number; albumPeak?: number } | undefined {
    if (!normalization) return undefined;
    if (normalization.trackGain !== undefined) {
      return {
        trackGain: normalization.trackGain,
        trackPeak: normalization.trackPeak,
        albumGain: normalization.albumGain,
        albumPeak: normalization.albumPeak,
      };
    }
    if (normalization.soundcheckValue !== undefined) {
      return { trackGain: soundcheckToReplayGainDb(normalization.soundcheckValue) };
    }
    return undefined;
  }

  static async open(
    mountPoint: string,
    capabilities: DeviceCapabilities,
    options?: MassStorageAdapterOptions
  ): Promise<MassStorageAdapter> {
    const adapter = new MassStorageAdapter(mountPoint, capabilities, options);
    adapter.loadManifest();
    await adapter.scanTracks();
    return adapter;
  }

  // ---------------------------------------------------------------------------
  // Track lifecycle
  // ---------------------------------------------------------------------------

  getTracks(): MassStorageTrack[] {
    return this.tracks;
  }

  addTrack(input: DeviceTrackInput): MassStorageTrack {
    const ext = input.filetype ? resolveFileExtension(input.filetype) : '.mp3';

    // Route video tracks to video directories, music to music directory
    const isVideo = input.mediaType !== undefined && isVideoMediaType(input.mediaType);
    const desiredPath = isVideo
      ? generateVideoPath({
          title: input.title,
          contentType: input.tvShow || input.tvEpisode ? 'tvshow' : 'movie',
          year: input.year,
          seriesTitle: input.tvShow,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
          extension: ext,
          moviesDir: this.contentPaths.moviesDir,
          tvShowsDir: this.contentPaths.tvShowsDir,
        })
      : generateTrackPath({
          artist: input.artist,
          album: input.album,
          title: input.title,
          trackNumber: input.trackNumber,
          discNumber: input.discNumber,
          totalDiscs: input.totalDiscs,
          extension: ext,
          musicDir: this.contentPaths.musicDir,
        });

    const uniquePath = deduplicatePath(desiredPath, this.allocatedPaths);
    this.allocatedPaths.add(uniquePath);

    // If a syncTag is provided, embed it into the comment field
    const comment = input.syncTag ? writeSyncTag(input.comment, input.syncTag) : input.comment;

    const track = new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.getContentRoots(),
      filePath: uniquePath,
      title: input.title,
      artist: input.artist ?? 'Unknown Artist',
      album: input.album ?? 'Unknown Album',
      albumArtist: input.albumArtist,
      genre: input.genre,
      composer: input.composer,
      comment,
      trackNumber: input.trackNumber,
      discNumber: input.discNumber,
      totalDiscs: input.totalDiscs,
      year: input.year,
      duration: input.duration ?? 0,
      bitrate: input.bitrate ?? 0,
      sampleRate: input.sampleRate ?? 0,
      size: input.size ?? 0,
      filetype: input.filetype,
      normalization: input.normalization,
      hasArtwork: false,
      hasFile: false, // File doesn't exist yet — copyFile() will create it
      compilation: input.compilation ?? false,
      mediaType: input.mediaType ?? 1,
      managed: true,
    });

    this.tracks.push(track);
    this.managedFiles.add(uniquePath);

    // Queue comment write — the file doesn't exist yet (copyFile comes later),
    // but the write is deferred to save() by which point the file will exist.
    if (comment) {
      this.pendingCommentWrites.set(uniquePath, comment);
    }

    return track;
  }

  updateTrack(track: MassStorageTrack, fields: DeviceTrackMetadata): MassStorageTrack {
    const updated = track.update(fields);

    // Replace in our track list
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks[index] = updated;
    }

    // Queue comment tag write if the comment changed
    if (fields.comment !== undefined && fields.comment !== track.comment) {
      this.pendingCommentWrites.set(track.filePath, fields.comment);
    }

    // Queue picture write for OGG/Opus files where FFmpeg can't embed artwork
    if (fields.embeddedPictureData) {
      this.pendingPictureWrites.set(updated.filePath, fields.embeddedPictureData);
    }

    // Queue ReplayGain tag write when:
    // 1. Normalization changed on a replaygain device (collection updated normalization data)
    // 2. writeReplayGainTags is explicitly set (e.g., after transcoding M4A files)
    const normalizationChanged =
      fields.normalization !== undefined &&
      normalizationToSoundcheck(fields.normalization) !==
        (track.normalization ? normalizationToSoundcheck(track.normalization) : undefined);
    if (
      this.capabilities.audioNormalization === 'replaygain' &&
      (normalizationChanged || fields.writeReplayGainTags)
    ) {
      const rg = this.buildReplayGainData(fields.normalization ?? track.normalization);
      if (rg) {
        this.pendingReplayGainWrites.set(updated.filePath, rg);
      }
    }

    return updated;
  }

  copyTrackFile(track: MassStorageTrack, sourcePath: string): MassStorageTrack {
    const updated = track.copyFile(sourcePath);

    // Replace in our track list (copyFile returns a new instance with hasFile/size updated)
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks[index] = updated;
    }

    return updated;
  }

  removeTrack(track: MassStorageTrack, options?: { deleteFile?: boolean }): void {
    const deleteFile = options?.deleteFile ?? true;

    // Only delete files that podkit manages
    if (deleteFile && track.managed) {
      track.remove();
      this.managedFiles.delete(track.filePath);
    }

    // Remove from track list
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks.splice(index, 1);
    }

    this.allocatedPaths.delete(track.filePath);
  }

  removeTrackArtwork(track: MassStorageTrack): MassStorageTrack {
    // No-op — mass-storage devices with embedded artwork need it kept.
    // Delegates to the track's removeArtwork() which is also a no-op.
    return track.removeArtwork();
  }

  replaceTrackFile(track: MassStorageTrack, newFilePath: string): MassStorageTrack {
    const absolutePath = path.join(this.mountPoint, track.filePath);
    const newExt = path.extname(newFilePath).toLowerCase();
    const oldExt = path.extname(track.filePath).toLowerCase();

    let targetAbsolutePath: string;
    let targetRelativePath: string;

    if (newExt !== oldExt) {
      // Extension changed (codec change) — need a new path
      const newRelPath = track.filePath.replace(/\.[^.]+$/, newExt);

      targetRelativePath = newRelPath;
      targetAbsolutePath = path.join(this.mountPoint, targetRelativePath);

      // Deduplicate if there's a collision
      if (this.allocatedPaths.has(targetRelativePath) || fs.existsSync(targetAbsolutePath)) {
        const parsed = path.parse(targetRelativePath);
        let counter = 1;
        do {
          targetRelativePath = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
          targetAbsolutePath = path.join(this.mountPoint, targetRelativePath);
          counter++;
        } while (this.allocatedPaths.has(targetRelativePath) || fs.existsSync(targetAbsolutePath));
      }
    } else {
      // Same extension — replace in place (existing behavior)
      targetRelativePath = track.filePath;
      targetAbsolutePath = absolutePath;
    }

    // Copy the new file to the target path
    const dir = path.dirname(targetAbsolutePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(newFilePath, targetAbsolutePath);

    // If path changed, delete the old file and update bookkeeping
    if (targetRelativePath !== track.filePath) {
      try {
        fs.unlinkSync(absolutePath);
      } catch {
        /* old file may not exist */
      }

      // Update allocatedPaths
      this.allocatedPaths.delete(track.filePath);
      this.allocatedPaths.add(targetRelativePath);

      // Update managedFiles
      this.managedFiles.delete(track.filePath);
      this.managedFiles.add(targetRelativePath);

      // Update pendingCommentWrites if keyed on old path
      if (this.pendingCommentWrites.has(track.filePath)) {
        const comment = this.pendingCommentWrites.get(track.filePath)!;
        this.pendingCommentWrites.delete(track.filePath);
        this.pendingCommentWrites.set(targetRelativePath, comment);
      }

      // Update pendingReplayGainWrites if keyed on old path
      if (this.pendingReplayGainWrites.has(track.filePath)) {
        const rg = this.pendingReplayGainWrites.get(track.filePath)!;
        this.pendingReplayGainWrites.delete(track.filePath);
        this.pendingReplayGainWrites.set(targetRelativePath, rg);
      }

      // Update pendingPictureWrites if keyed on old path
      if (this.pendingPictureWrites.has(track.filePath)) {
        const pic = this.pendingPictureWrites.get(track.filePath)!;
        this.pendingPictureWrites.delete(track.filePath);
        this.pendingPictureWrites.set(targetRelativePath, pic);
      }
    }

    // Update file stats
    const stats = fs.statSync(targetAbsolutePath);
    const derivedExt = path.extname(newFilePath).slice(1).toLowerCase();

    const updated = new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.getContentRoots(),
      filePath: targetRelativePath,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      genre: track.genre,
      composer: track.composer,
      comment: track.comment,
      trackNumber: track.trackNumber,
      discNumber: track.discNumber,
      totalDiscs: track.totalDiscs,
      year: track.year,
      duration: track.duration,
      bitrate: track.bitrate,
      sampleRate: track.sampleRate,
      size: stats.size,
      filetype: derivedExt || track.filetype,
      normalization: track.normalization,
      hasArtwork: track.hasArtwork,
      hasFile: true,
      compilation: track.compilation,
      mediaType: track.mediaType,
      managed: track.managed,
    });

    // Replace in our track list (use old filePath to find the entry)
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks[index] = updated;
    }

    // The new file doesn't have the old track's comment tag. Queue a write
    // to restore it — if the executor sets a new sync tag via updateTrack()
    // before save(), that will overwrite this entry in the pending map.
    if (track.comment) {
      this.pendingCommentWrites.set(targetRelativePath, track.comment);
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Sync tags
  // ---------------------------------------------------------------------------

  writeSyncTag(track: MassStorageTrack, update: SyncTagUpdate): MassStorageTrack {
    const currentComment = track.comment;
    const existingTag = parseSyncTag(currentComment);
    // Merge: existing tag fields + update fields (update wins)
    const merged: SyncTagData = existingTag
      ? { ...existingTag, ...update }
      : { quality: 'copy', ...update };
    const newComment = writeSyncTag(currentComment, merged);
    return this.updateTrack(track, { comment: newComment });
  }

  clearSyncTag(track: MassStorageTrack): MassStorageTrack {
    const currentComment = track.comment;
    if (!parseSyncTag(currentComment)) {
      return track; // No sync tag to clear
    }
    // Strip the [podkit:...] block from the comment
    const cleaned =
      (currentComment ?? '').replace(/\s*\[podkit:v\d+[^\]]*\]\s*/g, '').trim() || undefined;
    return this.updateTrack(track, { comment: cleaned });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async save(): Promise<void> {
    // Flush pending comment tag writes to audio files
    if (this.pendingCommentWrites.size > 0) {
      const writes = [...this.pendingCommentWrites.entries()].map(([filePath, comment]) =>
        this.tagWriter.writeComment(path.join(this.mountPoint, filePath), comment)
      );
      await Promise.all(writes);
      this.pendingCommentWrites.clear();
    }

    // Flush pending ReplayGain tag writes to audio files
    if (this.pendingReplayGainWrites.size > 0) {
      const writes = [...this.pendingReplayGainWrites.entries()].map(([filePath, rg]) =>
        this.tagWriter.writeReplayGain(
          path.join(this.mountPoint, filePath),
          rg.trackGain,
          rg.trackPeak,
          rg.albumGain,
          rg.albumPeak
        )
      );
      await Promise.all(writes);
      this.pendingReplayGainWrites.clear();
    }

    // Flush pending picture writes (OGG/Opus artwork embedding)
    if (this.pendingPictureWrites.size > 0) {
      const writes = [...this.pendingPictureWrites.entries()].map(([filePath, imageData]) =>
        this.tagWriter.writePicture(path.join(this.mountPoint, filePath), imageData)
      );
      await Promise.all(writes);
      this.pendingPictureWrites.clear();
    }

    // Write manifest
    this.manifest.managedFiles = [...this.managedFiles].sort();
    this.manifest.lastSync = new Date().toISOString();

    const stateDir = path.join(this.mountPoint, PODKIT_DIR);
    fs.mkdirSync(stateDir, { recursive: true });

    const manifestPath = path.join(stateDir, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2) + '\n', 'utf-8');
  }

  close(): void {
    // No resources to release for filesystem-based devices
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Load the manifest from disk (if it exists).
   */
  private loadManifest(): void {
    const manifestPath = path.join(this.mountPoint, PODKIT_DIR, MANIFEST_FILE);

    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as MassStorageManifest;
      if (parsed.version === 1 && Array.isArray(parsed.managedFiles)) {
        this.manifest = parsed;
        this.managedFiles = new Set(parsed.managedFiles);
      }
    } catch {
      // No manifest yet — all existing files are unmanaged
      this.manifest = createEmptyManifest();
      this.managedFiles = new Set();
    }
  }

  /**
   * Scan content directories for audio and video files.
   */
  private async scanTracks(): Promise<void> {
    const tracks: MassStorageTrack[] = [];

    // Scan music directory
    const musicDir = this.contentPaths.musicDir;
    const musicRoot = musicDir ? path.join(this.mountPoint, musicDir) : this.mountPoint;
    if (fs.existsSync(musicRoot)) {
      const skipDirs = new Set<string>();
      if (!musicDir) {
        // Scanning from root — skip .podkit and other content directories
        skipDirs.add(path.join(this.mountPoint, PODKIT_DIR));
        if (this.contentPaths.moviesDir)
          skipDirs.add(path.join(this.mountPoint, this.contentPaths.moviesDir));
        if (this.contentPaths.tvShowsDir)
          skipDirs.add(path.join(this.mountPoint, this.contentPaths.tvShowsDir));
      }
      const audioFiles = this.walkDirectory(musicRoot, isAudioExtension, skipDirs);
      for (const absolutePath of audioFiles) {
        try {
          const track = await this.readTrackMetadata(absolutePath);
          tracks.push(track);
          this.allocatedPaths.add(track.filePath);
        } catch {
          continue;
        }
      }
    }

    // Scan video directories (if device supports video)
    if (this.capabilities.supportsVideo) {
      const scannedDirs = new Set<string>();
      for (const dir of [this.contentPaths.moviesDir, this.contentPaths.tvShowsDir]) {
        const videoRoot = dir ? path.join(this.mountPoint, dir) : this.mountPoint;
        // Avoid scanning the same directory twice
        if (scannedDirs.has(videoRoot)) continue;
        scannedDirs.add(videoRoot);

        if (fs.existsSync(videoRoot)) {
          const skipDirs = new Set<string>();
          if (!dir) {
            skipDirs.add(path.join(this.mountPoint, PODKIT_DIR));
            if (this.contentPaths.musicDir)
              skipDirs.add(path.join(this.mountPoint, this.contentPaths.musicDir));
          }
          const videoFiles = this.walkDirectory(videoRoot, isVideoExtension, skipDirs);
          for (const absolutePath of videoFiles) {
            const relativePath = path.relative(this.mountPoint, absolutePath);
            // Skip if already scanned (e.g., from overlapping directory)
            if (this.allocatedPaths.has(relativePath)) continue;
            try {
              const track = await this.readVideoMetadata(absolutePath);
              tracks.push(track);
              this.allocatedPaths.add(track.filePath);
            } catch {
              continue;
            }
          }
        }
      }
    }

    this.tracks = tracks;
  }

  /**
   * Recursively walk a directory and return all matching file paths.
   */
  private walkDirectory(
    dir: string,
    extensionFilter: (ext: string) => boolean,
    skipDirs?: Set<string>
  ): string[] {
    const results: string[] = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs?.has(fullPath)) continue;
        results.push(...this.walkDirectory(fullPath, extensionFilter, skipDirs));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensionFilter(ext)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }

  /**
   * Read metadata from a single audio file and create a MassStorageTrack.
   */
  private async readTrackMetadata(absolutePath: string): Promise<MassStorageTrack> {
    const metadata = await this.metadataReader(absolutePath, {
      skipCovers: true,
      duration: true,
    });

    const { common, format } = metadata;
    const relativePath = path.relative(this.mountPoint, absolutePath);
    const stats = fs.statSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase().slice(1); // Remove leading dot

    // Determine if this file is managed by podkit
    const managed = this.managedFiles.has(relativePath);

    // Calculate bitrate in kbps
    const bitrate = format.bitrate ? Math.round(format.bitrate / 1000) : 0;

    // Duration in milliseconds
    const duration = format.duration ? Math.floor(format.duration * 1000) : 0;

    // Detect artwork presence
    const hasArtwork = (common.picture?.length ?? 0) > 0;

    // Extract normalization data from ReplayGain tags (for diff detection against collection)
    const normalization: AudioNormalization | undefined =
      common.replaygain_track_gain?.dB !== undefined
        ? {
            source: 'replaygain-track',
            trackGain: common.replaygain_track_gain.dB,
            trackPeak: common.replaygain_track_peak?.ratio,
            albumGain: common.replaygain_album_gain?.dB,
            albumPeak: common.replaygain_album_peak?.ratio,
            soundcheckValue: replayGainToSoundcheck(common.replaygain_track_gain.dB),
          }
        : undefined;

    return new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.getContentRoots(),
      filePath: relativePath,
      title: common.title || path.basename(absolutePath, path.extname(absolutePath)),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      albumArtist: common.albumartist,
      genre: common.genre?.[0],
      composer: common.composer?.[0],
      comment: extractComment(common.comment),
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      year: common.year,
      duration,
      bitrate,
      sampleRate: format.sampleRate ?? 0,
      size: stats.size,
      filetype: ext,
      normalization,
      hasArtwork,
      hasFile: true,
      compilation: common.compilation ?? false,
      managed,
    });
  }

  /**
   * Read metadata from a video file and create a MassStorageTrack.
   *
   * Video files have minimal metadata compared to audio — we derive what we
   * can from the file path and any embedded tags.
   */
  private async readVideoMetadata(absolutePath: string): Promise<MassStorageTrack> {
    const relativePath = path.relative(this.mountPoint, absolutePath);
    const stats = fs.statSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase().slice(1);
    const managed = this.managedFiles.has(relativePath);
    const basename = path.basename(absolutePath, path.extname(absolutePath));

    // Video media type (movie by default)
    const MediaType = { Movie: 0x0002, TVShow: 0x0040 };
    const tvPrefix = this.contentPaths.tvShowsDir;
    const moviesPrefix = this.contentPaths.moviesDir;
    const isTvShow =
      tvPrefix === ''
        ? !(moviesPrefix !== '' && relativePath.startsWith(`${moviesPrefix}/`))
        : relativePath.startsWith(`${tvPrefix}/`);
    const mediaType = isTvShow ? MediaType.TVShow : MediaType.Movie;

    return new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.getContentRoots(),
      filePath: relativePath,
      title: basename,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      bitrate: 0,
      sampleRate: 0,
      size: stats.size,
      filetype: ext,
      hasArtwork: false,
      hasFile: true,
      compilation: false,
      managed,
      mediaType,
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve a filetype string to a file extension.
 *
 * The `filetype` field in DeviceTrackInput serves dual purposes:
 * - iPod: display label stored in the database ("AAC audio file")
 * - Mass-storage: file extension for the output file ("m4a", "opus")
 *
 * The sync pipeline passes display labels (e.g., "Opus audio file") which
 * are appropriate for iPod but not for filesystem paths. This function
 * normalizes both forms to a dotted extension.
 */
function resolveFileExtension(filetype: string): string {
  // Already looks like a bare extension (short, no spaces) — just prefix with dot
  if (!filetype.includes(' ') && filetype.length <= 5) {
    return filetype.startsWith('.') ? filetype : `.${filetype}`;
  }

  // Match against CODEC_METADATA filetype labels (single source of truth)
  const label = filetype.toLowerCase();
  for (const meta of Object.values(CODEC_METADATA)) {
    if (label === meta.filetypeLabel.toLowerCase()) {
      return meta.extension;
    }
  }

  // Additional non-codec labels (video, legacy formats)
  if (label.includes('ogg') || label.includes('vorbis')) return '.ogg';
  if (label.includes('wav')) return '.wav';
  if (label.includes('aiff')) return '.aiff';
  if (label.includes('mp4') || label.includes('m4v')) return '.m4v';

  // Fallback: use as-is with dot prefix (best effort)
  return `.${filetype}`;
}

/**
 * Extract the first comment string from music-metadata's comment array.
 * Handles both plain strings and IComment objects ({ text?: string }).
 */
function extractComment(
  comments: Array<string | { text?: string }> | undefined
): string | undefined {
  if (!comments || comments.length === 0) return undefined;
  const first = comments[0];
  if (typeof first === 'string') return first;
  return first?.text;
}

// =============================================================================
// Default metadata reader (wraps music-metadata)
// =============================================================================

const defaultMetadataReader: MetadataReader = async (filePath, options) => {
  const result = await mm.parseFile(filePath, {
    skipCovers: options?.skipCovers ?? true,
    duration: options?.duration ?? true,
  });
  // Cast from IAudioMetadata — our MetadataReaderResult is a compatible subset
  return result as unknown as MetadataReaderResult;
};
