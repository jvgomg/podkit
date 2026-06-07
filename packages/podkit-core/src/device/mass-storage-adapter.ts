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

import { atomicCopyFile, atomicWriteFile, atomicWriteFileWithSync } from '../utils/atomic-fs.js';

import type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './adapter.js';
import type { WarningSink } from '../sync/engine/types.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { SyncTagData, SyncTagUpdate } from '../metadata/sync-tags.js';
import { parseSyncTag, writeSyncTag } from '../metadata/sync-tags.js';
import {
  DEFAULT_MUSIC_PATH_TEMPLATE,
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
} from './mass-storage-utils.js';
import {
  DEFAULT_CONTENT_PATHS,
  MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS,
} from '@podkit/devices-mass-storage';
import { pruneManifestRows } from './mass-storage-manifest.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';
import { isVideoMediaType } from '../ipod/video.js';
import { CODEC_METADATA } from '../transcode/codecs.js';
import {
  DEFAULT_TAG_WRITE_CONCURRENCY,
  MoveError,
  PictureWriteError,
  SidecarWriteError,
  TagLibTagWriter,
  TagWriteError,
  diffTagFields,
  runWithConcurrency,
  type TagFields,
  type TagWriter,
} from './mass-storage-tag-writer.js';
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
  /**
   * Path template for music track file paths.
   * Uses `{variable}` placeholders (e.g. `{albumArtist}/{album}/{trackNumber} - {title}{ext}`).
   * @see DEFAULT_MUSIC_PATH_TEMPLATE for available variables and the default value.
   */
  pathTemplate?: string;
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

  /**
   * Where this device stores artwork. Derived from `capabilities.artworkSources[0]`
   * by {@link deriveArtworkSink} at adapter-construction time and threaded
   * through every track instance — see DeviceTrack.artworkSink for the contract.
   *
   * Per-device, not per-track: the value is the same for every track on a
   * given adapter instance. We carry it on the track so the pipeline can pick
   * the write path without knowing which adapter created the track.
   */
  readonly artworkSink: 'embedded' | 'sidecar' | 'noop';

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
    artworkSink: 'embedded' | 'sidecar' | 'noop';
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
    this.artworkSink = opts.artworkSink;
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
      artworkSink: this.artworkSink,
    });
  }

  /**
   * Create a new track instance with a different file path.
   * Used by relocateTrack() for path changes without metadata changes.
   */
  withPath(newPath: string): MassStorageTrack {
    return new MassStorageTrack({
      mountPoint: this.mountPoint,
      contentRoots: this.contentRoots,
      filePath: newPath,
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
      size: this.size,
      filetype: this.filetype,
      normalization: this.normalization,
      hasArtwork: this.hasArtwork,
      hasFile: this.hasFile,
      compilation: this.compilation,
      mediaType: this.mediaType,
      managed: this.managed,
      artworkSink: this.artworkSink,
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

    // Atomic copy: write to a sibling .podkit-tmp path, then rename. If a
    // sync is killed mid-copy, the destination is either absent or the
    // previous version — never a partial file at the final path that the
    // manifest will silently mark as managed.
    atomicCopyFile(sourcePath, absolutePath);

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
      artworkSink: this.artworkSink,
    });
  }
}

/**
 * Filename podkit writes for the peer cover image on sidecar-primary devices
 * (rockbox today). Hardcoded for v1 — a future task will let presets pick
 * `folder.jpg` / `front.png` / etc. Keep the name in one place so the writer
 * and the doctor's orphan walk agree.
 */
export const SIDECAR_FILENAME = 'cover.jpg';

/**
 * Write a sidecar cover image atomically: ensure the album dir exists, then
 * delegate to `atomicWriteFileWithSync` (tmp + fsync + rename). The sidecar
 * wrapper adds only the mkdir — the atomic-write contract lives in the helper.
 *
 * Concurrent writes to the same album dir would collide on the fixed
 * `.podkit-tmp` suffix (last writer wins for the tmp file). Not a real risk
 * today — the pipeline serialises queued writes per save() — but worth
 * knowing if the flush ever goes concurrent within an album. Cross-album
 * concurrency is safe (distinct dirs → distinct tmp paths).
 *
 * Internal helper, kept at module scope so unit tests can mock `fs.rename` to
 * simulate the SIGKILL-mid-rename case.
 */
async function writeSidecarAtomically(absoluteAlbumDir: string, imageData: Buffer): Promise<void> {
  // Ensure the album directory exists before writing — sidecar-primary devices
  // may have never had a file added to this album dir in the current session.
  await fs.promises.mkdir(absoluteAlbumDir, { recursive: true });
  await atomicWriteFileWithSync(path.join(absoluteAlbumDir, SIDECAR_FILENAME), imageData);
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
/**
 * Map a device's primary artwork source (`capabilities.artworkSources[0]`) to
 * the `artworkSink` carried by each track. The adapter computes this once at
 * construction and threads the value through every `MassStorageTrack`.
 *
 * - `'embedded'`  → the device reads the file body (taglib write path).
 * - `'sidecar'`   → the device reads a peer image (writer not yet implemented;
 *                  pipeline treats as noop until a follow-up adds it).
 * - empty list    → device has no artwork support → `'noop'` (suppresses both
 *                  the write attempt and the `syncTag.artworkHash` claim).
 *
 * Per-device, not per-track: every track on an adapter instance shares the
 * sink. We compute it once and snapshot it onto the track so the pipeline can
 * dispatch on `track.artworkSink` without re-deriving from capabilities.
 */
function deriveArtworkSink(capabilities: DeviceCapabilities): 'embedded' | 'sidecar' | 'noop' {
  const primary = capabilities.artworkSources[0];
  if (primary === 'embedded') return 'embedded';
  if (primary === 'sidecar') return 'sidecar';
  return 'noop';
}

export class MassStorageAdapter implements DeviceAdapter<MassStorageTrack> {
  readonly capabilities: DeviceCapabilities;
  readonly mountPoint: string;

  private tracks: MassStorageTrack[] = [];
  private manifest: MassStorageManifest;
  private managedFiles: Set<string>;
  private allocatedPaths: Set<string>;
  private readonly contentPaths: ContentPaths;
  private readonly pathTemplate: string;
  private readonly metadataReader: MetadataReader;
  private readonly tagWriter: TagWriter;
  private readonly artworkSink: 'embedded' | 'sidecar' | 'noop';

  /**
   * Pending textual-tag writes, keyed by relative file path.
   * Accumulated by updateTrack()/addTrack() and flushed by save() as a single
   * `writeTags` call per file. Fields are merged across multiple updates so
   * later writes overwrite earlier values for the same field.
   */
  private pendingTagWrites = new Map<string, TagFields>();

  /**
   * Pending picture writes, keyed by relative file path.
   * Accumulated by updateTrack() for OGG/Opus files where FFmpeg can't embed artwork.
   * Flushed by save() via tagWriter.writePicture().
   */
  private pendingPictureWrites = new Map<string, Buffer>();

  /**
   * Pending sidecar (peer cover image) writes, keyed by **album directory**
   * (the audio file's parent dir, relative to the mount point).
   *
   * Per-album, not per-track: every track on the same album dir is expected
   * to contribute the same bytes (the pipeline's album-level resize cache
   * makes this true). Last write wins for the album, so concurrent track
   * writes don't fight — duplicate enqueues from sibling tracks collapse
   * into a single rename. Accumulated by {@link writeSidecar} and flushed by
   * {@link save} via an atomic tmp+rename per album dir. Sidecar-primary
   * devices (rockbox) read art from this file and have no embedded fallback,
   * so failures bubble up as {@link SidecarWriteError} rather than getting
   * swallowed as warnings.
   */
  private pendingSidecarWrites = new Map<string, Buffer>();

  /**
   * Pending file moves, keyed by current relative path → new relative path.
   * Accumulated by relocateTrack() and flushed by save() via fs.rename().
   */
  private pendingMoves = new Map<string, string>();

  /**
   * Receiver for execute-phase warnings. Set by the pipeline at execute
   * start via {@link setWarningSink}. Defaults to a no-op so the adapter
   * is safe to use outside an execute() loop (e.g. doctor surfaces or
   * tests that don't pass a sink) — warnings get dropped on the floor in
   * that case rather than blowing up.
   */
  private warningSink: WarningSink = { emit: () => {} };

  private constructor(
    mountPoint: string,
    capabilities: DeviceCapabilities,
    options?: MassStorageAdapterOptions
  ) {
    this.mountPoint = mountPoint;
    // Filter out codecs podkit won't manage as device-output on mass-storage,
    // even when the device firmware can play them. The preset/raw capability
    // data keeps wav/aiff for documentation; the adapter's `capabilities`
    // represents what podkit will actually use, which the planner consumes
    // for direct-copy-vs-transcode decisions. See
    // MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS in @podkit/devices-mass-storage
    // for the rationale (tag-write reliability across RIFF/IFF containers).
    this.capabilities = {
      ...capabilities,
      supportedAudioCodecs: capabilities.supportedAudioCodecs.filter(
        (c) => !MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS.includes(c)
      ),
    };

    // Resolve content paths: explicit contentPaths > legacy musicDir > defaults
    const pathOverrides: Partial<ContentPaths> = { ...options?.contentPaths };
    if (options?.musicDir !== undefined && pathOverrides.musicDir === undefined) {
      pathOverrides.musicDir = options.musicDir;
    }
    this.contentPaths = normalizeContentPaths(pathOverrides);
    validateContentPaths(this.contentPaths);
    this.pathTemplate = options?.pathTemplate ?? DEFAULT_MUSIC_PATH_TEMPLATE;

    this.metadataReader = options?.metadataReader ?? defaultMetadataReader;
    this.tagWriter = options?.tagWriter ?? new TagLibTagWriter();
    this.manifest = createEmptyManifest();
    this.managedFiles = new Set();
    this.allocatedPaths = new Set();
    this.artworkSink = deriveArtworkSink(this.capabilities);
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
  // Path computation
  // ---------------------------------------------------------------------------

  /**
   * Compute the expected device-relative path for a track given current
   * metadata and path template. Used for path-mismatch detection during
   * sync diff reconciliation.
   */
  computeExpectedPath(input: DeviceTrackInput): string {
    const ext = input.filetype ? resolveFileExtension(input.filetype) : '.mp3';
    const isVideo = input.mediaType !== undefined && isVideoMediaType(input.mediaType);

    return isVideo
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
          albumArtist: input.albumArtist,
          album: input.album,
          title: input.title,
          trackNumber: input.trackNumber,
          discNumber: input.discNumber,
          totalDiscs: input.totalDiscs,
          extension: ext,
          musicDir: this.contentPaths.musicDir,
          pathTemplate: this.pathTemplate,
        });
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
          albumArtist: input.albumArtist,
          album: input.album,
          title: input.title,
          trackNumber: input.trackNumber,
          discNumber: input.discNumber,
          totalDiscs: input.totalDiscs,
          extension: ext,
          musicDir: this.contentPaths.musicDir,
          pathTemplate: this.pathTemplate,
        });

    // Check if desired path collides with an unmanaged file on device
    if (this.allocatedPaths.has(desiredPath) && !this.managedFiles.has(desiredPath)) {
      const trackDesc = input.artist ? `${input.artist} - ${input.title}` : input.title;
      throw new Error(
        `Cannot sync "${trackDesc}": target path "${desiredPath}" is occupied by an unmanaged file. Remove the file or run \`podkit doctor\` to resolve.`
      );
    }

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
      artworkSink: this.artworkSink,
    });

    this.tracks.push(track);
    this.managedFiles.add(uniquePath);

    // Queue comment write — the file doesn't exist yet (copyFile comes later),
    // but the write is deferred to save() by which point the file will exist.
    if (comment) {
      this.queueTagWrite(uniquePath, { comment });
    }

    return track;
  }

  /**
   * Merge a partial set of tag fields into the pending-write map for a file.
   * Later writes overwrite earlier values for the same field; unrelated
   * fields are preserved. Empty field sets are a no-op.
   *
   * `replayGain` is deep-merged separately from the spread so a later
   * `{ replayGain: { trackGain } }` doesn't clobber a previously-queued
   * `{ replayGain: { trackGain, trackPeak } }`. Today every caller passes
   * a fully-populated `ReplayGainFields` object so the shallow-merge case
   * never fires in production — the deep-merge is a future-proofing
   * guard against partial RG updates accumulating across calls.
   */
  private queueTagWrite(filePath: string, fields: TagFields): void {
    if (Object.keys(fields).length === 0) return;
    const existing = this.pendingTagWrites.get(filePath);
    if (!existing) {
      this.pendingTagWrites.set(filePath, { ...fields });
      return;
    }
    const merged: TagFields = { ...existing, ...fields };
    if (existing.replayGain && fields.replayGain) {
      merged.replayGain = { ...existing.replayGain, ...fields.replayGain };
    }
    this.pendingTagWrites.set(filePath, merged);
  }

  /**
   * Check if planned add operations would collide with unmanaged files on device.
   *
   * Predicts the device path for each input using the same path generation logic
   * as addTrack(), then checks if that path is already occupied by an unmanaged file.
   * Returns an array of collisions found (empty if none).
   *
   * This runs before execution (and during dry-run) so collisions are caught early
   * rather than throwing mid-sync from addTrack().
   */
  checkAddCollisions(
    inputs: Array<{
      artist?: string;
      albumArtist?: string;
      album?: string;
      title: string;
      trackNumber?: number;
      discNumber?: number;
      totalDiscs?: number;
      filetype?: string;
      mediaType?: number;
      // Video fields
      tvShow?: string;
      tvEpisode?: string;
      seasonNumber?: number;
      episodeNumber?: number;
      year?: number;
    }>
  ): Array<{ path: string; description: string }> {
    const collisions: Array<{ path: string; description: string }> = [];

    for (const input of inputs) {
      const ext = input.filetype ? resolveFileExtension(input.filetype) : '.mp3';
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
            albumArtist: input.albumArtist,
            album: input.album,
            title: input.title,
            trackNumber: input.trackNumber,
            discNumber: input.discNumber,
            totalDiscs: input.totalDiscs,
            extension: ext,
            musicDir: this.contentPaths.musicDir,
            pathTemplate: this.pathTemplate,
          });

      // Collision = path exists on device but is NOT managed by podkit
      if (this.allocatedPaths.has(desiredPath) && !this.managedFiles.has(desiredPath)) {
        const description = input.artist ? `${input.artist} - ${input.title}` : input.title;
        collisions.push({ path: desiredPath, description });
      }
    }

    return collisions;
  }

  updateTrack(track: MassStorageTrack, fields: DeviceTrackMetadata): MassStorageTrack {
    const updated = track.update(fields);

    // Replace in our track list
    const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
    if (index >= 0) {
      this.tracks[index] = updated;
    }

    // Queue textual-tag writes for every field that actually changed.
    // Diffing against the current track avoids redundant disk writes when
    // the executor passes through fields that already match.
    this.queueTagWrite(track.filePath, diffTagFields(track, fields));

    // Queue picture write for OGG/Opus files where FFmpeg can't embed artwork
    if (fields.embeddedPictureData) {
      this.pendingPictureWrites.set(updated.filePath, fields.embeddedPictureData);
    }

    // Queue ReplayGain tag write when:
    // 1. Normalization changed on a replaygain device (collection updated normalization data)
    // 2. writeReplayGainTags is explicitly set (e.g., after transcoding M4A files)
    // The replay-gain payload rides on the same pending-tags map so save()
    // touches each file at most once even when textual + RG updates collide.
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
        this.queueTagWrite(updated.filePath, { replayGain: rg });
      }
    }

    return updated;
  }

  /**
   * Relocate a track to a new device-relative path.
   *
   * Queues a file move (executed during save() via fs.rename()) and updates
   * all internal tracking. This is used for path-mismatch self-healing when
   * metadata changes affect the directory structure or the path template changes.
   *
   * The move is a same-filesystem rename — no data copying required.
   */
  relocateTrack(track: MassStorageTrack, newPath: string): MassStorageTrack {
    const oldPath = track.filePath;

    // Deduplicate: if the target path is already taken (by another track),
    // append a suffix to avoid overwriting
    const finalPath = deduplicatePath(newPath, this.allocatedPaths);

    // Update path tracking
    this.allocatedPaths.delete(oldPath);
    this.allocatedPaths.add(finalPath);
    if (this.managedFiles.has(oldPath)) {
      this.managedFiles.delete(oldPath);
      this.managedFiles.add(finalPath);
    }

    // Re-key any pending writes from old path to new path
    if (this.pendingTagWrites.has(oldPath)) {
      const val = this.pendingTagWrites.get(oldPath)!;
      this.pendingTagWrites.delete(oldPath);
      this.pendingTagWrites.set(finalPath, val);
    }
    if (this.pendingPictureWrites.has(oldPath)) {
      const val = this.pendingPictureWrites.get(oldPath)!;
      this.pendingPictureWrites.delete(oldPath);
      this.pendingPictureWrites.set(finalPath, val);
    }

    // Re-key pending sidecar writes if the album dir changed. The album dir
    // is `path.dirname(filePath)` — a relocate that only renames the file but
    // keeps the parent dir invariant is the common case (and a no-op here);
    // a relocate across album dirs is the rare case worth re-keying for. We
    // also update `managedFiles` so the manifest accurately tracks the new
    // sidecar location.
    const oldAlbumDir = path.dirname(oldPath);
    const newAlbumDir = path.dirname(finalPath);
    if (oldAlbumDir !== newAlbumDir && this.pendingSidecarWrites.has(oldAlbumDir)) {
      const val = this.pendingSidecarWrites.get(oldAlbumDir)!;
      this.pendingSidecarWrites.delete(oldAlbumDir);
      this.pendingSidecarWrites.set(newAlbumDir, val);
      const oldSidecar = path.join(oldAlbumDir, SIDECAR_FILENAME);
      const newSidecar = path.join(newAlbumDir, SIDECAR_FILENAME);
      if (this.managedFiles.has(oldSidecar)) {
        this.managedFiles.delete(oldSidecar);
        this.managedFiles.add(newSidecar);
      }
    }

    // Queue the filesystem move
    this.pendingMoves.set(oldPath, finalPath);

    // Create a new track instance with updated path
    const relocated = track.withPath(finalPath);

    // Replace in track list
    const index = this.tracks.findIndex((t) => t.filePath === oldPath);
    if (index >= 0) {
      this.tracks[index] = relocated;
    }

    return relocated;
  }

  copyTrackFile(track: MassStorageTrack, sourcePath: string): MassStorageTrack {
    try {
      const updated = track.copyFile(sourcePath);

      // Replace in our track list (copyFile returns a new instance with hasFile/size updated)
      const index = this.tracks.findIndex((t) => t.filePath === track.filePath);
      if (index >= 0) {
        this.tracks[index] = updated;
      }

      return updated;
    } catch (err) {
      // Roll back the managedFiles entry that addTrack added. Otherwise a
      // later checkpoint save() (driven by a different successful track)
      // would persist a phantom path the file copy never produced — the
      // exact "manifest references missing file" class that
      // orphans-mass-storage.test.ts test #2 documents.
      this.managedFiles.delete(track.filePath);
      throw err;
    }
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

  /**
   * Write artwork bytes for a track. Dispatches on `track.artworkSink`:
   *
   *   - `'embedded'` → queue a tag-writer picture write (taglib handles every
   *     container; flushed by {@link save}).
   *   - `'sidecar'`  → queue a peer `cover.jpg` write via {@link writeSidecar}.
   *   - `'noop'`     → device has no artwork support; silently drop.
   *
   * The bytes arrive already resized to the device's `artworkMaxResolution`
   * by the pipeline's album-level resize cache.
   */
  async setTrackArtwork(track: MassStorageTrack, imageData: Buffer): Promise<void> {
    switch (track.artworkSink) {
      case 'embedded':
        // Route through the tag writer. Reuses updateTrack's
        // pendingPictureWrites bookkeeping so taglib touches each file once
        // even when textual + picture updates collide.
        this.updateTrack(track, { embeddedPictureData: imageData });
        return;
      case 'sidecar':
        this.writeSidecar(track, imageData);
        return;
      case 'noop':
        // Device has no artwork support — the pipeline still gates the
        // syncTag.artworkHash claim on the sink, so dropping bytes here is
        // safe (no churn loop). Returning early matches the pre-refactor
        // MassStorageTrack.setArtworkFromData no-op behaviour.
        return;
    }
  }

  async removeTrackArtwork(_track: MassStorageTrack): Promise<void> {
    // No-op — mass-storage devices with embedded artwork as their primary
    // source should never have artwork stripped, since the device needs it.
    // Sidecar-primary devices could in principle delete `cover.jpg` here, but
    // the orphan-cleanup path in the doctor handles that case; keeping this
    // method symmetrically inert preserves today's behaviour.
  }

  /**
   * Queue a peer cover image (`{albumDir}/cover.jpg`) for write at save() time.
   *
   * Sidecar-primary devices (rockbox) read art from this file in preference to
   * any embedded picture; the pipeline calls this only when
   * `track.artworkSink === 'sidecar'` (see `MusicPipeline.transferArtwork`).
   *
   * Keyed by album directory, not file path: every track on the same album
   * dir hashes to the same map entry, so N sibling tracks queue exactly one
   * write. The bytes arrive pre-resized to `artworkMaxResolution` from the
   * pipeline's album-level resize cache (`getResizedArtwork`), so duplicate
   * enqueues from siblings agree on content — last write wins is a no-op
   * relative to the bytes.
   *
   * The cover file is added to {@link managedFiles} so the doctor's orphan
   * walk recognises it as podkit-managed (and so the manifest persists the
   * fact across sessions). The actual filesystem write is deferred to
   * {@link save}; this method is a pure queueing operation.
   */
  writeSidecar(track: MassStorageTrack, imageData: Buffer): void {
    const albumDir = path.dirname(track.filePath);
    this.pendingSidecarWrites.set(albumDir, imageData);
    const sidecarPath = path.join(albumDir, SIDECAR_FILENAME);
    this.managedFiles.add(sidecarPath);
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

    // Copy the new file to the target path (atomic: temp + rename)
    const dir = path.dirname(targetAbsolutePath);
    fs.mkdirSync(dir, { recursive: true });
    atomicCopyFile(newFilePath, targetAbsolutePath);

    // If path changed, delete the old file and update bookkeeping
    if (targetRelativePath !== track.filePath) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err: any) {
        // ENOENT is expected: the old file may not exist if the previous
        // sync left it under a different path. Anything else (EACCES,
        // EBUSY, EROFS) leaves an orphan we can't clean up — surface as a
        // warning so the user knows the file lingers, and a future doctor
        // pass can pick it up.
        if (err?.code !== 'ENOENT') {
          this.warningSink.emit({
            phase: 'execute',
            type: 'metadata',
            tracks: [
              {
                artist: track.artist ?? 'Unknown Artist',
                title: track.title ?? 'Unknown Title',
                album: track.album,
              },
            ],
            message: `replaceTrackFile: failed to remove old file ${track.filePath}: ${err?.message ?? String(err)} (file remains as orphan)`,
          });
        }
      }

      // Update allocatedPaths
      this.allocatedPaths.delete(track.filePath);
      this.allocatedPaths.add(targetRelativePath);

      // Update managedFiles
      this.managedFiles.delete(track.filePath);
      this.managedFiles.add(targetRelativePath);

      // Update pendingTagWrites if keyed on old path
      if (this.pendingTagWrites.has(track.filePath)) {
        const fields = this.pendingTagWrites.get(track.filePath)!;
        this.pendingTagWrites.delete(track.filePath);
        this.pendingTagWrites.set(targetRelativePath, fields);
      }

      // Update pendingPictureWrites if keyed on old path
      if (this.pendingPictureWrites.has(track.filePath)) {
        const pic = this.pendingPictureWrites.get(track.filePath)!;
        this.pendingPictureWrites.delete(track.filePath);
        this.pendingPictureWrites.set(targetRelativePath, pic);
      }

      // Re-key sidecar write if the album dir changed (codec swap can move
      // the file across content roots in pathological cases). Same rationale
      // as relocateTrack: only act when the album dir actually changed.
      const oldAlbumDir = path.dirname(track.filePath);
      const newAlbumDir = path.dirname(targetRelativePath);
      if (oldAlbumDir !== newAlbumDir && this.pendingSidecarWrites.has(oldAlbumDir)) {
        const sidecar = this.pendingSidecarWrites.get(oldAlbumDir)!;
        this.pendingSidecarWrites.delete(oldAlbumDir);
        this.pendingSidecarWrites.set(newAlbumDir, sidecar);
        const oldSidecarPath = path.join(oldAlbumDir, SIDECAR_FILENAME);
        const newSidecarPath = path.join(newAlbumDir, SIDECAR_FILENAME);
        if (this.managedFiles.has(oldSidecarPath)) {
          this.managedFiles.delete(oldSidecarPath);
          this.managedFiles.add(newSidecarPath);
        }
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
      artworkSink: this.artworkSink,
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
      this.queueTagWrite(targetRelativePath, { comment: track.comment });
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
    // Flush pending file moves (relocations) — must happen before tag writes
    // so that tag writes target the new file paths
    if (this.pendingMoves.size > 0) {
      // Accumulate ENOENT-skipped relocates so a single warning lands at the
      // end of the batch rather than N small ones (or worse, N stderr lines).
      const vanished: Array<{ artist: string; title: string; album?: string }> = [];

      // Memoize track lookup by path on first vanish to avoid O(N²) linear
      // scans through the tracks array when multiple ENOENT errors occur.
      let trackRefByPath:
        | Map<string, { artist: string; title: string; album?: string }>
        | undefined;

      for (const [oldPath, newPath] of this.pendingMoves) {
        const absOld = path.join(this.mountPoint, oldPath);
        const absNew = path.join(this.mountPoint, newPath);

        // Ensure target directory exists
        fs.mkdirSync(path.dirname(absNew), { recursive: true });

        // Same-filesystem rename (atomic, no data copy).
        // If the source file was removed externally, skip this move
        // rather than aborting all remaining moves in the batch.
        try {
          fs.renameSync(absOld, absNew);
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            if (!trackRefByPath) {
              trackRefByPath = new Map(
                this.tracks.map((t) => [
                  t.filePath,
                  {
                    artist: t.artist ?? 'Unknown Artist',
                    title: t.title ?? 'Unknown Track',
                    album: t.album,
                  },
                ])
              );
            }
            const ref = trackRefByPath.get(newPath) ?? {
              artist: 'Unknown Artist',
              title: 'Unknown Track',
            };
            vanished.push(ref);
            continue;
          }
          // Wrap raw fs errors so the categorizer doesn't have to substring-
          // match ENOSPC/EACCES out of the message. Single-cause aggregate.
          throw new MoveError([
            `${oldPath} → ${newPath}: ${(err as Error)?.message ?? String(err)}`,
          ]);
        }

        // Clean up empty parent directories of the old path
        let dir = path.dirname(absOld);
        const contentRoots = this.getContentRoots().map((r) =>
          r ? path.join(this.mountPoint, r) : this.mountPoint
        );
        const matchedRoot = contentRoots
          .filter((r) => dir.startsWith(r + '/') || dir.startsWith(r + path.sep) || dir === r)
          .sort((a, b) => b.length - a.length)[0];
        if (matchedRoot) {
          while (dir !== matchedRoot && dir.startsWith(matchedRoot) && dir !== this.mountPoint) {
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
      }
      this.pendingMoves.clear();

      // Surface the batch of vanished sources as a single warning. Each
      // entry is a track the user planned to relocate; the on-disk file
      // disappeared between plan and save. Sync still proceeds — the next
      // run's rescan will treat the missing file as orphaned and re-queue
      // whatever's appropriate.
      if (vanished.length > 0) {
        this.warningSink.emit({
          phase: 'execute',
          type: 'metadata',
          tracks: vanished,
          message: `${vanished.length} track(s) skipped relocate: source file disappeared between plan and save (external delete?)`,
        });
      }
    }

    // Flush pending tag writes to audio files. Concurrency is capped to
    // avoid `EMFILE` on large libraries — each writeTags opens the file
    // via node-taglib-sharp.
    if (this.pendingTagWrites.size > 0) {
      const entries = [...this.pendingTagWrites.entries()];
      const settled = await runWithConcurrency(
        entries.map(
          ([filePath, fields]) =>
            () =>
              this.tagWriter.writeTags(path.join(this.mountPoint, filePath), fields)
        ),
        DEFAULT_TAG_WRITE_CONCURRENCY
      );
      this.pendingTagWrites.clear();
      const failures: string[] = [];
      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i]!;
        if (outcome.status === 'rejected') {
          const [filePath] = entries[i]!;
          failures.push(`${filePath}: ${(outcome.reason as Error).message ?? outcome.reason}`);
        }
      }
      if (failures.length > 0) {
        // Surface as a single aggregated error so callers (sync executor)
        // can categorise it via instanceof TagWriteError. Per-file context
        // is preserved on `err.causes` for diagnostics. The next sync will
        // re-detect any unwritten diffs and retry — mass-storage reads file
        // tags as the source of truth on rescan.
        throw new TagWriteError(failures);
      }
    }

    // Flush pending picture writes (OGG/Opus artwork embedding).
    //
    // Collect-and-aggregate, mirroring the tag-write stage above (closes
    // doc-041 §3.1 / §7.1). Concurrency-capped to avoid EMFILE on large
    // libraries, settles all writes before checking failures so one failed
    // write doesn't black-hole the rest of the batch. Per-file context lives
    // on `err.causes` for diagnostics.
    if (this.pendingPictureWrites.size > 0) {
      const entries = [...this.pendingPictureWrites.entries()];
      const settled = await runWithConcurrency(
        entries.map(
          ([filePath, imageData]) =>
            () =>
              this.tagWriter.writePicture(path.join(this.mountPoint, filePath), imageData)
        ),
        DEFAULT_TAG_WRITE_CONCURRENCY
      );
      this.pendingPictureWrites.clear();
      const failures: string[] = [];
      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i]!;
        if (outcome.status === 'rejected') {
          const [filePath] = entries[i]!;
          failures.push(`${filePath}: ${(outcome.reason as Error).message ?? outcome.reason}`);
        }
      }
      if (failures.length > 0) {
        throw new PictureWriteError(failures);
      }
    }

    // Flush pending sidecar writes (peer cover.jpg for sidecar-primary devices).
    //
    // One write per album dir — sibling tracks collapse into a single entry at
    // queue-time. Each write is atomic (tmp + fsync + rename) so a SIGKILL
    // mid-write leaves either the old cover, no cover, or a `.podkit-tmp` for
    // a future doctor to clean — never a torn cover.jpg the device would
    // render as garbage.
    //
    // Collect-and-aggregate mirroring the tag-write and picture-write stages
    // above: `runWithConcurrency` caps open file handles at
    // `DEFAULT_TAG_WRITE_CONCURRENCY` for EMFILE safety on large libraries,
    // all writes settle before failures are inspected, and the map is cleared
    // before throw so a second `save()` doesn't re-attempt the same writes.
    //
    // Aggregation is per-album (not per-file) because the unit of work here is
    // one cover.jpg per directory — sibling tracks share the entry. This
    // asymmetry is intentional; see save-transactions.md §save-stage-asymmetries.
    if (this.pendingSidecarWrites.size > 0) {
      const entries = [...this.pendingSidecarWrites.entries()];
      const settled = await runWithConcurrency(
        entries.map(
          ([albumDir, imageData]) =>
            () =>
              writeSidecarAtomically(path.join(this.mountPoint, albumDir), imageData)
        ),
        DEFAULT_TAG_WRITE_CONCURRENCY
      );
      this.pendingSidecarWrites.clear();
      const failures: string[] = [];
      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i]!;
        if (outcome.status === 'rejected') {
          const [albumDir] = entries[i]!;
          failures.push(
            `${albumDir}: ${(outcome.reason as Error).message ?? String(outcome.reason)}`
          );
        }
      }
      if (failures.length > 0) {
        // Sidecar art is the device's PRIMARY artwork source on rockbox — a
        // failure means the device shows no cover. Throw a typed error so the
        // executor can surface it (rather than swallowing it as a warning,
        // which is what the per-track artwork branch in transferArtwork does
        // for transient errors). Per-album context is preserved on `causes`.
        throw new SidecarWriteError(failures);
      }
    }

    // Write manifest
    this.manifest.managedFiles = [...this.managedFiles].sort();
    this.manifest.lastSync = new Date().toISOString();

    const stateDir = path.join(this.mountPoint, PODKIT_DIR);
    fs.mkdirSync(stateDir, { recursive: true });

    // Atomic write: a SIGKILL mid-write must not leave a truncated manifest
    // (loadManifest swallows parse errors and treats the device as having no
    // managed files — invisible debris on every subsequent sync).
    const manifestPath = path.join(stateDir, MANIFEST_FILE);
    atomicWriteFile(manifestPath, JSON.stringify(this.manifest) + '\n', 'utf-8');
  }

  close(): void {
    // No resources to release for filesystem-based devices
  }

  setWarningSink(sink: WarningSink): void {
    this.warningSink = sink;
  }

  /**
   * Drop phantom manifest entries (rows whose backing file has vanished) from
   * both the in-memory `managedFiles` set AND the on-disk manifest.
   *
   * Atomic on disk: re-reads `state.json` to avoid clobbering concurrent edits,
   * removes the requested paths, and rewrites via {@link atomicWriteFile}
   * (tmp + rename). If any step fails the original manifest survives, the
   * in-memory state stays untouched, and the failure is reported per-path so
   * the caller can decide whether to surface it.
   *
   * Mass-storage only — see the DeviceAdapter JSDoc for why iPod omits this
   * method. The pre-sync sweep is the only caller today; the doctor's
   * `orphan-files` repair has its own equivalent pass that runs without an
   * open adapter.
   */
  async prunePhantomManifest(
    paths: string[]
  ): Promise<{ pruned: number; errors: Array<{ path: string; error: Error }> }> {
    if (paths.length === 0) {
      return { pruned: 0, errors: [] };
    }

    const stateDir = path.join(this.mountPoint, PODKIT_DIR);

    // Check for missing manifest before delegating — the adapter treats a
    // missing manifest as a per-path error (in-memory state claims managed
    // files exist but there's nothing on disk to rewrite, which is an
    // inconsistency worth surfacing). The util's ENOENT-as-no-op behaviour is
    // appropriate for the doctor path, which has no in-memory expectations.
    const manifestFilePath = path.join(stateDir, MANIFEST_FILE);
    try {
      await fs.promises.access(manifestFilePath);
    } catch {
      const error = new Error(`Manifest file not found: ${manifestFilePath}`);
      return { pruned: 0, errors: paths.map((p) => ({ path: p, error })) };
    }

    const result = await pruneManifestRows(stateDir, paths);

    // Update in-memory state only after the on-disk rewrite succeeded (i.e.
    // the util returned without errors from the write step). A subsequent
    // save() must not regress the prune back to disk. allocatedPaths is
    // unaffected: phantom rows correspond to files missing from disk, which
    // scanTracks() never recorded there.
    if (result.pruned > 0 && result.errors.length === 0) {
      const phantomSet = new Set(paths.map((p) => p.normalize('NFC')));
      for (const p of phantomSet) {
        this.managedFiles.delete(p);
      }
      // Re-read the manifest from disk so this.manifest stays in sync with
      // what pruneManifestRows wrote. If the read fails we leave this.manifest
      // stale — save() will overwrite with the current managedFiles set, which
      // is already correct (phantoms removed above).
      try {
        const raw = await fs.promises.readFile(manifestFilePath, 'utf-8');
        this.manifest = JSON.parse(raw);
      } catch {
        // Leave this.manifest stale — managedFiles is the source of truth for
        // the next save().
      }
    }

    return result;
  }

  /**
   * Look up the artist/title/album for a relocated track at save-time. The
   * pending-move queue is keyed by paths; the track ref is recovered by
   * matching the new path in the current track list.
   *
   * Returns a placeholder ref when the track can't be found — better to emit
   * a warning with `'Unknown Track'` than to drop the warning entirely.
   */
  private lookupTrackRef(filePath: string): { artist: string; title: string; album?: string } {
    const track = this.tracks.find((t) => t.filePath === filePath);
    return {
      artist: track?.artist ?? 'Unknown Artist',
      title: track?.title ?? 'Unknown Track',
      album: track?.album,
    };
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
        // Normalize stored paths to NFC for consistent Set lookups
        this.managedFiles = new Set(parsed.managedFiles.map((p: string) => p.normalize('NFC')));
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
            const relativePath = path.relative(this.mountPoint, absolutePath).normalize('NFC');
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
      skipCovers: false,
      duration: true,
    });

    const { common, format } = metadata;
    // Normalize to NFC — macOS filesystems may return NFD from readdir
    const relativePath = path.relative(this.mountPoint, absolutePath).normalize('NFC');
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
      artworkSink: this.artworkSink,
    });
  }

  /**
   * Read metadata from a video file and create a MassStorageTrack.
   *
   * Video files have minimal metadata compared to audio — we derive what we
   * can from the file path and any embedded tags.
   */
  private async readVideoMetadata(absolutePath: string): Promise<MassStorageTrack> {
    // Normalize to NFC — macOS filesystems may return NFD from readdir
    const relativePath = path.relative(this.mountPoint, absolutePath).normalize('NFC');
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
      artworkSink: this.artworkSink,
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
export function resolveFileExtension(filetype: string): string {
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
