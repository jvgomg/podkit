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

/**
 * Write `data` to `dest` atomically with fsync (temp + fsync + rename).
 *
 * Unlike `atomicWriteFile` (which is safe for the manifest because the
 * manifest is re-derivable from a filesystem walk), this helper `fsync`s the
 * tmp before rename. Use for on-file mutations where the file IS the source of
 * truth (sidecar art, future tag-write/picture-write retrofits).
 *
 * The fsync ensures that a power-cut immediately after `rename` returns cannot
 * leave the renamed target pointing at unsynced blocks. On ANY failure (write,
 * fsync, or rename), the tmp is best-effort unlinked to avoid `.podkit-tmp`
 * debris that would otherwise surface as spurious doctor warnings.
 */
export async function atomicWriteFileWithSync(
  dest: string,
  data: Buffer | Uint8Array
): Promise<void> {
  const tmp = dest + PODKIT_TEMP_SUFFIX;
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(tmp, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Already failing — ignore secondary close error.
      }
    }
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // Best-effort cleanup — tmp may not exist if open() itself failed.
    }
    throw err;
  }
}
