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
import { mkdir, writeFile } from 'node:fs/promises';
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
 * Generate a solid-colour 500x500 JPEG cover at the given path.
 *
 * Used as embedded artwork for FLAC fixtures + the standalone `cover.jpg`
 * sidecar each album ships.
 */
export async function generateCoverJpeg(outPath: string, hexColor: string): Promise<void> {
  requireEncoder('mjpeg');
  await ensureDir(dirname(outPath));
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=${hexColor}:s=500x500:d=1,format=rgb24`,
    '-frames:v',
    '1',
    outPath,
  ]);
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
