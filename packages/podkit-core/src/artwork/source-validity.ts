/**
 * Per-track source-file validity probe.
 *
 * Used by the artwork-rebuild repair (and any other doctor flow that needs a
 * cheap, deterministic "is this file plausibly the audio we think it is"
 * check) before delegating to the album-level artwork cache.
 *
 * ## Why this exists
 *
 * `rebuildArtworkDatabase` consults {@link AlbumArtworkCache} per track; the
 * cache memoises a single positive result for an entire `(artist, album)`
 * group. That means a corrupt file in an album whose siblings extract
 * successfully would silently inherit the sibling's artwork and land in the
 * `matched` bucket — the user would never see the bad path in doctor output.
 *
 * Running this probe before the cache lookup guarantees that any source file
 * we can't stat / can't open / clearly isn't audio surfaces in the `errors`
 * bucket with its path + reason, regardless of sibling iteration order.
 *
 * ## Scope
 *
 * Magic-byte header check, not a forensic decoder. The cases we catch:
 *
 * - `missing`     — `stat()` throws `ENOENT`
 * - `unreadable`  — stat OK but the first read fails (`EACCES`, `EISDIR`, etc.)
 * - `truncated`   — file is too small to carry any audio header at all
 * - `badMagic`    — first 16 bytes don't match any container podkit supports
 *
 * Deeper structural corruption (a valid FLAC header followed by a torn frame,
 * a valid ID3 tag followed by no audio) is **out of scope**. Doctor isn't a
 * format-aware audio decoder; that responsibility stays with the artwork /
 * transcode pipelines, which raise per-track errors when they actually fail
 * to extract. Magic-byte covers the common scenarios (missing files, perm
 * denied, truncated-to-zero, garbage written over a valid file).
 *
 * @module
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** Why a source file failed the validity probe. */
export type SourceValidityReason = 'missing' | 'unreadable' | 'truncated' | 'badMagic';

/** Result of {@link checkSourceFileValidity}. */
export type SourceValidityResult = { ok: true } | { ok: false; reason: SourceValidityReason };

/**
 * Smallest file size that could plausibly contain any audio header podkit
 * understands. Lower bound is FLAC's 4-byte `fLaC` signature plus a 38-byte
 * `STREAMINFO` block (≈42 bytes); we use a generous 16 because any file
 * smaller than that can't carry even a 10-byte ID3v2 header followed by a
 * 4-byte MPEG sync. Anything shorter is treated as truncated.
 */
const MIN_AUDIO_FILE_SIZE = 16;

/** Bytes we sample from the head of the file for magic-byte matching. */
const MAGIC_PROBE_BYTES = 16;

/**
 * Check whether `path` looks like a real audio file podkit can read.
 *
 * Synchronous and cheap — one `stat` + one `open` + one short `read`. Safe to
 * call from the per-track repair loop without measurable overhead.
 *
 * @param path Absolute path to the suspected audio file.
 * @returns `{ ok: true }` if the file passes; a `{ ok: false, reason }`
 *   describing the first failed check otherwise.
 */
export function checkSourceFileValidity(path: string): SourceValidityResult {
  // ── Existence + size ───────────────────────────────────────────────────────
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { ok: false, reason: 'missing' };
    }
    // Anything else (EACCES on the directory, EIO, etc.) → unreadable.
    return { ok: false, reason: 'unreadable' };
  }

  if (size < MIN_AUDIO_FILE_SIZE) {
    return { ok: false, reason: 'truncated' };
  }

  // ── Read first bytes for magic-byte inspection ─────────────────────────────
  const buf = Buffer.alloc(MAGIC_PROBE_BYTES);
  let bytesRead: number;
  try {
    const fd = openSync(path, 'r');
    try {
      bytesRead = readSync(fd, buf, 0, MAGIC_PROBE_BYTES, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Stat said the file existed but we can't open/read it (perm denied,
    // file disappeared, EISDIR). Classify as unreadable, not missing — stat
    // succeeded.
    return { ok: false, reason: 'unreadable' };
  }

  if (bytesRead < MIN_AUDIO_FILE_SIZE) {
    return { ok: false, reason: 'truncated' };
  }

  if (!matchesSupportedMagic(buf)) {
    return { ok: false, reason: 'badMagic' };
  }

  return { ok: true };
}

/**
 * Does the leading header match any container `@podkit/core` accepts?
 *
 * podkit's directory adapter advertises FLAC, MP3, M4A/AAC, OGG/Opus, WAV,
 * and AIFF (see `DEFAULT_EXTENSIONS` in `adapters/directory.ts`). Subsonic
 * delivers transcoded MP3/M4A as well as the original container types.
 * The list of magics here mirrors that set.
 */
function matchesSupportedMagic(head: Buffer): boolean {
  if (head.length < 4) return false;

  // FLAC — `fLaC` (0x66 0x4C 0x61 0x43) at offset 0
  if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) {
    return true;
  }

  // OGG / Opus — `OggS` at offset 0 (Opus is OGG-framed)
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) {
    return true;
  }

  // MP3 (ID3v2 tagged) — `ID3` at offset 0
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return true;
  }

  // MP3 (no ID3) — MPEG audio frame sync 0xFF 0xEx (top 11 bits all set).
  // Covers MPEG-1/2/2.5 layer I/II/III at any bitrate/samplerate. Matches
  // 0xFFE0..0xFFFF, which is broader than just MP3 layer III but harmless —
  // any false positive here still has to survive ffprobe later in the
  // pipeline, and the goal of this probe is only to reject obvious garbage.
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    return true;
  }

  // MP4 / M4A / AAC — `....ftyp` at offset 4 (the leading 4 bytes are the
  // box length, which we don't validate).
  if (
    head.length >= 8 &&
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70
  ) {
    return true;
  }

  // WAV — `RIFF` at offset 0 and `WAVE` at offset 8
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x41 &&
    head[10] === 0x56 &&
    head[11] === 0x45
  ) {
    return true;
  }

  // AIFF — `FORM` at offset 0 and `AIFF` or `AIFC` at offset 8
  if (
    head.length >= 12 &&
    head[0] === 0x46 &&
    head[1] === 0x4f &&
    head[2] === 0x52 &&
    head[3] === 0x4d &&
    head[8] === 0x41 &&
    head[9] === 0x49 &&
    head[10] === 0x46 &&
    (head[11] === 0x46 || head[11] === 0x43)
  ) {
    return true;
  }

  return false;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === 'string';
}
