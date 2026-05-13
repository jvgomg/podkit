/**
 * Tag writer for mass-storage devices — writes metadata tags to audio files.
 *
 * Uses node-taglib-sharp for format-correct tag writing across FLAC
 * (Vorbis comments), MP3 (ID3v2), M4A (MP4 atoms), and OGG/Opus (Vorbis
 * comments). Modifies files in-place without re-encoding.
 *
 * @module
 */

import { ByteVector, File as TagFile, Picture, PictureType } from 'node-taglib-sharp';

/**
 * Aggregated tag-write failure, thrown by `MassStorageAdapter.save()` when
 * one or more queued `writeTags` calls reject. The sync executor's error
 * categorizer uses an `instanceof` check to classify these as file-I/O
 * (`copy`) errors regardless of the per-file paths embedded in the message,
 * so paths containing keywords like "iPod" don't mis-classify as database
 * errors.
 *
 * Per-file failure messages are also preserved in `causes` for diagnostics.
 */
export class TagWriteError extends Error {
  readonly causes: readonly string[];

  constructor(causes: readonly string[]) {
    super(`tag write failed for ${causes.length} file(s): ${causes.join('; ')}`);
    this.name = 'TagWriteError';
    this.causes = causes;
  }
}

/**
 * Default concurrency cap for tag-write flushes during `save()`.
 *
 * Each call opens a file via node-taglib-sharp. Without a cap, syncing a
 * library of N tracks would fire N file descriptors at once and risk
 * `EMFILE` (Node's per-process FD limit is ~256 on macOS by default).
 * Sixteen is comfortably below that and still saturates disk I/O.
 */
export const DEFAULT_TAG_WRITE_CONCURRENCY = 16;

/**
 * Run a fixed-size pool of workers over `tasks`, returning per-task
 * settled outcomes in the original order. Same shape as
 * `Promise.allSettled` but with at most `limit` in-flight at any moment.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]!() };
      } catch (err) {
        results[i] = {
          status: 'rejected',
          reason: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Subset of audio-file metadata fields podkit can write to disk.
 *
 * All fields are optional: undefined means "leave the existing tag value
 * unchanged"; a defined value (including the empty string / number 0) is
 * applied as-is. Callers are expected to omit fields they have not
 * actually changed so the read-modify-write cycle stays minimal.
 */
export interface TagFields {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
  comment?: string;
}

/** Loose shape covering the readable subset (e.g. a DeviceTrack or the input payload). */
interface TagFieldsSource {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
  comment?: string;
}

/**
 * Project a TagFields-compatible source object (e.g. a `DeviceTrackInput`)
 * into a `TagFields` containing only the fields the caller actually
 * supplied. Used by `addTrack` flows to push input metadata into a tag
 * write.
 */
export function buildTagFieldsFromInput(source: TagFieldsSource): TagFields {
  const out: TagFields = {};
  if (source.title !== undefined) out.title = source.title;
  if (source.artist !== undefined) out.artist = source.artist;
  if (source.albumArtist !== undefined) out.albumArtist = source.albumArtist;
  if (source.album !== undefined) out.album = source.album;
  if (source.genre !== undefined) out.genre = source.genre;
  if (source.year !== undefined) out.year = source.year;
  if (source.trackNumber !== undefined) out.trackNumber = source.trackNumber;
  if (source.discNumber !== undefined) out.discNumber = source.discNumber;
  if (source.compilation !== undefined) out.compilation = source.compilation;
  if (source.comment !== undefined) out.comment = source.comment;
  return out;
}

/**
 * Produce the partial `TagFields` containing only the fields that have
 * actually changed between `current` (e.g. an existing on-device track)
 * and `fields` (the incoming update payload). Returns an empty object
 * when nothing differs — callers can use that as a no-op signal.
 */
export function diffTagFields(current: TagFieldsSource, fields: TagFieldsSource): TagFields {
  const out: TagFields = {};
  if (fields.title !== undefined && fields.title !== current.title) {
    out.title = fields.title;
  }
  if (fields.artist !== undefined && fields.artist !== current.artist) {
    out.artist = fields.artist;
  }
  if (fields.albumArtist !== undefined && fields.albumArtist !== current.albumArtist) {
    out.albumArtist = fields.albumArtist;
  }
  if (fields.album !== undefined && fields.album !== current.album) {
    out.album = fields.album;
  }
  if (fields.genre !== undefined && fields.genre !== current.genre) {
    out.genre = fields.genre;
  }
  if (fields.year !== undefined && fields.year !== current.year) {
    out.year = fields.year;
  }
  if (fields.trackNumber !== undefined && fields.trackNumber !== current.trackNumber) {
    out.trackNumber = fields.trackNumber;
  }
  if (fields.discNumber !== undefined && fields.discNumber !== current.discNumber) {
    out.discNumber = fields.discNumber;
  }
  if (fields.compilation !== undefined && fields.compilation !== current.compilation) {
    out.compilation = fields.compilation;
  }
  if (fields.comment !== undefined && fields.comment !== current.comment) {
    out.comment = fields.comment;
  }
  return out;
}

/**
 * Interface for writing metadata tags to audio files.
 * Injectable for testing — tests can provide a mock implementation.
 */
export interface TagWriter {
  /**
   * Apply a partial set of textual metadata fields to a file's tag block.
   * Opens, mutates, saves, and disposes in a single operation.
   */
  writeTags(filePath: string, fields: TagFields): Promise<void>;

  writeReplayGain(
    filePath: string,
    trackGain: number,
    trackPeak?: number,
    albumGain?: number,
    albumPeak?: number
  ): Promise<void>;

  writePicture(filePath: string, imageData: Buffer): Promise<void>;
}

/**
 * Tag writer using node-taglib-sharp.
 *
 * Field-to-container mappings node-taglib-sharp handles for us:
 * - FLAC/OGG/Opus: Vorbis comments (`TITLE`, `ARTIST`, `ALBUMARTIST`, …)
 * - MP3: ID3v2 frames (`TIT2`, `TPE1`, `TPE2`, …)
 * - M4A: MP4 atoms (`©nam`, `©ART`, `aART`, …)
 *
 * Modifies files in-place (no temp files or re-encoding needed).
 */
export class TagLibTagWriter implements TagWriter {
  async writeTags(filePath: string, fields: TagFields): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      const tag = file.tag;
      if (fields.title !== undefined) tag.title = fields.title;
      if (fields.artist !== undefined) tag.performers = [fields.artist];
      if (fields.albumArtist !== undefined) tag.albumArtists = [fields.albumArtist];
      if (fields.album !== undefined) tag.album = fields.album;
      if (fields.genre !== undefined) tag.genres = [fields.genre];
      if (fields.year !== undefined) tag.year = fields.year;
      if (fields.trackNumber !== undefined) tag.track = fields.trackNumber;
      if (fields.discNumber !== undefined) tag.disc = fields.discNumber;
      if (fields.compilation !== undefined) tag.isCompilation = fields.compilation;
      if (fields.comment !== undefined) tag.comment = fields.comment;
      file.save();
    } finally {
      file.dispose();
    }
  }

  async writeReplayGain(
    filePath: string,
    trackGain: number,
    trackPeak?: number,
    albumGain?: number,
    albumPeak?: number
  ): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      file.tag.replayGainTrackGain = trackGain;
      if (trackPeak !== undefined) {
        file.tag.replayGainTrackPeak = trackPeak;
      }
      if (albumGain !== undefined) {
        file.tag.replayGainAlbumGain = albumGain;
      }
      if (albumPeak !== undefined) {
        file.tag.replayGainAlbumPeak = albumPeak;
      }
      file.save();
    } finally {
      file.dispose();
    }
  }

  async writePicture(filePath: string, imageData: Buffer): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      const picture = Picture.fromData(ByteVector.fromByteArray(imageData));
      picture.type = PictureType.FrontCover;
      file.tag.pictures = [picture];
      file.save();
    } finally {
      file.dispose();
    }
  }
}
