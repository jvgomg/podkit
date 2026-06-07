/**
 * Resolve the per-device sync-lock path.
 *
 * Single source of truth for the on-disk location of the lock file shared
 * by every podkit surface that writes to a device:
 *
 * - `podkit sync` (the executor).
 * - `podkit doctor --repair` paths that write the manifest or other
 *   on-device state.
 * - Any future writer the project adds.
 *
 * Two layouts:
 *
 * - **iPod** → `<mountPoint>/iPod_Control/.podkit-sync.lock`. `iPod_Control/`
 *   is always present on a real iPod (the database lives under it), so no
 *   mkdir is needed.
 * - **mass-storage** → `<mountPoint>/.podkit/sync.lock`. `.podkit/` is
 *   created if absent so virgin devices acquire cleanly on first sync.
 *
 * The helper lives in `@podkit/core` (not in the CLI) because every writer
 * — the CLI, the daemon, and the doctor — needs the same path. Locating it
 * here keeps the layout decision in one place and lets cross-package
 * callers reuse it without duplicating the `mkdir` dance.
 *
 * @module
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Compute the per-device sync-lock path. Creates `.podkit/` on mass-storage
 * devices when absent so a virgin device acquires cleanly on first write.
 *
 * The `.podkit/` mkdir is best-effort: if it fails (EACCES, ENOENT on the
 * mount), the subsequent `acquireLock` open will surface the real error.
 * Callers don't need to special-case the mkdir failure — they just call
 * `acquireLock` on the returned path and let its error path take over.
 *
 * @param devicePath  Absolute path to the mounted device.
 * @param isIpodDevice True when the device is an iPod (uses `iPod_Control/`
 *   layout); false for mass-storage devices (uses `.podkit/` layout).
 */
export async function resolveSyncLockPath(
  devicePath: string,
  isIpodDevice: boolean
): Promise<string> {
  if (isIpodDevice) {
    return join(devicePath, 'iPod_Control', '.podkit-sync.lock');
  }
  const podkitDir = join(devicePath, '.podkit');
  try {
    await mkdir(podkitDir, { recursive: true });
  } catch {
    // Best-effort: if mkdir fails, the subsequent acquireLock open will
    // surface the real error (likely EACCES or ENOENT on the mount).
  }
  return join(podkitDir, 'sync.lock');
}
