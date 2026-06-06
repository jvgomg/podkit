/**
 * IpodDeviceAdapter — wraps IpodDatabase to implement DeviceAdapter
 *
 * This is a thin wrapper that delegates to IpodDatabase. It exists so the
 * sync engine can work against the generic DeviceAdapter interface without
 * knowing about iPod-specific concerns (playlists, artwork database, etc.).
 *
 * IpodTrack extends DeviceTrack, so no mapping is needed for
 * getTracks() — we return IpodTrack instances directly.
 *
 * ## Transfer-mode-aware on-disk tag writes
 *
 * iPod firmware reads playback metadata from iTunesDB, not from file tags.
 * For `fast` and `optimized` transfer modes the adapter therefore touches
 * the iTunesDB only and leaves the audio file's embedded tags as FFmpeg
 * produced them at transcode time.
 *
 * Under `portable` the contract changes: the user has signalled they want
 * the file to make sense if pulled off the device. The adapter mirrors the
 * iTunesDB metadata into the audio file's embedded tags via the same
 * `TagWriter` interface that mass-storage uses. The F00/F01-style filename
 * the iPod assigns is still opaque, so portable on iPod is best-effort
 * recovery — failures are surfaced as warnings, not hard errors.
 *
 * @module
 */

import * as path from 'node:path';

import type { DeviceAdapter, DeviceTrackInput, DeviceTrackMetadata } from './adapter.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { IpodDatabase } from '../ipod/database.js';
import type { IpodTrack, TrackInput, TrackFields } from '../ipod/types.js';
import type { SyncTagData, SyncTagUpdate } from '../metadata/sync-tags.js';
import { parseSyncTag, writeSyncTag } from '../metadata/sync-tags.js';
import type { AudioNormalization } from '../metadata/normalization.js';
import { normalizationToSoundcheck } from '../metadata/normalization.js';
import {
  DEFAULT_TAG_WRITE_CONCURRENCY,
  TagLibTagWriter,
  buildTagFieldsFromInput,
  diffTagFields,
  runWithConcurrency,
  type TagFields,
  type TagWriter,
} from './mass-storage-tag-writer.js';
import { DatabaseWriteError } from '../sync/engine/errors.js';
import type { WarningSink } from '../sync/engine/types.js';

/** Options for `new IpodDeviceAdapter(ipod, capabilities, options?)` */
export interface IpodDeviceAdapterOptions {
  /**
   * Inject a tag writer (defaults to `TagLibTagWriter`). Only used when
   * `transferMode === 'portable'` — every other mode never opens the file.
   */
  tagWriter?: TagWriter;
}

/**
 * Adapter that wraps IpodDatabase to implement the generic DeviceAdapter interface.
 */
export class IpodDeviceAdapter implements DeviceAdapter<IpodTrack> {
  private readonly ipod: IpodDatabase;
  readonly capabilities: DeviceCapabilities;
  private readonly tagWriter: TagWriter;

  /**
   * Pending on-disk tag writes, keyed by IpodTrack instance.
   *
   * Keyed by track (not path) because the iPod's ipodPath is assigned by
   * libgpod during `copyFile` — at the time `addTrack` returns, the new
   * track has no file path yet, so we defer path resolution until `save()`.
   *
   * Only populated under `portable` mode. Flushed by `save()` after the
   * iTunesDB has been persisted, so a partial failure leaves the iPod's
   * database authoritative and the on-disk tags as the best-effort
   * recovery layer.
   */
  private pendingTagWrites = new Map<IpodTrack, TagFields>();

  /**
   * Receiver for execute-phase warnings. Set by the pipeline at execute
   * start via {@link setWarningSink}. Defaults to a no-op sink so the
   * adapter is safe to use outside an execute() loop (eg the `podkit doctor`
   * surfaces) — warnings just get dropped on the floor.
   */
  private warningSink: WarningSink = { emit: () => {} };

  constructor(
    ipod: IpodDatabase,
    capabilities: DeviceCapabilities,
    options?: IpodDeviceAdapterOptions
  ) {
    this.ipod = ipod;
    this.capabilities = capabilities;
    this.tagWriter = options?.tagWriter ?? new TagLibTagWriter();
  }

  setWarningSink(sink: WarningSink): void {
    this.warningSink = sink;
  }

  get mountPoint(): string {
    return this.ipod.mountPoint;
  }

  /**
   * Get the underlying IpodDatabase instance.
   *
   * This escape hatch allows code that genuinely needs iPod-specific
   * operations (playlists, artwork database management) to access the
   * full IpodDatabase API. Prefer using DeviceAdapter methods when possible.
   *
   * @internal Transitional — usage should decrease as handlers migrate to DeviceAdapter methods.
   */
  getIpodDatabase(): IpodDatabase {
    return this.ipod;
  }

  // Track lifecycle

  getTracks(): IpodTrack[] {
    return this.ipod.getTracks();
  }

  addTrack(input: DeviceTrackInput): IpodTrack {
    // If a syncTag is provided, embed it into the comment field for iPod storage
    const { syncTag, normalization, transferMode, ...rest } = input;
    const trackInput = rest as TrackInput;
    if (syncTag) {
      trackInput.comment = writeSyncTag(trackInput.comment, syncTag);
    }
    // Convert normalization → soundcheck for iPod's iTunesDB storage
    applyNormalizationAsSoundcheck(trackInput, normalization);
    // Wrap raw libgpod failures so the executor's retry policy reads them as
    // database errors (no retry) instead of the op-type fallback's `'copy'`.
    const track = wrapDatabaseError(() => this.ipod.addTrack(trackInput));

    // Portable mode: mirror the input metadata into the on-disk file tags so
    // a pulled-off file carries canonical metadata. Source-vs-input may
    // diverge when the collection adapter applied transforms (e.g.
    // cleanArtists, Subsonic-side corrections) — FFmpeg's -map_metadata 0
    // copies the source-original tags, so we re-tag here.
    //
    // Path resolution is deferred to save() because libgpod assigns the
    // F00/F01 ipodPath during copyFile, which happens after addTrack returns.
    if (transferMode === 'portable') {
      this.queueTagWrite(track, buildTagFieldsFromInput(input));
    }

    return track;
  }

  updateTrack(track: IpodTrack, fields: DeviceTrackMetadata): IpodTrack {
    const { normalization, transferMode, ...rest } = fields;
    const trackFields = rest as TrackFields;
    // Convert normalization → soundcheck for iPod's iTunesDB storage
    applyNormalizationAsSoundcheck(trackFields, normalization);
    const updated = wrapDatabaseError(() => this.ipod.updateTrack(track, trackFields));

    // Portable mode: any metadata change that lives in iTunesDB also gets
    // mirrored into the file tags so the file remains self-describing.
    if (transferMode === 'portable') {
      this.queueTagWrite(updated, diffTagFields(track, fields));
    }

    return updated;
  }

  removeTrack(track: IpodTrack, options?: { deleteFile?: boolean }): void {
    wrapDatabaseError(() => this.ipod.removeTrack(track, options));
    // Discard any queued tag writes for the removed track.
    this.pendingTagWrites.delete(track);
  }

  copyTrackFile(track: IpodTrack, sourcePath: string): IpodTrack {
    // IpodTrack.copyFile() mutates in place and returns the same instance
    return track.copyFile(sourcePath);
  }

  replaceTrackFile(track: IpodTrack, newFilePath: string): IpodTrack {
    return this.ipod.replaceTrackFile(track, newFilePath);
  }

  /**
   * Write artwork bytes for an iPod track. The bytes are persisted to the
   * ArtworkDB in memory; `save()` writes them to disk along with the rest of
   * the iTunesDB.
   */
  async setTrackArtwork(track: IpodTrack, imageData: Buffer): Promise<void> {
    this.ipod.setTrackArtworkFromData(track, imageData);
  }

  async removeTrackArtwork(track: IpodTrack): Promise<void> {
    this.ipod.removeTrackArtwork(track);
  }

  // Sync tags

  writeSyncTag(track: IpodTrack, update: SyncTagUpdate): IpodTrack {
    const currentComment = track.comment;
    const existingTag = parseSyncTag(currentComment);
    // Merge: existing tag fields + update fields (update wins)
    const merged: SyncTagData = existingTag
      ? { ...existingTag, ...update }
      : { quality: 'copy', ...update };
    const newComment = writeSyncTag(currentComment, merged);
    return this.updateTrack(track, { comment: newComment });
  }

  clearSyncTag(track: IpodTrack): IpodTrack {
    const currentComment = track.comment;
    if (!parseSyncTag(currentComment)) {
      return track; // No sync tag to clear
    }
    // Strip the [podkit:...] block from the comment
    const cleaned =
      (currentComment ?? '').replace(/\s*\[podkit:v\d+[^\]]*\]\s*/g, '').trim() || undefined;
    return this.updateTrack(track, { comment: cleaned });
  }

  // Persistence

  async save(): Promise<void> {
    // Persist the iTunesDB first — it's the authoritative source for iPod
    // playback. On-disk tag writes are best-effort and follow.
    //
    // Wrap the native libgpod error in DatabaseWriteError so the executor's
    // categorizer reads it as 'database' (no retry) without inspecting the
    // message body. Without wrapping, an iTunesDB failure would categorize
    // by operation-type fallback — usually 'copy' — and retry incorrectly.
    try {
      await this.ipod.save();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DatabaseWriteError(message, err);
    }

    if (this.pendingTagWrites.size > 0) {
      // Resolve file paths now — libgpod has assigned ipodPath via copyFile.
      // Each updateTrack on the iPod returns a *new* IpodTrack wrapper for
      // the same underlying row; TrackHandle objects are also recreated on
      // each call. The stable identity is `handle.index`, so we key by that
      // when re-resolving against the current track list.
      type IndexedHandle = { _internalHandle: { index: number } };
      const indexOf = (t: IpodTrack) => (t as unknown as IndexedHandle)._internalHandle.index;
      const currentByIndex = new Map<number, IpodTrack>();
      for (const t of this.ipod.getTracks()) {
        currentByIndex.set(indexOf(t), t);
      }

      const merged = new Map<string, TagFields>();
      const entryRefs = new Map<string, { artist: string; title: string; album?: string }>();
      const dropped: Array<{ artist: string; title: string; album?: string }> = [];
      for (const [track, fields] of this.pendingTagWrites) {
        const live = currentByIndex.get(indexOf(track)) ?? track;
        const abs = absolutePathFor(this.mountPoint, live.filePath);
        const ref = {
          artist: live.artist ?? 'Unknown Artist',
          title: live.title ?? 'Unknown Title',
          album: live.album,
        };
        if (!abs) {
          dropped.push(ref);
          continue;
        }
        const existing = merged.get(abs);
        merged.set(abs, existing ? { ...existing, ...fields } : { ...fields });
        if (!entryRefs.has(abs)) entryRefs.set(abs, ref);
      }
      this.pendingTagWrites.clear();

      // iPod portable tags are best-effort: iTunesDB is authoritative for
      // playback, so a failed file-tag write doesn't break the device. Emit
      // via the WarningSink so it lands in `--json` and the CLI summary
      // instead of stderr.
      if (dropped.length > 0) {
        this.warningSink.emit({
          phase: 'execute',
          type: 'tag-write',
          tracks: dropped,
          message: `iPod portable: ${dropped.length} track(s) had no file path at save time; tag write skipped`,
        });
      }

      const entries = [...merged.entries()];
      const results = await runWithConcurrency(
        entries.map(
          ([abs, fields]) =>
            () =>
              this.tagWriter.writeTags(abs, fields)
        ),
        DEFAULT_TAG_WRITE_CONCURRENCY
      );
      const failures: Array<{
        ref: { artist: string; title: string; album?: string };
        reason: string;
      }> = [];
      for (let i = 0; i < results.length; i++) {
        const outcome = results[i]!;
        if (outcome.status === 'rejected') {
          const [abs] = entries[i]!;
          const ref = entryRefs.get(abs)!;
          failures.push({
            ref,
            reason: `${abs}: ${(outcome.reason as Error).message ?? outcome.reason}`,
          });
        }
      }
      if (failures.length > 0) {
        this.warningSink.emit({
          phase: 'execute',
          type: 'tag-write',
          tracks: failures.map((f) => f.ref),
          message: `iPod portable: failed to write file tags for ${failures.length} track(s): ${failures
            .map((f) => f.reason)
            .join('; ')}`,
        });
      }
    }
  }

  close(): void {
    this.ipod.close();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private queueTagWrite(track: IpodTrack, fields: TagFields): void {
    if (Object.keys(fields).length === 0) return;
    const existing = this.pendingTagWrites.get(track);
    this.pendingTagWrites.set(track, existing ? { ...existing, ...fields } : { ...fields });
  }
}

/**
 * Wrap raw libgpod errors thrown from `IpodDatabase` mutators
 * (`addTrack`, `updateTrack`, `removeTrack`) in {@link DatabaseWriteError}
 * so the executor categorizes them as `database` (no retry) regardless of
 * the surrounding operation's type. Without this wrap, `add-*` ops would
 * fall through to the `copy` category and the executor would retry an
 * iTunesDB failure once — pointless and potentially harmful for true
 * database corruption.
 *
 * Already-typed errors (CategorizedSyncError subclasses) pass through
 * unwrapped — wrapping a typed error would lose its category.
 */
function wrapDatabaseError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DatabaseWriteError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DatabaseWriteError(message, err);
  }
}

/**
 * Convert normalization data to an iPod soundcheck value and apply it to track fields.
 *
 * The DeviceAdapter interface uses AudioNormalization (format-agnostic), but the iPod
 * stores normalization as a soundcheck integer in the iTunesDB. This function bridges
 * that gap by extracting the soundcheck value from the normalization data.
 */
function applyNormalizationAsSoundcheck(
  fields: TrackInput | TrackFields,
  normalization: AudioNormalization | undefined
): void {
  if (normalization === undefined) return;
  const sc = normalizationToSoundcheck(normalization);
  if (sc !== undefined) {
    fields.soundcheck = sc;
  }
}

/**
 * Resolve an iPod-style ipodPath (`:iPod_Control:Music:F00:ABCD.mp3`) to a
 * regular absolute filesystem path. Returns undefined if the input is empty
 * or doesn't look like an ipodPath.
 */
function absolutePathFor(mountPoint: string, ipodPath: string): string | undefined {
  if (!ipodPath) return undefined;
  const rel = ipodPath.replace(/^:/, '').replace(/:/g, '/');
  if (rel.length === 0) return undefined;
  return path.join(mountPoint, rel);
}
