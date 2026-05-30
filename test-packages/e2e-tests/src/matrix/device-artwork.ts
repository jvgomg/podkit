/**
 * Device-file artwork reader for the matrix harness.
 *
 * Some artwork outcomes are invisible to both the dry-run plan and the
 * `TrackInfo.hasArtwork` flag:
 *
 * - **Transfer-mode strip/preserve** (gap #1): on a database-artwork device
 *   (iPod) the artwork lives in the iTunesDB, so `hasArtwork` is true whether
 *   or not the *file* copied to the device kept its embedded cover. The strip
 *   that `optimized`/`fast` apply is only observable in the file bytes.
 * - **Artwork resize** (gap #3): `TrackInfo.hasArtwork` is a bare boolean and
 *   carries no dimensions.
 *
 * This reader walks the device's *written audio files* and ffprobes each for
 * (a) an embedded cover and (b) its pixel dimensions, keyed by the track's
 * `artist - title`. It is deliberately independent of podkit's own metadata
 * code (it shells out to ffprobe) so a bug in podkit's write path can't be
 * mutually masked by reading the bytes the same way they were written — the
 * same independence rationale as `MassStorageTarget.getTracks`.
 *
 * It works for either backend: podkit writes the title/artist tags into the
 * file (`-map_metadata 0`) on iPod and mass-storage alike, so tag-based
 * matching needs no knowledge of libgpod's hashed filenames.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { IpodReader, parseArtworkDatabase } from '@podkit/ipod-db';

import { trackId } from './axes.js';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.flac',
  '.ogg',
  '.opus',
  '.wav',
  '.aiff',
  '.aif',
]);

/** Image codecs an embedded cover is carried as (attached-picture stream). */
const IMAGE_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif', 'jpeg']);

/** The embedded-artwork state of a single device file. */
export interface FileArtwork {
  /**
   * The file carries an embedded cover — either an attached-picture image
   * stream (FLAC/ALAC/MP3/AAC/AIFF/WAV-id3) or a `METADATA_BLOCK_PICTURE`
   * Vorbis comment (OGG/Opus).
   */
  hasEmbeddedArt: boolean;
  /** Cover pixel width when carried as an image stream; `null` otherwise. */
  width: number | null;
  /** Cover pixel height when carried as an image stream; `null` otherwise. */
  height: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  format?: { tags?: Record<string, string> };
  streams?: FfprobeStream[];
}

/** Recursively collect audio files under a directory. */
async function findAudioFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // nothing synced yet
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findAudioFiles(full)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && AUDIO_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Lower-case tag keys (Vorbis comments are case-insensitive; ffmpeg upper-cases them). */
function lowerKeys(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/** The attached-picture image stream of a file, if any. */
function artStream(streams: readonly FfprobeStream[]): FfprobeStream | undefined {
  return streams.find(
    (s) =>
      s.codec_type === 'video' &&
      (s.disposition?.['attached_pic'] === 1 ||
        (s.codec_name !== undefined && IMAGE_CODECS.has(s.codec_name)))
  );
}

/**
 * ffprobe every audio file under `musicRoot` and return its embedded-artwork
 * state keyed by `artist - title` (the same key the matrix predicts against).
 * Files whose title can't be read are skipped (unmatchable).
 */
export async function probeFileArtwork(musicRoot: string): Promise<Map<string, FileArtwork>> {
  const files = await findAudioFiles(musicRoot);
  const byTrack = new Map<string, FileArtwork>();

  for (const file of files) {
    let probe: FfprobeOutput;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        file,
      ]);
      probe = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      continue; // unreadable file
    }

    const streams = probe.streams ?? [];
    const formatTags = lowerKeys(probe.format?.tags);
    const audioStreamTags = lowerKeys(streams.find((s) => s.codec_type === 'audio')?.tags);
    const artist = formatTags['artist'] ?? audioStreamTags['artist'] ?? '';
    const title = formatTags['title'] ?? audioStreamTags['title'] ?? '';
    if (!title) continue; // can't match this file to a cell

    const art = artStream(streams);
    const hasBlockPicture =
      'metadata_block_picture' in formatTags || 'metadata_block_picture' in audioStreamTags;

    byTrack.set(trackId(artist, title), {
      hasEmbeddedArt: art !== undefined || hasBlockPicture,
      width: art?.width ?? null,
      height: art?.height ?? null,
    });
  }

  return byTrack;
}

/**
 * Read the largest stored ArtworkDB thumbnail width per track on an iPod mount,
 * keyed by `artist - title`. This is the database-artwork counterpart to
 * {@link probeFileArtwork}: where the iPod leaves the file cover at source
 * size, it resizes its iTunesDB thumbnails to within `artworkMaxResolution`, so
 * this is the only way to observe the iPod's resize.
 *
 * Independent of podkit's write path: podkit writes the ArtworkDB via libgpod
 * (C), this reads it back via `@podkit/ipod-db` (a separate TS parser). Matches
 * images to tracks by `sourceId === dbid` (how libgpod links them), falling
 * back to `imageId === artworkId`. Returns an empty map if the device has no
 * ArtworkDB (e.g. a mass-storage target).
 */
export async function probeIpodDbArtwork(ipodMountPath: string): Promise<Map<string, number>> {
  const itunesPath = join(ipodMountPath, 'iPod_Control', 'iTunes', 'iTunesDB');
  const artworkPath = join(ipodMountPath, 'iPod_Control', 'Artwork', 'ArtworkDB');
  const out = new Map<string, number>();

  let itunesBytes: Buffer;
  let artworkBytes: Buffer;
  try {
    [itunesBytes, artworkBytes] = await Promise.all([readFile(itunesPath), readFile(artworkPath)]);
  } catch {
    return out; // no iTunesDB/ArtworkDB (mass-storage, or nothing synced)
  }

  const reader = IpodReader.fromFiles({ itunesDb: new Uint8Array(itunesBytes) });
  const artworkDb = parseArtworkDatabase(new Uint8Array(artworkBytes));

  for (const track of reader.getTracks()) {
    const image =
      artworkDb.images.find((img) => img.sourceId === track.dbid) ??
      artworkDb.images.find((img) => img.imageId === track.artworkId);
    if (!image || image.thumbnails.length === 0) continue;
    const maxWidth = Math.max(...image.thumbnails.map((t) => t.width));
    out.set(trackId(track.artist, track.title), maxWidth);
  }
  return out;
}

/** A sampled RGB colour (0–255 per channel). */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Decode each track's largest iTunesDB artwork thumbnail and sample its centre
 * pixel, keyed by `artist - title`. Used to prove the album cache gave each
 * track its *own* cover (no collision): with distinct per-track cover colours,
 * a sampled colour that classifies to a sibling's colour means the cache
 * bled art across tracks. Independent of podkit's write path (decodes the
 * libgpod-written ithmb via `@podkit/ipod-db`). Empty map if no ArtworkDB.
 */
export async function probeIpodDbArtworkColor(
  ipodMountPath: string
): Promise<Map<string, RgbColor>> {
  const out = new Map<string, RgbColor>();
  const artDir = join(ipodMountPath, 'iPod_Control', 'Artwork');
  const itunesPath = join(ipodMountPath, 'iPod_Control', 'iTunes', 'iTunesDB');

  let itunesBytes: Buffer;
  let artworkBytes: Buffer;
  let entries: string[];
  try {
    [itunesBytes, artworkBytes, entries] = await Promise.all([
      readFile(itunesPath),
      readFile(join(artDir, 'ArtworkDB')),
      readdir(artDir),
    ]);
  } catch {
    return out;
  }

  const ithmbs = new Map<string, Uint8Array>();
  for (const name of entries) {
    if (name.endsWith('.ithmb'))
      ithmbs.set(name, new Uint8Array(await readFile(join(artDir, name))));
  }

  const reader = IpodReader.fromFiles({
    itunesDb: new Uint8Array(itunesBytes),
    artworkDb: new Uint8Array(artworkBytes),
    ithmbs,
  });

  for (const track of reader.getTracks()) {
    const img = reader.getTrackArtwork(track.id);
    if (!img || img.width === 0 || img.height === 0) continue;
    const idx = (Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * 4;
    out.set(trackId(track.artist, track.title), {
      r: img.data[idx] ?? 0,
      g: img.data[idx + 1] ?? 0,
      b: img.data[idx + 2] ?? 0,
    });
  }
  return out;
}
