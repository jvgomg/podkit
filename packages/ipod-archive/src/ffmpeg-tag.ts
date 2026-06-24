/**
 * ffmpeg tag fallback — retag a track when node-taglib-sharp can't.
 *
 * Some real-world iPod MP3s defeat taglib's parser: a large padding gap between
 * the ID3v2 tag and the first MPEG audio frame makes taglib's frame-sync search
 * give up ("MPEG audio header not found"), and a handful carry a malformed ID3
 * frame taglib can read but not re-serialize ("Argument null: text was not
 * provided"). ffmpeg's demuxers are far more tolerant and parse these files
 * fine, so {@link writeTrack} falls back to ffmpeg for the few tracks taglib
 * rejects.
 *
 * The retag is **lossless**: `-c:a copy` copies the compressed audio packets
 * bit-exact (no re-encode). Only the container/tag region is rewritten — the
 * same effect as taglib's in-place tag write, just via a more tolerant tool.
 * It reads from the pristine dump source (not the already-copied destination),
 * so a taglib partial-write can never contaminate the fallback output.
 *
 * Leaf module: no `@podkit/core`, no `console`/stderr. ffmpeg is a podkit system
 * dependency already (transcoding); when it is absent the runner rejects and the
 * caller degrades to keeping the untouched byte copy.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { TrackTagMeta } from './tag-writer.js';

/** Default ffmpeg binary — resolved on `PATH`, matching the rest of podkit. */
export const DEFAULT_FFMPEG = 'ffmpeg';

/**
 * Runs ffmpeg with the given args, resolving on a clean exit and rejecting on a
 * non-zero exit or a spawn failure (e.g. ffmpeg not installed). Injected so
 * tests can drive the fallback without a real ffmpeg.
 */
export type FfmpegRunner = (binary: string, args: readonly string[]) => Promise<void>;

/** Spawn `ffmpegPath` directly. ffmpeg writes nothing to stdout with `-loglevel error`. */
export const runFfmpegDefault: FfmpegRunner = (binary, args) =>
  new Promise<void>((resolve, reject) => {
    execFile(binary, [...args], { maxBuffer: 1 << 20 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

/** Build the `-metadata key=value` pairs from a tag payload (textual fields only). */
function metadataArgs(meta: TrackTagMeta): string[] {
  const args: string[] = [];
  const push = (key: string, value: string): void => {
    args.push('-metadata', `${key}=${value}`);
  };
  if (meta.title !== undefined) push('title', meta.title);
  if (meta.artist !== undefined) push('artist', meta.artist);
  if (meta.albumArtist !== undefined) push('album_artist', meta.albumArtist);
  if (meta.album !== undefined) push('album', meta.album);
  if (meta.genre !== undefined) push('genre', meta.genre);
  if (meta.year !== undefined) push('date', String(meta.year));
  if (meta.trackNumber !== undefined) push('track', String(meta.trackNumber));
  if (meta.discNumber !== undefined) push('disc', String(meta.discNumber));
  if (meta.comment !== undefined) push('comment', meta.comment);
  return args;
}

/**
 * Losslessly remux `srcFile` into `destFile` with `meta`'s tags applied, via
 * ffmpeg. The audio packets are copied bit-exact (`-c:a copy`); only the
 * container/tag region is written. When `meta.cover` is present it is embedded
 * as the file's attached cover picture.
 *
 * ffmpeg cannot write in place, so it writes a sibling temp file and renames it
 * over `destFile` on success; the temp (and any cover temp) is cleaned up on
 * every path.
 *
 * @throws when ffmpeg exits non-zero or cannot be spawned (e.g. not installed).
 *   The caller records this per-track and keeps the untouched byte copy.
 */
export async function retagWithFfmpeg(
  srcFile: string,
  destFile: string,
  meta: TrackTagMeta,
  ffmpegPath: string,
  run: FfmpegRunner
): Promise<void> {
  const ext = extname(destFile);
  const dir = dirname(destFile);
  const stamp = basename(destFile);
  // Hidden sibling temps keep the same extension so ffmpeg infers the muxer.
  const tmpOut = join(dir, `.${stamp}.retag${ext}`);
  let coverTmp: string | null = null;

  try {
    const inputs: string[] = ['-i', srcFile];
    const maps: string[] = ['-map', '0:a'];
    const codecs: string[] = ['-c:a', 'copy'];

    if (meta.cover !== undefined) {
      coverTmp = join(dir, `.${stamp}.cover.png`);
      await writeFile(coverTmp, meta.cover);
      inputs.push('-i', coverTmp);
      maps.push('-map', '1:0');
      codecs.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
    }

    const args: string[] = [
      '-y',
      '-loglevel',
      'error',
      '-nostdin',
      ...inputs,
      ...maps,
      ...codecs,
      ...metadataArgs(meta),
      // `-id3v2_version` is an MP3-muxer private option; passing it to the MP4
      // muxer is a hard error, so gate it on the output container.
      ...(ext.toLowerCase() === '.mp3' ? ['-id3v2_version', '3'] : []),
      tmpOut,
    ];

    await run(ffmpegPath, args);
    await rename(tmpOut, destFile);
  } catch (err) {
    await unlink(tmpOut).catch(() => {});
    throw err;
  } finally {
    if (coverTmp) await unlink(coverTmp).catch(() => {});
  }
}
