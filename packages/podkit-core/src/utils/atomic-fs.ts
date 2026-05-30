/**
 * Atomic filesystem helpers.
 *
 * Write to a sibling `.podkit-tmp` path, then `rename` to the final
 * destination. POSIX guarantees rename is atomic within a filesystem, so a
 * crash either leaves the destination at its previous state or at the new
 * one — never a partial write at the final path.
 */

import * as fs from 'node:fs';

/** Suffix for in-flight writes. Visible to debris-cleanup tooling. */
export const PODKIT_TEMP_SUFFIX = '.podkit-tmp';

/**
 * Copy `src` to `dest` atomically (temp + rename).
 *
 * On error the temp file is best-effort cleaned up before rethrowing.
 */
export function atomicCopyFile(src: string, dest: string): void {
  const tmp = dest + PODKIT_TEMP_SUFFIX;
  try {
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Temp may not exist or rename may have succeeded — best effort.
    }
    throw err;
  }
}

/**
 * Write `data` to `dest` atomically (temp + rename).
 *
 * On error the temp file is best-effort cleaned up before rethrowing.
 */
export function atomicWriteFile(
  dest: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): void {
  const tmp = dest + PODKIT_TEMP_SUFFIX;
  try {
    fs.writeFileSync(tmp, data, encoding);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best effort.
    }
    throw err;
  }
}
