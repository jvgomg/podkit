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
import type { SyncTagData, SyncTagUpdate } from '../sync/sync-tags.js';
import { parseSyncTag, writeSyncTag } from '../sync/sync-tags.js';
import {
  MUSIC_DIR,
  VIDEO_DIR,
  PODKIT_DIR,
  MANIFEST_FILE,
  generateTrackPath,
  generateVideoPath,
  deduplicatePath,
  isAudioExtension,
  isVideoExtension,
  createEmptyManifest,
  type MassStorageManifest,
} from './mass-storage-utils.js';
import { isVideoMediaType } from '../ipod/video.js';
import { TagLibTagWriter, type TagWriter } from './mass-storage-tag-writer.js';

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
  /** Override the music directory name (default: "Music") */
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
  readonly soundcheck?: number;

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

  constructor(opts: {
    mountPoint: string;
    filePath: string;
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
    soundcheck?: number;
    hasArtwork: boolean;
    hasFile: boolean;
    compilation: boolean;
    mediaType?: number;
    managed: boolean;
  }) {
    this.mountPoint = opts.mountPoint;
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
    this.soundcheck = opts.soundcheck;
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
      soundcheck: fields.soundcheck ?? this.soundcheck,
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

    // Clean up empty parent directories up to the content root (Music/ or Video/)
    const musicRoot = path.join(this.mountPoint, MUSIC_DIR);
    const videoRoot = path.join(this.mountPoint, VIDEO_DIR);
    const contentRoot = absolutePath.startsWith(videoRoot) ? videoRoot : musicRoot;
    let dir = path.dirname(absolutePath);
    while (dir !== contentRoot && dir.startsWith(contentRoot)) {
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
      soundcheck: this.soundcheck,
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
   * No-op for mass-storage devices — artwork is already embedded in the
   * file by the FFmpeg pipeline (resize/transcode). Unlike iPod, which
   * stores artwork in a separate database, mass-storage devices read
   * artwork directly from embedded tags.
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
  private readonly musicDir: string;
  private readonly metadataReader: MetadataReader;
  private readonly tagWriter: TagWriter;

  /**
   * Pending comment tag writes, keyed by relative file path.
   * Accumulated by updateTrack() and flushed by save().
   */
  private pendingCommentWrites = new Map<string, string>();

  private constructor(
    mountPoint: string,
    capabilities: DeviceCapabilities,
    options?: MassStorageAdapterOptions
  ) {
    this.mountPoint = mountPoint;
    this.capabilities = capabilities;
    this.musicDir = options?.musicDir ?? MUSIC_DIR;
    this.metadataReader = options?.metadataReader ?? defaultMetadataReader;
    this.tagWriter = options?.tagWriter ?? new TagLibTagWriter();
    this.manifest = createEmptyManifest();
    this.managedFiles = new Set();
    this.allocatedPaths = new Set();
  }

  /**
   * Create and initialize a MassStorageAdapter.
   *
   * Scans the device filesystem for audio files and reads the manifest.
   * The track list is cached so getTracks() is synchronous.
   */
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
    const ext = input.filetype ? `.${input.filetype}` : '.mp3';

    // Route video tracks to Video/ directory, music to Music/
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
        })
      : generateTrackPath({
          artist: input.artist,
          album: input.album,
          title: input.title,
          trackNumber: input.trackNumber,
          discNumber: input.discNumber,
          totalDiscs: input.totalDiscs,
          extension: ext,
        });

    const uniquePath = deduplicatePath(desiredPath, this.allocatedPaths);
    this.allocatedPaths.add(uniquePath);

    // If a syncTag is provided, embed it into the comment field
    const comment = input.syncTag ? writeSyncTag(input.comment, input.syncTag) : input.comment;

    const track = new MassStorageTrack({
      mountPoint: this.mountPoint,
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
      soundcheck: input.soundcheck,
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

    // Copy the new file over the existing one
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(newFilePath, absolutePath);

    // Update size from the new file
    const stats = fs.statSync(absolutePath);

    // Derive filetype from the new file's extension
    const newExt = path.extname(newFilePath).slice(1).toLowerCase();

    const updated = new MassStorageTrack({
      mountPoint: this.mountPoint,
      filePath: track.filePath,
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
      filetype: newExt || track.filetype,
      soundcheck: track.soundcheck,
      hasArtwork: track.hasArtwork,
      hasFile: true,
      compilation: track.compilation,
      mediaType: track.mediaType,
      managed: track.managed,
    });

    // Replace in our track list
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks[index] = updated;
    }

    // The new file doesn't have the old track's comment tag. Queue a write
    // to restore it — if the executor sets a new sync tag via updateTrack()
    // before save(), that will overwrite this entry in the pending map.
    if (track.comment) {
      this.pendingCommentWrites.set(track.filePath, track.comment);
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
   * Scan the Music/ directory for audio files and read their metadata.
   */
  private async scanTracks(): Promise<void> {
    const tracks: MassStorageTrack[] = [];

    // Scan music directory
    const musicRoot = path.join(this.mountPoint, this.musicDir);
    if (fs.existsSync(musicRoot)) {
      const audioFiles = this.walkDirectory(musicRoot, isAudioExtension);
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

    // Scan video directory (if device supports video)
    if (this.capabilities.supportsVideo) {
      const videoRoot = path.join(this.mountPoint, VIDEO_DIR);
      if (fs.existsSync(videoRoot)) {
        const videoFiles = this.walkDirectory(videoRoot, isVideoExtension);
        for (const absolutePath of videoFiles) {
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

    this.tracks = tracks;
  }

  /**
   * Recursively walk a directory and return all matching file paths.
   */
  private walkDirectory(dir: string, extensionFilter: (ext: string) => boolean): string[] {
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
        results.push(...this.walkDirectory(fullPath, extensionFilter));
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

    return new MassStorageTrack({
      mountPoint: this.mountPoint,
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
    const isTvShow =
      relativePath.startsWith(`${VIDEO_DIR}/`) && !relativePath.startsWith(`${VIDEO_DIR}/Movies/`);
    const mediaType = isTvShow ? MediaType.TVShow : MediaType.Movie;

    return new MassStorageTrack({
      mountPoint: this.mountPoint,
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
