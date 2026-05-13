/**
 * Runtime ffmpeg encoder presence check.
 *
 * Mirrors the build-time `scripts/check-ffmpeg.ts` so library functions
 * (mini-tracks) fail loudly with the same install hint if they are
 * invoked against a host ffmpeg that has lost an encoder since the last
 * successful build.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';

/** Cached ffmpeg -encoders output, populated once per process. */
let encodersCache: string | null = null;

function loadEncoders(): string {
  if (encodersCache !== null) return encodersCache;
  encodersCache = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  return encodersCache;
}

/**
 * Map an ffmpeg encoder name (as passed to `-c:a`) to a human-friendly
 * codec label used in error messages.
 */
const FRIENDLY_NAMES: Record<string, string> = {
  flac: 'FLAC',
  libmp3lame: 'MP3 (libmp3lame)',
  aac: 'AAC',
  libvorbis: 'OGG Vorbis (libvorbis)',
  libopus: 'Opus (libopus)',
};

/**
 * Throw a clean error if the named ffmpeg encoder is missing.
 *
 * The error text echoes the build-time check so dev experience is the
 * same regardless of whether the gap is caught at build time
 * (recommended) or at test-runtime (fallback).
 */
export function requireEncoder(encoder: string): void {
  let out: string;
  try {
    out = loadEncoders();
  } catch {
    throw new Error(
      `ffmpeg is not available on $PATH.\n` +
        `@podkit/test-fixtures requires ffmpeg with several encoders ` +
        `(libvorbis, libopus, libmp3lame, aac, flac). See ` +
        `packages/test-fixtures/scripts/check-ffmpeg.ts for install hints.`
    );
  }
  const present = new RegExp(`\\b${encoder}\\b`).test(out);
  if (present) return;

  const label = FRIENDLY_NAMES[encoder] ?? encoder;
  throw new Error(
    `ffmpeg is missing the '${encoder}' encoder (${label}).\n` +
      `@podkit/test-fixtures relies on this encoder for fixture generation.\n` +
      `Re-build test-fixtures to see the install hint:\n` +
      `  bun run --filter @podkit/test-fixtures check-ffmpeg\n` +
      `Or see packages/test-fixtures/scripts/check-ffmpeg.ts.`
  );
}
