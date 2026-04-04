import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * Mount a partitioned disk image via loop device.
 * Uses losetup --partscan to expose partitions, then mounts the first partition.
 */
export function mountImage(imagePath: string, mountPoint: string): string {
  mkdirSync(mountPoint, { recursive: true });

  // Set up loop device with partition scanning
  const loopDev = execSync(`losetup --find --show --partscan ${imagePath}`).toString().trim();

  // Mount the first partition
  const partDev = `${loopDev}p1`;
  execSync(`mount ${partDev} ${mountPoint}`);

  return loopDev;
}

/**
 * Unmount and detach a loop-mounted image.
 */
export function unmountAndDetach(mountPoint: string, loopDev?: string): void {
  execSync(`umount ${mountPoint}`);
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
