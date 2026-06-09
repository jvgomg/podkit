/**
 * Tag writer for mass-storage devices — writes metadata tags to audio files.
 *
 * Uses node-taglib-sharp for format-correct tag writing across FLAC
 * (Vorbis comments), MP3 (ID3v2), M4A (MP4 atoms), and OGG/Opus (Vorbis
 * comments). Modifies files atomically (tmp + fsync + rename) so a SIGKILL
 * mid-write leaves either the old file or the new one — never a torn file.
 *
 * @module
 */

import * as fs from 'node:fs';

import { ByteVector, File as TagFile, Picture, PictureType, SeekOrigin } from 'node-taglib-sharp';
import type { IFileAbstraction, IStream } from 'node-taglib-sharp';

import { atomicWriteFileWithSync } from '../utils/atomic-fs.js';
import { CategorizedSyncError, errnoOf } from '../sync/engine/errors.js';
import type { ErrorCause } from '../sync/engine/types.js';

/**
 * Format a structured per-entry cause as a human-readable
 * `"${path}: ${message}"` line. The aggregate `causes: readonly string[]`
 * channel surfaces these strings as-is into the `--json` envelope; the
 * structured `ErrorCause[]` carries the errno separately for in-process
 * categorization. Kept in sync via the aggregate constructors below.
 */
function formatCause(cause: ErrorCause): string {
  return `${cause.path}: ${cause.message}`;
}

/**
 * In-memory stream backed by a dynamically resizable Buffer.
 *
 * node-taglib-sharp's `Stream` class only wraps file descriptors, so we
 * implement `IStream` ourselves. Taglib calls `setLength` when it wants to
 * truncate and may call `write` past the current end — we grow the buffer on
 * demand. The buffer's live region is `[0, _length)`.
 *
 * `read` and `write` both advance `position`. `setLength` is the only way to
 * shrink; `write` past the current length auto-extends.
 *
 * `_closed` records taglib's close() call so the abstraction's `closeStream`
 * no-op is observable for debugging; it is not enforced in read/write because
 * we own the buffer and a post-close read just returns the current contents.
 */
class BufferStream implements IStream {
  private _buf: Buffer;
  private _length: number;
  private _position: number = 0;
  private _closed = false;

  constructor(initial: Buffer) {
    // Copy so taglib mutations don't alias the source bytes.
    this._buf = Buffer.from(initial);
    this._length = initial.length;
  }

  get canWrite(): boolean {
    return true;
  }

  get length(): number {
    return this._length;
  }

  get position(): number {
    return this._position;
  }

  set position(value: number) {
    this._position = value;
  }

  close(): void {
    this._closed = true;
  }

  read(buffer: Uint8Array, offset: number, length: number): number {
    const available = Math.max(0, this._length - this._position);
    const bytes = Math.min(length, available);
    if (bytes > 0) {
      this._buf.copy(buffer as Buffer, offset, this._position, this._position + bytes);
      this._position += bytes;
    }
    return bytes;
  }

  seek(offset: number, origin: SeekOrigin): void {
    switch (origin) {
      case SeekOrigin.Begin:
        this._position = offset;
        break;
      case SeekOrigin.Current:
        this._position += offset;
        break;
      case SeekOrigin.End:
        this._position = this._length + offset;
        break;
    }
  }

  setLength(length: number): void {
    if (length < this._length) {
      this._length = length;
      if (this._position > this._length) {
        this._position = this._length;
      }
    } else if (length > this._buf.length) {
      // Grow backing buffer and zero-fill the new region.
      const next = Buffer.alloc(Math.max(length, this._buf.length * 2));
      this._buf.copy(next, 0, 0, this._length);
      this._buf = next;
      this._length = length;
    } else {
      this._length = length;
    }
  }

  write(buffer: Uint8Array | ByteVector, bufferOffset: number, length: number): number {
    const raw: Uint8Array = buffer instanceof ByteVector ? buffer.toByteArray() : buffer;
    const end = this._position + length;
    if (end > this._buf.length) {
      const next = Buffer.alloc(Math.max(end, this._buf.length * 2));
      this._buf.copy(next, 0, 0, this._length);
      this._buf = next;
    }
    (Buffer.isBuffer(raw) ? raw : Buffer.from(raw)).copy(
      this._buf,
      this._position,
      bufferOffset,
      bufferOffset + length
    );
    this._position += length;
    if (this._position > this._length) {
      this._length = this._position;
    }
    return length;
  }

  /**
   * Return the live region of the buffer (a slice copy, independent of the
   * internal buffer) so the caller can pass it to `atomicWriteFileWithSync`.
   */
  toBuffer(): Buffer {
    return Buffer.from(this._buf.slice(0, this._length));
  }
}

/**
 * A taglib `IFileAbstraction` that reads from and writes to an in-memory
 * `BufferStream` seeded with the original file contents.
 *
 * The `name` carries the original file path so the taglib resolver can infer
 * the container format from the extension (e.g. `.flac`, `.m4a`, `.mp3`).
 * No file I/O happens through this abstraction; all I/O is buffer-local.
 * After `file.save()`, call `abstraction.getWriteBuffer()` to obtain the
 * mutated bytes and pass them to `atomicWriteFileWithSync`.
 */
class BufferFileAbstraction implements IFileAbstraction {
  private readonly _name: string;
  private readonly _stream: BufferStream;

  constructor(filePath: string, contents: Buffer) {
    this._name = filePath;
    this._stream = new BufferStream(contents);
  }

  get name(): string {
    return this._name;
  }

  get readStream(): IStream {
    // Seek to the start each time taglib opens a fresh read stream.
    this._stream.seek(0, SeekOrigin.Begin);
    return this._stream;
  }

  get writeStream(): IStream {
    // taglib uses r+ semantics — read AND write on the same stream.
    this._stream.seek(0, SeekOrigin.Begin);
    return this._stream;
  }

  closeStream(_stream: IStream): void {
    // Buffer-backed — nothing to release; close() is a no-op.
  }

  getWriteBuffer(): Buffer {
    return this._stream.toBuffer();
  }
}

/**
 * Aggregated tag-write failure, thrown by `MassStorageAdapter.save()` when
 * one or more queued `writeTags` calls reject.
 *
 * Categorized as `copy` (file-I/O) via the class declaration so the executor's
 * categorizer reads it off the type without inspecting `message`. Per-file
 * failure descriptions live on `causes` (string lines for the `--json`
 * envelope) and `structuredCauses` (typed entries with errno for routing
 * `ENOSPC` to the `'space'` category).
 */
export class TagWriteError extends CategorizedSyncError {
  readonly category = 'copy' as const;

  constructor(causes: readonly ErrorCause[]) {
    const lines = causes.map(formatCause);
    super(`tag write failed for ${causes.length} file(s): ${lines.join('; ')}`, lines, causes);
  }
}

/**
 * Aggregated sidecar-write failure, thrown by `MassStorageAdapter.save()`
 * when one or more queued peer-image (`cover.jpg`) writes fail. Sidecar art
 * is the device's *primary* artwork source on sidecar-primary devices
 * (rockbox), so a failure is surfaced rather than swallowed — the audio file
 * landed, but the device has no cover to render.
 */
export class SidecarWriteError extends CategorizedSyncError {
  readonly category = 'copy' as const;

  constructor(causes: readonly ErrorCause[]) {
    const lines = causes.map(formatCause);
    super(`sidecar write failed for ${causes.length} album(s): ${lines.join('; ')}`, lines, causes);
  }
}

/**
 * Aggregated picture-write failure, thrown by `MassStorageAdapter.save()`
 * when one or more queued embedded-picture writes (OGG/Opus container picture
 * frames) fail. Closes doc-041 §3.1 's "untyped picture-write rejection" —
 * before this type existed, raw rejections fell through to substring-based
 * categorization and could mis-classify when a path embedded "iPod" or
 * "ffmpeg".
 */
export class PictureWriteError extends CategorizedSyncError {
  readonly category = 'copy' as const;

  constructor(causes: readonly ErrorCause[]) {
    const lines = causes.map(formatCause);
    super(`picture write failed for ${causes.length} file(s): ${lines.join('; ')}`, lines, causes);
  }
}

/**
 * Move (`renameSync`) failure during the move stage of
 * `MassStorageAdapter.save()`. Wraps the raw fs error so the categorizer
 * doesn't have to substring-match `ENOENT` / `EACCES` / `ENOSPC` out of the
 * message — the category is on the type, and the errno survives on the
 * structured cause for the `ENOSPC → 'space'` routing override.
 */
export class MoveError extends CategorizedSyncError {
  readonly category = 'copy' as const;

  constructor(causes: readonly ErrorCause[]) {
    const lines = causes.map(formatCause);
    super(`file move failed for ${causes.length} file(s): ${lines.join('; ')}`, lines, causes);
  }
}

/**
 * Track-body copy failure during `MassStorageAdapter.copyTrackFile` (or
 * `replaceTrackFile`). Wraps the raw fs error thrown out of
 * `atomicCopyFile` (which itself wraps `fs.copyFileSync` + `renameSync`)
 * so the executor's categorizer reads `category` off the type instead of
 * falling back to the operation-type table — and so the original errno
 * (`ENOSPC` / `EACCES` / `EROFS` / `ENOENT`) survives the wrap on the
 * `errorCode` field for consumers that want to branch.
 *
 * Single-cause aggregate (`causes.length === 1`) matching the other
 * per-track wraps in this file. The source path is folded into the cause
 * string so consumers reading `causes[0]` get the same `"<path>: <msg>"`
 * shape as `MoveError`.
 */
export class CopyError extends CategorizedSyncError {
  readonly category = 'copy' as const;

  /**
   * Underlying fs error code (`ENOSPC`, `EACCES`, `EROFS`, `ENOENT`, …)
   * recovered from the wrapped error's `code` property. `undefined` when
   * the underlying error carried no `code` (e.g. a synthetic test error).
   */
  readonly errorCode: string | undefined;

  /** Source path passed to `copyTrackFile`/`replaceTrackFile`. */
  readonly sourcePath: string;

  constructor(sourcePath: string, underlying: unknown) {
    const message = underlying instanceof Error ? underlying.message : String(underlying);
    const errno = errnoOf(underlying);
    const structured: ErrorCause = { path: sourcePath, message, errno };
    super(
      `file copy failed for 1 file(s): ${formatCause(structured)}`,
      [formatCause(structured)],
      [structured]
    );
    this.sourcePath = sourcePath;
    this.errorCode = errno;
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
  const results: Array<PromiseSettledResult<T>> = Array.from({ length: tasks.length });
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
 * ReplayGain fields written into the tag block alongside textual metadata.
 *
 * `trackGain` is required; the peak/album fields are independent and only
 * applied when defined. The taglib accessors map these into the right
 * tag-format dialect — Vorbis comments on FLAC/OGG/Opus, ID3v2 `TXXX`
 * frames on MP3, and `----:com.apple.iTunes:REPLAYGAIN_*` freeform atoms
 * on M4A (NOT the iTunNORM atom — that's a different normalisation
 * mechanism only soundcheck-style devices read).
 */
export interface ReplayGainFields {
  trackGain: number;
  trackPeak?: number;
  albumGain?: number;
  albumPeak?: number;
}

/**
 * Subset of audio-file metadata fields podkit can write to disk.
 *
 * All fields are optional: undefined means "leave the existing tag value
 * unchanged"; a defined value (including the empty string / number 0) is
 * applied as-is. Callers are expected to omit fields they have not
 * actually changed so the read-modify-write cycle stays minimal.
 *
 * `replayGain` rides on the same tag block and is applied in the same
 * read-modify-write cycle as the textual fields — folding the formerly-
 * separate `writeReplayGain` path into `writeTags` halves the taglib I/O
 * when a track has both kinds of pending updates (common after a transcode
 * on a `audioNormalization === 'replaygain'` device).
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
  replayGain?: ReplayGainFields;
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
   * Apply a partial set of metadata fields (textual + ReplayGain) to a
   * file's tag block in a single read-modify-write cycle. Picture writes
   * stay separate because binary embedding has format-specific quirks
   * (METADATA_BLOCK_PICTURE on OGG, cover atom on M4A) that don't share
   * enough surface with text-tag writes to merge cleanly.
   */
  writeTags(filePath: string, fields: TagFields): Promise<void>;

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
 * Writes are atomic: taglib modifies an in-memory buffer (seeded with the
 * original file bytes), then `atomicWriteFileWithSync` writes the result to a
 * sibling `.podkit-tmp` and renames over the target. A SIGKILL mid-write
 * leaves either the original file or the new file — the `.podkit-tmp` is
 * cleaned by `podkit doctor`.
 *
 * Trade-off: the audio body is loaded into memory for each tag mutation
 * because node-taglib-sharp's `IStream` interface has no streaming
 * alternative. Sized for typical device tracks (single-digit to mid-tens MB);
 * a >100 MB high-res FLAC will allocate that much heap per call. Acceptable
 * given save() runs serially per file and the helper writes one file at a time.
 */
export class TagLibTagWriter implements TagWriter {
  async writeTags(filePath: string, fields: TagFields): Promise<void> {
    const contents = await fs.promises.readFile(filePath);
    const abstraction = new BufferFileAbstraction(filePath, contents);
    const file = TagFile.createFromAbstraction(abstraction);
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
      if (fields.replayGain !== undefined) {
        const rg = fields.replayGain;
        tag.replayGainTrackGain = rg.trackGain;
        if (rg.trackPeak !== undefined) tag.replayGainTrackPeak = rg.trackPeak;
        if (rg.albumGain !== undefined) tag.replayGainAlbumGain = rg.albumGain;
        if (rg.albumPeak !== undefined) tag.replayGainAlbumPeak = rg.albumPeak;
      }
      file.save();
    } finally {
      file.dispose();
    }
    await atomicWriteFileWithSync(filePath, abstraction.getWriteBuffer());
  }

  async writePicture(filePath: string, imageData: Buffer): Promise<void> {
    const contents = await fs.promises.readFile(filePath);
    const abstraction = new BufferFileAbstraction(filePath, contents);
    const file = TagFile.createFromAbstraction(abstraction);
    try {
      const picture = Picture.fromData(ByteVector.fromByteArray(imageData));
      picture.type = PictureType.FrontCover;
      file.tag.pictures = [picture];
      file.save();
    } finally {
      file.dispose();
    }
    await atomicWriteFileWithSync(filePath, abstraction.getWriteBuffer());
  }
}
