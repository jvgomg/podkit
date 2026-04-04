import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * Find all loop devices currently backed by the given image file.
 * Returns an array of device paths (e.g. ['/dev/loop0', '/dev/loop1']).
 */
export function findLoopDevices(imagePath: string): string[] {
  try {
    // losetup -j outputs lines like: /dev/loop0: [64769]:123456 (/path/to/image)
    const output = execSync(`losetup -j ${imagePath}`).toString().trim();
    if (!output) return [];
    return output
      .split('\n')
      .map((line) => line.match(/^(\/dev\/loop\d+):/)?.[1])
      .filter((dev): dev is string => dev !== undefined);
  } catch {
    return [];
  }
}

/**
 * Detach all loop devices backed by the given image file.
 * Unmounts their partitions first if mounted. Uses lazy unmount
 * as a fallback if the regular unmount fails (e.g. busy target).
 */
export function detachLoopDevices(imagePath: string): void {
  const devices = findLoopDevices(imagePath);
  for (const dev of devices) {
    try {
      execSync(`umount ${dev}p1 2>/dev/null || umount -l ${dev}p1 2>/dev/null || true`);
    } catch {
      // ignore
    }
    try {
      execSync(`losetup -d ${dev}`);
    } catch {
      // may already be detached
    }
  }
}

/**
 * Mount a partitioned disk image via loop device.
 * Uses losetup --partscan to expose partitions, then mounts the first partition.
 *
 * Detaches any stale loop devices for the same image before creating a new one.
 */
export function mountImage(imagePath: string, mountPoint: string): string {
  mkdirSync(mountPoint, { recursive: true });

  // Clean up any stale loop devices for this image (e.g. from a previous server run)
  detachLoopDevices(imagePath);

  // Set up loop device with partition scanning
  const loopDev = execSync(`losetup --find --show --partscan ${imagePath}`).toString().trim();

  // Mount the first partition
  const partDev = `${loopDev}p1`;
  execSync(`mount ${partDev} ${mountPoint}`);

  return loopDev;
}

/**
 * Unmount and detach a loop-mounted image.
 * Falls back to lazy unmount if the target is busy (e.g. inotify handles
 * not yet released by the kernel).
 */
export function unmountAndDetach(mountPoint: string, loopDev?: string): void {
  try {
    execSync(`umount ${mountPoint}`);
  } catch {
    // Target busy — lazy unmount detaches from the namespace immediately;
    // the kernel cleans up once the last file descriptor closes.
    execSync(`umount -l ${mountPoint}`);
  }
  if (loopDev) {
    execSync(`losetup -d ${loopDev}`);
  }
}

/**
 * Unmount a filesystem at the given mount point.
 */
export function unmountImage(mountPoint: string): void {
  execSync(`umount ${mountPoint}`);
}

/**
 * Check if a path is a mount point.
 */
export function isMountPoint(mountPoint: string): boolean {
  try {
    execSync(`mountpoint -q ${mountPoint}`);
    return true;
  } catch {
    return false;
  }
}
