import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Create a partitioned FAT32 disk image for the virtual iPod.
 * The image has an MBR partition table with a single FAT32 partition,
 * matching how a real iPod's storage is structured. This is required
 * for podkit's device scanner to pass the "Partition Table" check.
 *
 * No-ops if the image already exists.
 */
export function createImage(path: string, sizeMb: number = 2048): void {
  if (existsSync(path)) return;

  mkdirSync(dirname(path), { recursive: true });

  // Create empty image
  execSync(`dd if=/dev/zero of=${path} bs=1M count=${sizeMb}`);

  // Create MBR partition table with a single FAT32 partition
  // sfdisk reads partition definitions from stdin
  execSync(`echo ',,0c,*' | sfdisk ${path}`);

  // Set up loop device with partition scanning
  const loopDev = execSync(`losetup --find --show --partscan ${path}`).toString().trim();
  try {
    // Format the partition (not the whole disk)
    execSync(`mkfs.vfat -F 32 -n IPOD ${loopDev}p1`);
  } finally {
    execSync(`losetup -d ${loopDev}`);
  }
}

/**
 * Initialize the iPod directory structure on a mounted filesystem.
 * Creates the standard iPod_Control hierarchy with music subdirectories
 * and a SysInfo file identifying the device as an iPod Video 60GB.
 */
export function initializeIpodStructure(mountPoint: string): void {
  const dirs = [
    'iPod_Control/iTunes',
    'iPod_Control/Music',
    'iPod_Control/Device',
    'iPod_Control/Artwork',
  ];

  // Add F00-F19 music directories
  for (let i = 0; i < 20; i++) {
    dirs.push(`iPod_Control/Music/F${i.toString().padStart(2, '0')}`);
  }

  for (const dir of dirs) {
    mkdirSync(join(mountPoint, dir), { recursive: true });
  }

  // Write SysInfo for iPod 5th gen (Video 60GB)
  const sysInfoPath = join(mountPoint, 'iPod_Control/Device/SysInfo');
  if (!existsSync(sysInfoPath)) {
    writeFileSync(sysInfoPath, 'ModelNumStr: MA147\nFirewireGuid: 0x000000000001\n');
  }
}
