/**
 * TagWriter — extract one track into the archive.
 *
 * Copies the source audio file losslessly (a plain byte copy — never a
 * re-encode or remux) into the archive at the planned destination, then writes
 * textual metadata tags onto the copy with node-taglib-sharp. The on-device
 * iTunesDB metadata is authoritative for the archive's filenames, so we restamp
 * the file's tags from it rather than trusting whatever was (or wasn't) baked
 * into the bytes on the iPod.
 *
 * node-taglib-sharp maps each field into the right container dialect:
 * - M4A: MP4 atoms (`©nam`, `©ART`, `aART`, …)
 * - MP3: ID3v2 frames (`TIT2`, `TPE1`, `TPE2`, …)
 * - FLAC/OGG: Vorbis comments
 *
 * When `meta.cover` is present its PNG bytes are embedded as the file's
 * front-cover picture (still a metadata-region rewrite — the audio body stays
 * bit-identical). When absent, the file's pictures are left untouched.
 *
 * @module
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ByteVector, File as TagFile, Picture, PictureType } from 'node-taglib-sharp';

/**
 * Metadata applied to an extracted track's tags.
 *
 * Every field is optional: `undefined` leaves the file's existing tag value
 * untouched; a defined value (including the empty string or `0`) is written
 * as-is. `cover` is accepted now but ignored — it reserves the slot so the
 * artwork slice can embed front-cover art without breaking callers.
 */
export interface TrackTagMeta {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  comment?: string;
  /**
   * Front-cover image bytes (PNG). When present, embedded as the file's
   * front-cover picture; when absent, the file's existing pictures are left
   * untouched.
   */
  cover?: Buffer;
}

/**
 * Whether `meta` carries any field worth opening the file for — a textual tag
 * or a cover image. When it doesn't, the copy is left untouched so it stays
 * byte-identical to the source.
 */
function hasWritableFields(meta: TrackTagMeta): boolean {
  return hasTextualFields(meta) || meta.cover !== undefined;
}

/**
 * Whether `meta` carries any textual tag field worth writing. When it doesn't,
 * the copy is left untouched so it stays byte-identical to the source.
 */
function hasTextualFields(meta: TrackTagMeta): boolean {
  return (
    meta.title !== undefined ||
    meta.artist !== undefined ||
    meta.album !== undefined ||
    meta.albumArtist !== undefined ||
    meta.genre !== undefined ||
    meta.trackNumber !== undefined ||
    meta.discNumber !== undefined ||
    meta.year !== undefined ||
    meta.comment !== undefined
  );
}

/**
 * Copy `srcFile` to `destFile` losslessly, then stamp `meta`'s textual tags
 * onto the copy.
 *
 * Parent directories of `destFile` are created if absent. The copy is a
 * straight byte stream — the audio body is bit-identical to the source. Tag
 * writing happens after the copy, in place on the destination, so the source
 * dump is never modified.
 *
 * @throws when the source cannot be read, the destination cannot be written,
 *   or the tag write fails. The orchestrator records these per-track rather
 *   than aborting the whole run.
 */
export async function writeTrack(
  srcFile: string,
  destFile: string,
  meta: TrackTagMeta
): Promise<void> {
  await mkdir(dirname(destFile), { recursive: true });

  // Lossless byte copy (no transcode). Streamed so large files don't load
  // wholesale into memory.
  await pipeline(createReadStream(srcFile), createWriteStream(destFile));

  // Nothing to write → leave the copy bit-for-bit identical to the source.
  // (Opening + saving via taglib would rewrite the tag region even with no
  // changes, so skip it entirely when there are no fields to apply.)
  if (!hasWritableFields(meta)) return;

  // Stamp tags in place on the copy. taglib infers the container from the
  // destination's extension (which the planner derived from the source path),
  // so the copy keeps the source format.
  const file = TagFile.createFromPath(destFile);
  // node-taglib-sharp can return a null-ish handle for an unsupported or
  // corrupt container. Surface a clear error rather than a null dereference;
  // the orchestrator records it per-track without aborting the run.
  if (!file) {
    throw new Error(`Unsupported or unreadable audio container: ${destFile}`);
  }
  try {
    const tag = file.tag;
    if (meta.title !== undefined) tag.title = meta.title;
    if (meta.artist !== undefined) tag.performers = [meta.artist];
    if (meta.albumArtist !== undefined) tag.albumArtists = [meta.albumArtist];
    if (meta.album !== undefined) tag.album = meta.album;
    if (meta.genre !== undefined) tag.genres = [meta.genre];
    if (meta.year !== undefined) tag.year = meta.year;
    if (meta.trackNumber !== undefined) tag.track = meta.trackNumber;
    if (meta.discNumber !== undefined) tag.disc = meta.discNumber;
    if (meta.comment !== undefined) tag.comment = meta.comment;
    if (meta.cover !== undefined) {
      // Embed the cover PNG as the sole front-cover picture. taglib maps this
      // into the right container slot (APIC on MP3, `covr` atom on M4A,
      // METADATA_BLOCK_PICTURE on FLAC/OGG). The audio frames are untouched.
      const picture = Picture.fromData(ByteVector.fromByteArray(meta.cover));
      picture.type = PictureType.FrontCover;
      tag.pictures = [picture];
    }
    // NOTE: taglib `save()` is synchronous blocking I/O — it rewrites the file's
    // tag region in place on the calling thread. This is acceptable here because
    // runTransform processes tracks sequentially and the files are already local
    // (copied from the dump). Future readers: if this is ever parallelised or
    // moved into a hot path, replace with a worker thread or async tag library.
    file.save();
  } finally {
    file.dispose();
  }
}
