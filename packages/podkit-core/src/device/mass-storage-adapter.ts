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
import { CategorizedSyncError, toErrorCause } from '../sync/engine/errors.js';

import type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './adapter.js';
import type { ErrorCause, WarningSink } from '../sync/engine/types.js';
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
  CopyError,
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
    //
    // The `'pre-rename-track'` pause key is a test seam — see
    // `documents/architecture/dev-builds.md`. In a debug build invoked
    // with `PODKIT_DEV_PAUSE_KEY=pre-rename-track`, the call blocks
    // forever after the `.podkit-tmp` lands but before the rename, so
    // e2e tests can SIGKILL the sync and assert the next sync's sweep
    // cleans the debris. Production builds tree-shake the entire branch
    // — the string literal does not survive the bundle.
    if (typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__) {
      atomicCopyFile(sourcePath, absolutePath, 'pre-rename-track');
    } else {
      atomicCopyFile(sourcePath, absolutePath);
    }

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
  /**
   * `lastSync` carried over from a previously-loaded manifest, surfaced
   * here so `save()` can promote it forward if nothing on disk changed.
   * `save()` overwrites this with `new Date().toISOString()` unconditionally
   * today; the field exists so a future `save()` that wants to skip the
   * timestamp bump (e.g. a metadata-only flush) has a place to read from.
   *
   * The envelope itself (`{ version, managedFiles, lastSync }`) is
   * reconstructed at save-time from `managedFiles` + this value — there is
   * no in-memory `manifest` to drift out of sync with `managedFiles`.
   */
  private lastSync: string | undefined;
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
   * Pending sidecar deletions, keyed by **album directory** (relative to the
   * mount point). Recorded when {@link removeTrack} drops the last managed
   * audio from a sidecar-primary album dir, or when {@link relocateTrack}
   * moves the last track out cross-album. Flushed by {@link save} after the
   * sidecar-write stage so that a re-add (write + delete queued for the same
   * dir in one save) leaves the file present.
   *
   * The queue-time check is optimistic: it asks "is there any other managed
   * track in this dir right now?" — but in-flight plan steps may add or move
   * tracks back into the dir after the delete is queued. The flush stage
   * re-evaluates the predicate against the final `this.tracks` state and
   * skips stale entries; the manifest record (sidecar entry in
   * `managedFiles`) is the source of truth and is restored if a write
   * superseded the delete.
   */
  private pendingSidecarDeletes = new Set<string>();

  /**
   * Pending file moves, keyed by current relative path. Value carries the new
   * relative path plus the track's metadata ref captured at plan time. The ref
   * is captured eagerly (rather than reconstructed from `this.tracks` at flush
   * time) so an ENOENT warning emits the original artist/title even if the
   * track instance was subsequently mutated or removed. Accumulated by
   * relocateTrack() and flushed by save() via fs.rename().
   */
  private pendingMoves = new Map<
    string,
    { newPath: string; trackRef: { artist: string; title: string; album?: string } }
  >();

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
    this.lastSync = undefined;
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
   * Migrate every pending-write entry keyed on `oldPath` to `newPath`.
   *
   * Called by `relocateTrack` (same-extension renames, path-template moves)
   * and `replaceTrackFile` (codec-swap transcodes that change the extension).
   * Both call sites used to inline the same set of re-key dances for each
   * pending map; this helper is the single point of truth so adding a new
   * pending map (lyrics, playlist updates) only requires one edit.
   *
   * What gets re-keyed:
   *
   * - `pendingTagWrites` / `pendingPictureWrites` are keyed by **file path** —
   *   simple swap of map entry.
   * - `pendingSidecarWrites` is keyed by **album directory** — the audio
   *   file's parent dir. Re-key only fires when the dirname actually changes
   *   (cross-album-dir relocate / codec swap that crosses content roots).
   *   The sidecar's `cover.jpg` path lives in `managedFiles` so the manifest
   *   tracks it across sessions; both ends are updated atomically here.
   *
   * No-op when `oldPath === newPath`. Safe to call before or after the
   * `pendingMoves` entry is queued — the move stage flushes via raw rename
   * and doesn't read any pending-write map.
   */
  private rekeyPendingWrites(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;

    const tagFields = this.pendingTagWrites.get(oldPath);
    if (tagFields !== undefined) {
      this.pendingTagWrites.delete(oldPath);
      this.pendingTagWrites.set(newPath, tagFields);
    }
    const picture = this.pendingPictureWrites.get(oldPath);
    if (picture !== undefined) {
      this.pendingPictureWrites.delete(oldPath);
      this.pendingPictureWrites.set(newPath, picture);
    }

    const oldDir = path.dirname(oldPath);
    const newDir = path.dirname(newPath);
    if (oldDir === newDir) return;

    const sidecar = this.pendingSidecarWrites.get(oldDir);
    if (sidecar !== undefined) {
      this.pendingSidecarWrites.delete(oldDir);
      this.pendingSidecarWrites.set(newDir, sidecar);
      const oldSidecarPath = path.join(oldDir, SIDECAR_FILENAME);
      const newSidecarPath = path.join(newDir, SIDECAR_FILENAME);
      if (this.managedFiles.has(oldSidecarPath)) {
        this.managedFiles.delete(oldSidecarPath);
        this.managedFiles.add(newSidecarPath);
      }
    }
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

    this.rekeyPendingWrites(oldPath, finalPath);

    // Queue the filesystem move. Capture the track's identity now so an
    // ENOENT at flush time can surface real artist/title — no later lookup
    // against the mutable `this.tracks` array required.
    this.pendingMoves.set(oldPath, {
      newPath: finalPath,
      trackRef: {
        artist: track.artist,
        title: track.title,
        album: track.album,
      },
    });

    // Create a new track instance with updated path
    const relocated = track.withPath(finalPath);

    // Replace in track list
    const index = this.tracks.findIndex((t) => t.filePath === oldPath);
    if (index >= 0) {
      this.tracks[index] = relocated;
    }

    // Cross-album relocate: the source dir may have just lost its last
    // track. Queue a sidecar delete for the old dir; the flush re-evaluates,
    // so it's a no-op if siblings remain or another move targets the dir.
    // Same-dir relocates (codec swap, dedupe-suffix) are no-ops since the
    // source dir still owns the track at the new path. Relocating INTO a
    // dir already in pendingSidecarDeletes doesn't need an explicit clear:
    // flushSidecarDeletes re-checks `albumDirStillOccupied(newDir)` and
    // discovers the new track, then skips the delete.
    const oldDir = path.dirname(oldPath);
    const newDir = path.dirname(finalPath);
    if (oldDir !== newDir) {
      this.maybeQueueSidecarDelete(oldDir);
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
      // Roll back the state addTrack added so the executor's retry path
      // sees a clean adapter:
      //   - managedFiles: otherwise a later checkpoint save() (driven by a
      //     different successful track) would persist a phantom path the
      //     file copy never produced — the "manifest references missing
      //     file" class that orphans-mass-storage.test.ts test #2 documents.
      //   - allocatedPaths + tracks: otherwise the retry's `addTrack` would
      //     see `allocatedPaths.has(desiredPath) && !managedFiles.has(...)`
      //     and throw the "occupied by an unmanaged file" collision error,
      //     swallowing the original CopyError that caused the first attempt
      //     to fail. The retry should re-attempt the same path with a clean
      //     slate, not collide with the in-memory state from attempt 1.
      //   - pendingTagWrites / pendingPictureWrites: addTrack queues a
      //     `comment` tag write at allocation time, and the artwork pipeline
      //     can queue a picture write before copyTrackFile fires; without
      //     this cleanup, save() later tries to write tags into a file the
      //     copy never produced and throws ENOENT as a second classification.
      //     For an ENOSPC copy that no longer retries (category 'space',
      //     0 retries via the categorizer override) the second error was
      //     pure noise — same track failing twice with two different
      //     categories. Sidecar map is album-dir-keyed and shared across
      //     siblings, so it's NOT cleared here — other tracks in the album
      //     may still need the cover.
      this.managedFiles.delete(track.filePath);
      this.allocatedPaths.delete(track.filePath);
      this.pendingTagWrites.delete(track.filePath);
      this.pendingPictureWrites.delete(track.filePath);
      const idx = this.tracks.findIndex((t) => t.filePath === track.filePath);
      if (idx >= 0) {
        this.tracks.splice(idx, 1);
      }
      // Wrap raw fs errors in a typed CopyError so the executor's
      // categorizer reads `category: 'copy'` off the class instead of
      // falling back to the operation-type table — and so the original
      // errno survives on `errorCode` for consumers (e.g. the matrix
      // harness) that want to branch ENOSPC vs EACCES vs EROFS without
      // scraping the message.
      if (err instanceof CategorizedSyncError) {
        throw err;
      }
      throw new CopyError(sourcePath, err);
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

    // Sidecar cleanup: when removing the last managed track from an album
    // dir on a sidecar-primary device, the peer cover.jpg has no audio to
    // accompany anymore. Skip when the caller retained the audio file
    // (`deleteFile: false`) or when the track wasn't podkit-managed — in
    // both cases the on-disk layout still mirrors a managed-audio dir.
    if (deleteFile && track.managed) {
      this.maybeQueueSidecarDelete(path.dirname(track.filePath));
    }
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
    // No-op — embedded-art devices need the picture for playback display, so
    // never strip. Sidecar-primary devices don't delete `cover.jpg` here
    // either: sidecars are album-level, not per-track, and the album may
    // still hold other tracks. Whole-album cleanup is handled at sync time
    // in {@link removeTrack} / {@link relocateTrack} via
    // {@link maybeQueueSidecarDelete}, not via per-track art removal.
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
    // A pending delete for the same dir means a previous removeTrack queued
    // cleanup, then a re-add (or relocate-into) brought the album back. Write
    // wins — clear the delete so the flush stage doesn't undo the write.
    this.pendingSidecarDeletes.delete(albumDir);
    const sidecarPath = path.join(albumDir, SIDECAR_FILENAME);
    this.managedFiles.add(sidecarPath);
  }

  /**
   * Queue a sidecar (`{albumDir}/cover.jpg`) for deletion when no other
   * managed audio file remains in the album dir. No-op for non-sidecar
   * devices and for dirs that still hold managed audio (siblings of the
   * just-removed track).
   *
   * Called by {@link removeTrack} and {@link relocateTrack} after the
   * track-list mutation has settled, so `this.tracks` reflects the post-op
   * state. {@link managedFiles} is NOT mutated here — the drop is deferred
   * to {@link flushSidecarDeletes} which re-evaluates the predicate before
   * acting. That makes the re-add case (track relocated/added into the dir
   * AFTER the delete was queued, without going through {@link writeSidecar}
   * — e.g. artwork hash matched and the pipeline skipped sidecar write)
   * self-healing: a stale queue entry is simply ignored and the manifest
   * retains the sidecar.
   *
   * The queue-time predicate check is an optimistic gate to avoid the
   * obvious "remove one of three siblings" no-op enqueue; flush-time is
   * authoritative.
   */
  private maybeQueueSidecarDelete(albumDir: string): void {
    if (this.artworkSink !== 'sidecar') return;
    if (this.albumDirStillOccupied(albumDir)) return;
    this.pendingSidecarDeletes.add(albumDir);
  }

  /**
   * True when any managed track currently sits in `albumDir`, OR when a
   * pending move targets `albumDir` (a track on its way into the dir
   * should keep the sidecar alive even though `this.tracks` doesn't yet
   * reflect the destination path).
   */
  private albumDirStillOccupied(albumDir: string): boolean {
    for (const t of this.tracks) {
      if (path.dirname(t.filePath) === albumDir) return true;
    }
    for (const { newPath } of this.pendingMoves.values()) {
      if (path.dirname(newPath) === albumDir) return true;
    }
    return false;
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

    // Copy the new file to the target path (atomic: temp + rename).
    // Wrap raw fs errors — both from `mkdirSync` (EACCES/EROFS on the
    // album dir) and from `atomicCopyFile` (ENOSPC mid-write, EACCES/EROFS
    // on the rename) — in CopyError so the categorizer reads category off
    // the type. Same rationale as copyTrackFile above.
    const dir = path.dirname(targetAbsolutePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      atomicCopyFile(newFilePath, targetAbsolutePath);
    } catch (err) {
      if (err instanceof CategorizedSyncError) {
        throw err;
      }
      throw new CopyError(newFilePath, err);
    }

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
                artist: track.artist,
                title: track.title,
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

      this.rekeyPendingWrites(track.filePath, targetRelativePath);
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

  /**
   * Flush in-memory mutations to the device.
   *
   * Five ordered stages, each gating the next. Within a flush stage, all writes
   * settle before failures are surfaced (see `flushPending` for the shared
   * shape used by stages 2–4). The move stage is bespoke — fail-fast,
   * ENOENT-skip with warning, no clear-on-throw — see
   * `documents/architecture/sync/save-transactions.md` §save-stage-asymmetries.
   *
   * Moves run first so subsequent tag/picture writes target the new paths.
   * The manifest is written last so a torn save doesn't promote half-flushed
   * state into the persisted view of "what podkit owns".
   */
  async save(): Promise<void> {
    await this.flushMoves();
    await this.flushTagWrites();
    await this.flushPictureWrites();
    await this.flushSidecarWrites();
    await this.flushSidecarDeletes();
    this.writeManifest();
  }

  /**
   * Stage 1: flush pending file moves (relocations).
   *
   * Bespoke shape (see save-transactions.md §asymmetries):
   * - `for...of` over `pendingMoves`, fail-fast on first non-ENOENT.
   * - ENOENT means the source vanished between plan and save (external
   *   delete) — skip + accumulate into a single batched warning instead of
   *   spamming N warnings or aborting the batch.
   * - `pendingMoves` is cleared on full success only; surviving entries
   *   re-fire on the next `save()` (the ENOENT-skip path is idempotent —
   *   moved files become missing, queued for next-run rescan).
   *
   * Must run before tag/picture writes so those stages target the new paths.
   */
  private async flushMoves(): Promise<void> {
    if (this.pendingMoves.size === 0) return;

    // Accumulate ENOENT-skipped relocates so a single warning lands at the
    // end of the batch rather than N small ones (or worse, N stderr lines).
    const vanished: Array<{ artist: string; title: string; album?: string }> = [];

    for (const [oldPath, { newPath, trackRef }] of this.pendingMoves) {
      const absOld = path.join(this.mountPoint, oldPath);
      const absNew = path.join(this.mountPoint, newPath);

      fs.mkdirSync(path.dirname(absNew), { recursive: true });

      // Same-filesystem rename (atomic, no data copy).
      // If the source file was removed externally, skip this move
      // rather than aborting all remaining moves in the batch.
      try {
        fs.renameSync(absOld, absNew);
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          vanished.push(trackRef);
          continue;
        }
        // Wrap raw fs errors so the categorizer reads category off the type
        // (and errno off the structured cause) instead of substring-matching
        // the message. The errno survives so an ENOSPC move routes to the
        // `'space'` category override — no wasted retry.
        throw new MoveError([toErrorCause(`${oldPath} → ${newPath}`, err)]);
      }

      this.cleanupEmptyParentDirs(absOld);
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

  /**
   * Walk up from `absPath`'s parent directory removing empty dirs until we
   * hit a content root or a non-empty entry. Best-effort — any I/O error
   * (EBUSY mid-sync, race with another writer) stops the walk silently;
   * leftover empty dirs are recovered by the next sync's pre-flight sweep
   * or `podkit doctor`. Used after a file move/delete to keep the device
   * tree tidy.
   */
  private cleanupEmptyParentDirs(absPath: string): void {
    let dir = path.dirname(absPath);
    const contentRoots = this.getContentRoots().map((r) =>
      r ? path.join(this.mountPoint, r) : this.mountPoint
    );
    const matchedRoot = contentRoots
      .filter((r) => dir.startsWith(r + '/') || dir.startsWith(r + path.sep) || dir === r)
      .sort((a, b) => b.length - a.length)[0];
    if (!matchedRoot) return;
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

  /**
   * Shared shape for stages 2–4 of {@link save}.
   *
   * Runs every pending entry through `work` concurrently (capped by
   * `concurrency` for EMFILE safety on large libraries), settles all writes
   * before surfacing failures, clears the map BEFORE throwing, then —
   * if any entries failed — builds typed `ErrorCause[]` (path + message +
   * errno) and throws a typed aggregate via `ErrorCtor`.
   *
   * Stage 1 (moves) stays bespoke — fail-fast, ENOENT-skip, no-clear-on-
   * throw — see `flushMoves` and save-transactions.md §asymmetries.
   *
   * @param map           pending state to flush; cleared before throw on
   *                      failure, or after a clean run.
   * @param work          per-entry I/O. Rejection captured into `ErrorCause`.
   * @param formatPath    project the map key into the `ErrorCause.path`
   *                      string. File-path keys pass through; album-dir keys
   *                      pass through; tuple keys can format as needed.
   * @param ErrorCtor     class to throw when any entry failed. Must take
   *                      `readonly ErrorCause[]`.
   * @param concurrency   in-flight cap. Defaults to
   *                      `DEFAULT_TAG_WRITE_CONCURRENCY`.
   */
  private async flushPending<K, V>(
    map: Map<K, V>,
    work: (key: K, value: V) => Promise<void>,
    formatPath: (key: K) => string,
    ErrorCtor: new (causes: readonly ErrorCause[]) => CategorizedSyncError,
    concurrency: number = DEFAULT_TAG_WRITE_CONCURRENCY
  ): Promise<void> {
    if (map.size === 0) return;
    const entries = [...map.entries()];
    const settled = await runWithConcurrency(
      entries.map(
        ([k, v]) =>
          () =>
            work(k, v)
      ),
      concurrency
    );
    map.clear();
    const failures: ErrorCause[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i]!;
      if (outcome.status === 'rejected') {
        failures.push(toErrorCause(formatPath(entries[i]![0]), outcome.reason));
      }
    }
    if (failures.length > 0) {
      throw new ErrorCtor(failures);
    }
  }

  /**
   * Stage 2: flush pending textual tag writes to audio files.
   *
   * Concurrency-capped settle-all, clear-before-throw, typed aggregate on
   * failure — see {@link flushPending}. Self-healing via rescan is the retry
   * path; mass-storage reads file tags as the source of truth so the next
   * sync re-detects any unwritten diffs.
   */
  private flushTagWrites(): Promise<void> {
    return this.flushPending(
      this.pendingTagWrites,
      (filePath, fields) => this.tagWriter.writeTags(path.join(this.mountPoint, filePath), fields),
      (filePath) => filePath,
      TagWriteError
    );
  }

  /**
   * Stage 3: flush pending embedded picture writes (OGG/Opus artwork).
   * Closes doc-041 §3.1 / §7.1 — same shape as stages 2 and 4 via
   * {@link flushPending}.
   */
  private flushPictureWrites(): Promise<void> {
    return this.flushPending(
      this.pendingPictureWrites,
      (filePath, imageData) =>
        this.tagWriter.writePicture(path.join(this.mountPoint, filePath), imageData),
      (filePath) => filePath,
      PictureWriteError
    );
  }

  /**
   * Stage 4: flush pending peer cover.jpg writes (sidecar-primary devices).
   *
   * One write per album dir — sibling tracks collapse to a single entry at
   * queue-time. Each write is atomic (tmp + fsync + rename) so a SIGKILL
   * mid-write leaves either the old cover, no cover, or a `.podkit-tmp` for
   * a future doctor to clean — never a torn cover.jpg the device would
   * render as garbage.
   *
   * Aggregation is per-album (not per-file) because the unit of work here is
   * one cover.jpg per directory; the map key IS the album dir. See
   * save-transactions.md §save-stage-asymmetries.
   *
   * Sidecar art is the device's PRIMARY artwork source on rockbox — failure
   * means the device shows no cover, so the typed aggregate is surfaced
   * rather than swallowed as a warning.
   */
  private flushSidecarWrites(): Promise<void> {
    return this.flushPending(
      this.pendingSidecarWrites,
      (albumDir, imageData) =>
        writeSidecarAtomically(path.join(this.mountPoint, albumDir), imageData),
      (albumDir) => albumDir,
      SidecarWriteError
    );
  }

  /**
   * Sibling of {@link flushSidecarWrites} — runs after writes so a re-add
   * (write + delete queued for the same dir in one save) leaves the file
   * present. Each entry's predicate is re-evaluated against the current
   * `this.tracks` state to catch re-adds that bypassed {@link writeSidecar}
   * (e.g. hash match → pipeline skipped sidecar transfer).
   *
   * ENOENT is silent success: a manifest entry that points at a missing
   * cover.jpg (legacy data from a podkit version before sidecar writes
   * existed, or a torn prior save) still needs the entry dropped so the
   * next sync's symmetric pass doesn't flag it as missing.
   * Other unlink errors surface as a typed {@link SidecarWriteError} —
   * symmetric with the write stage; aggregation lets the categorizer pick
   * a category off the class and surface every failed album in one error.
   *
   * `managedFiles` mutation happens here (not at queue time) so a stale
   * queue entry that fails its flush-time predicate check leaves the
   * manifest intact — no restore branch needed.
   */
  private async flushSidecarDeletes(): Promise<void> {
    if (this.pendingSidecarDeletes.size === 0) return;
    const entries = [...this.pendingSidecarDeletes];
    this.pendingSidecarDeletes.clear();

    const failures: ErrorCause[] = [];
    for (const albumDir of entries) {
      // Authoritative re-check: a track relocated/added into this dir after
      // the queue (without going through writeSidecar) means the sidecar
      // is still needed. Skip silently — the manifest entry stays.
      if (this.albumDirStillOccupied(albumDir)) continue;

      const sidecarPath = path.join(albumDir, SIDECAR_FILENAME);
      const absPath = path.join(this.mountPoint, sidecarPath);
      try {
        await fs.promises.unlink(absPath);
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          failures.push(toErrorCause(sidecarPath, err));
          continue;
        }
      }
      this.managedFiles.delete(sidecarPath);
    }

    if (failures.length > 0) {
      throw new SidecarWriteError(failures);
    }
  }

  /**
   * Stage 5: write the manifest. The envelope is reconstructed fresh every
   * `save()` from the current `managedFiles` set + a refreshed `lastSync`
   * timestamp — there is no in-memory manifest object that has to be kept
   * in sync with `managedFiles`, which removes a class of "forgot to update
   * both" bugs as the schema grows.
   *
   * Atomic write: a SIGKILL mid-write must not leave a truncated manifest
   * (loadManifest swallows parse errors and treats the device as having no
   * managed files — invisible debris on every subsequent sync).
   */
  private writeManifest(): void {
    this.lastSync = new Date().toISOString();
    const manifest: MassStorageManifest = {
      version: 1,
      managedFiles: [...this.managedFiles].sort(),
      lastSync: this.lastSync,
    };

    const stateDir = path.join(this.mountPoint, PODKIT_DIR);
    fs.mkdirSync(stateDir, { recursive: true });

    const manifestPath = path.join(stateDir, MANIFEST_FILE);
    atomicWriteFile(manifestPath, JSON.stringify(manifest) + '\n', 'utf-8');
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
    //
    // No re-read of the on-disk manifest is needed: the envelope is
    // reconstructed fresh by save() from `managedFiles` + `lastSync`, and
    // both are already authoritative in memory once we delete the
    // phantoms below.
    if (result.pruned > 0 && result.errors.length === 0) {
      const phantomSet = new Set(paths.map((p) => p.normalize('NFC')));
      for (const p of phantomSet) {
        this.managedFiles.delete(p);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Load the manifest from disk (if it exists).
   *
   * Hydrates the in-memory mirrors of the on-disk fields:
   * - `managedFiles` from `parsed.managedFiles` (NFC-normalised for
   *   cross-FS Set lookups).
   * - `lastSync` from `parsed.lastSync` so `save()` can promote it forward
   *   (today it overwrites with a fresh timestamp; this field exists so a
   *   future "metadata-only" save can preserve the prior value).
   *
   * The envelope shape itself is not retained — `save()` reconstructs it
   * fresh from `managedFiles` + `lastSync` so there is no in-memory
   * manifest object to drift out of sync with `managedFiles`. Missing /
   * unparseable / unrecognised-shape manifests are treated as "no managed
   * files yet" and leave both fields at their constructor defaults.
   */
  private loadManifest(): void {
    const manifestPath = path.join(this.mountPoint, PODKIT_DIR, MANIFEST_FILE);

    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as MassStorageManifest;
      if (parsed.version === 1 && Array.isArray(parsed.managedFiles)) {
        // Normalize stored paths to NFC for consistent Set lookups
        this.managedFiles = new Set(parsed.managedFiles.map((p: string) => p.normalize('NFC')));
        this.lastSync = parsed.lastSync;
      }
    } catch {
      // No manifest yet — all existing files are unmanaged
      this.lastSync = undefined;
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
