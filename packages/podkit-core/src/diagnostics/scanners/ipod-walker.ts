/**
 * Shared walker for iPod content directories.
 *
 * Surfaces `.podkit-tmp` residue across every directory podkit may write to
 * on an iPod — not just `iPod_Control/Music/F**`. TASK-376's atomic-write
 * retrofit routes portable tag-writes through `atomicWriteFileWithSync`,
 * which lays down `<dest>.podkit-tmp` siblings during the rename. A SIGKILLed
 * sync can leave them in any directory podkit touched, so we walk the full
 * `iPod_Control/` subtree and key on the suffix, not the path.
 *
 * libgpod's own tmp residue (GLib `g_file_set_contents` uses random-suffix
 * `.tmpXXXXXX` files instead of a fixed extension) is NOT covered by this
 * walker — its dot-prefixed temp files are skipped by the same dotfile
 * filter that protects us from macOS resource-fork debris (`._*`,
 * `.DS_Store`). A follow-up will design a separate detector for that class.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PODKIT_TEMP_SUFFIX } from '../../utils/atomic-fs.js';

/**
 * The subset of `iPod_Control/` that podkit + libgpod may write into.
 *
 * Sticking to a fixed list is a deliberate trade-off: it catches every
 * surface known to receive atomic writes today, and adding a directory is
 * a one-line change when a new write site lands.
 *
 * `iPod_Control/Photos` is included pre-emptively for future artwork-
 * thumbnail writes; no current code path writes `.podkit-tmp` there today
 * (artwork lands via libgpod, not via the atomic-write helper). Listing it
 * costs one `readdir()` of a typically-empty dir and frontloads coverage
 * for the day photo thumbnails get a write site.
 */
const IPOD_CONTENT_DIRS: readonly string[] = [
  'iPod_Control/Music',
  'iPod_Control/iTunes',
  'iPod_Control/Artwork',
  'iPod_Control/Device',
  'iPod_Control/Photos',
];

/**
 * Walk the iPod content surface and return every path that ends with
 * `.podkit-tmp`.
 *
 * Skips dotfiles + dot-directories at every level — they're either OS
 * metadata (`._*`, `.DS_Store`) or GLib temp residue from libgpod, neither
 * of which this scanner owns.
 */
export async function walkIpodContentForDebris(mountPoint: string): Promise<string[]> {
  const debris: string[] = [];
  for (const rel of IPOD_CONTENT_DIRS) {
    await walkDir(join(mountPoint, rel), debris);
  }
  return debris;
}

async function walkDir(dir: string, accum: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, accum);
    } else if (entry.isFile() && entry.name.endsWith(PODKIT_TEMP_SUFFIX)) {
      accum.push(full);
    }
  }
}
