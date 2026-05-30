/**
 * Shared helpers for the static fixture generators.
 *
 * Each fixture set (multi-format audio, goldberg-selections, synthetic-tests,
 * video) calls into these primitives so the ffmpeg invocation surface stays
 * consistent and the encoder presence checks fire in one place.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { requireEncoder } from '../encoder-guard.js';

const execFileAsync = promisify(execFile);

/**
 * Invoke ffmpeg with the given args. Always passes `-hide_banner` and `-y`
 * (overwrite) so generators are idempotent.
 *
 * Stdout is discarded; stderr is captured and surfaced on failure so the
 * caller sees the actual ffmpeg diagnostic, not just a non-zero exit.
 */
export async function runFfmpeg(args: readonly string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-y', ...args], {
      // ffmpeg writes a lot to stderr even on success; allocate generously
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr ?? '';
    const message = typeof stderr === 'string' ? stderr : stderr.toString();
    throw new Error(`ffmpeg failed:\n  args: ${args.join(' ')}\n${message.trim()}`);
  }
}

/**
 * Ensure a directory exists. Creates parents as needed.
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Build the common `-metadata key=value` argv segments for ffmpeg.
 *
 * Skips undefined values, mirroring ffmpeg's `-metadata key=` (which
 * intentionally clears a tag) by treating undefined as "do not emit".
 */
export function metadataArgs(meta: Record<string, string | number | undefined>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    out.push('-metadata', `${key}=${value}`);
  }
  return out;
}

/**
 * Generate a solid-colour square JPEG cover at the given path.
 *
 * Used as embedded artwork for FLAC fixtures + the standalone `cover.jpg`
 * sidecar each album ships. Defaults to 500x500; pass `size` for a larger
 * cover (e.g. the resize-matrix fixture, which needs a source bigger than a
 * device's `artworkMaxResolution` to observe a downscale).
 */
export async function generateCoverJpeg(
  outPath: string,
  hexColor: string,
  size = 500
): Promise<void> {
  requireEncoder('mjpeg');
  await ensureDir(dirname(outPath));
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=${hexColor}:s=${size}x${size}:d=1,format=rgb24`,
    '-frames:v',
    '1',
    outPath,
  ]);
}

/**
 * Build a base64-encoded `METADATA_BLOCK_PICTURE` value for a Vorbis-comment
 * field, wrapping the given JPEG as a FLAC PICTURE block (Xiph convention,
 * the same shape OGG / Opus / FLAC all use for embedded cover art).
 *
 * Caller passes the result as `-metadata METADATA_BLOCK_PICTURE=<base64>` to
 * ffmpeg's libvorbis / libopus encoders, which writes it into the
 * Vorbis-comment block where `music-metadata` reads it back.
 *
 * Layout per https://xiph.org/flac/format.html#metadata_block_picture
 * (all sizes / dimensions are big-endian unsigned 32-bit).
 */
export async function buildMetadataBlockPicture(
  jpegPath: string,
  opts: { width: number; height: number; mime?: string; description?: string } = {
    width: 500,
    height: 500,
  }
): Promise<string> {
  const jpeg = await readFile(jpegPath);
  const mime = opts.mime ?? 'image/jpeg';
  const description = opts.description ?? '';
  const mimeBytes = Buffer.from(mime, 'ascii');
  const descBytes = Buffer.from(description, 'utf8');

  const buf = Buffer.alloc(4 + 4 + mimeBytes.length + 4 + descBytes.length + 16 + 4 + jpeg.length);
  let o = 0;
  buf.writeUInt32BE(3, o); // picture type: 3 = cover (front)
  o += 4;
  buf.writeUInt32BE(mimeBytes.length, o);
  o += 4;
  mimeBytes.copy(buf, o);
  o += mimeBytes.length;
  buf.writeUInt32BE(descBytes.length, o);
  o += 4;
  descBytes.copy(buf, o);
  o += descBytes.length;
  buf.writeUInt32BE(opts.width, o);
  o += 4;
  buf.writeUInt32BE(opts.height, o);
  o += 4;
  buf.writeUInt32BE(24, o); // colour depth (bits per pixel) — 24 for JPEG
  o += 4;
  buf.writeUInt32BE(0, o); // indexed-colour count — 0 for non-indexed
  o += 4;
  buf.writeUInt32BE(jpeg.length, o);
  o += 4;
  jpeg.copy(buf, o);

  return buf.toString('base64');
}

/**
 * Inject an ID3v2.3 tag (APIC cover + text frames) into a WAV file by
 * appending an `id3 ` RIFF chunk and rewriting the outer RIFF size header.
 *
 * ffmpeg's WAV muxer flatly refuses video streams (even with `-write_id3v2 1`),
 * so the only way to get embedded artwork into a WAV fixture is to splice the
 * tag ourselves after ffmpeg writes the audio. The output stays a valid RIFF
 * file because the `id3 ` chunk is a documented extension recognised by iTunes,
 * podkit's `music-metadata` parser, Windows Media Player and TagLib (Navidrome).
 *
 * Text frames matter: ffmpeg writes the same metadata into a LIST INFO chunk,
 * but TagLib (used by Navidrome) prefers ID3 when present and ignores INFO.
 * If only APIC were written, TagLib would see no title / artist / album and
 * index the track as Unknown. So callers pass the same metadata fields they
 * gave to ffmpeg and we mirror them into the ID3 tag.
 *
 * Layout note: chunks live inside the outer `RIFF...WAVE` envelope; the RIFF
 * size field counts everything after itself, so it grows by `8 + chunkSize`
 * (chunk header + payload, padded to even).
 */
export async function injectId3v2ApicIntoWav(
  wavPath: string,
  jpegPath: string,
  opts: {
    mimeType?: string;
    title?: string;
    artist?: string;
    album?: string;
    track?: number | string;
    date?: number | string;
    genre?: string;
  } = {}
): Promise<void> {
  const wav = await readFile(wavPath);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${wavPath}`);
  }
  const jpeg = await readFile(jpegPath);
  const mimeType = opts.mimeType ?? 'image/jpeg';

  // ID3v2.3 frame builders. Frame headers are id(4) + size(4 BE, regular —
  // NOT synchsafe in v2.3 frame sizes; that's v2.4) + flags(2).
  const buildFrame = (id: string, body: Buffer): Buffer => {
    const header = Buffer.alloc(10);
    header.write(id, 0, 'ascii');
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  // Text frame body: encoding(1) + text. Encoding 0x03 = UTF-8 (v2.4 only —
  // we use 0x00 ISO-8859-1 for v2.3, which is what TagLib expects).
  const textFrame = (id: string, text: string): Buffer =>
    buildFrame(id, Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]));

  const frames: Buffer[] = [];
  if (opts.title) frames.push(textFrame('TIT2', opts.title));
  if (opts.artist) frames.push(textFrame('TPE1', opts.artist));
  if (opts.album) frames.push(textFrame('TALB', opts.album));
  if (opts.track !== undefined) frames.push(textFrame('TRCK', String(opts.track)));
  if (opts.date !== undefined) frames.push(textFrame('TYER', String(opts.date)));
  if (opts.genre) frames.push(textFrame('TCON', opts.genre));

  // APIC frame body: encoding(1) + mime\0 + picType(1) + desc\0 + image.
  const apicBody = Buffer.concat([
    Buffer.from([0x00]), // encoding: ISO-8859-1
    Buffer.from(mimeType, 'ascii'),
    Buffer.from([0x00]), // mime terminator
    Buffer.from([0x03]), // picture type: cover (front)
    Buffer.from([0x00]), // description (empty) + terminator
    jpeg,
  ]);
  frames.push(buildFrame('APIC', apicBody));

  // Pad the tag with 1 KiB of trailing zeroes so iTunes / future taggers can
  // grow text frames in-place without rewriting the file. Not load-bearing,
  // just a courtesy convention.
  const padding = Buffer.alloc(1024);
  const tagBody = Buffer.concat([...frames, padding]);

  // ID3v2.3 header: "ID3" + version(2) + flags(1) + synchsafe size(4) of body.
  const synchsafe = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b[0] = (n >> 21) & 0x7f;
    b[1] = (n >> 14) & 0x7f;
    b[2] = (n >> 7) & 0x7f;
    b[3] = n & 0x7f;
    return b;
  };
  const id3Header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00]), // v2.3.0
    Buffer.from([0x00]), // flags
    synchsafe(tagBody.length),
  ]);
  const id3Payload = Buffer.concat([id3Header, tagBody]);

  // Wrap in an `id3 ` RIFF chunk (4-char ID + LE size + payload, pad to even).
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('id3 ', 0, 'ascii');
  chunkHeader.writeUInt32LE(id3Payload.length, 4);
  const wavPad = id3Payload.length % 2 === 0 ? Buffer.alloc(0) : Buffer.from([0x00]);

  const newWav = Buffer.concat([wav, chunkHeader, id3Payload, wavPad]);
  // Patch outer RIFF size: file length minus 8 (the RIFF id + size fields).
  newWav.writeUInt32LE(newWav.length - 8, 4);

  await writeFile(wavPath, newWav);
}

/**
 * Write a sentinel file recording when this fixture set was generated.
 *
 * Tests can use this to detect stale fixtures during local dev (turbo cache
 * is the authoritative answer; this is a human-readable companion).
 */
export async function writeGeneratedSentinel(dir: string, label: string): Promise<void> {
  await writeFile(
    `${dir}/.generated`,
    `${label}\nGenerated at: ${new Date().toISOString()}\n`,
    'utf8'
  );
}
