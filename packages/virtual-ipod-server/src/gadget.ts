import { execSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
  readdirSync,
} from 'node:fs';
import type { GadgetController } from './types.js';

/**
 * Manages the Linux USB gadget (configfs) lifecycle for a virtual iPod
 * mass storage device. All operations require root and a Linux kernel
 * with configfs, dummy_hcd, and libcomposite support.
 */
export function createGadget(gadgetPath: string): GadgetController {
  async function plug(imagePath: string, mountPoint: string): Promise<void> {
    // Already plugged — remount if needed (e.g. server restarted without VM reboot).
    if (isPluggedIn()) {
      const blockDev = existsSync('/dev/sda1')
        ? '/dev/sda1'
        : existsSync('/dev/sda')
          ? '/dev/sda'
          : null;
      if (!blockDev) {
        throw new Error('Block device not found — gadget state is stale, unplug and replug');
      }
      mkdirSync(mountPoint, { recursive: true });
      execSync(`mount -o fmask=0000,dmask=0000 ${blockDev} ${mountPoint}`);
      return;
    }

    // Full setup: load modules, create gadget, bind UDC, mount block device.

    // 1. Load kernel modules (idempotent)
    execSync('modprobe dummy_hcd');
    execSync('modprobe libcomposite');

    // 2. Create gadget via configfs
    mkdirSync(gadgetPath, { recursive: true });
    writeFileSync(`${gadgetPath}/idVendor`, '0x05ac'); // Apple
    writeFileSync(`${gadgetPath}/idProduct`, '0x1209'); // iPod Classic 6G
    writeFileSync(`${gadgetPath}/bcdDevice`, '0x0001');
    writeFileSync(`${gadgetPath}/bcdUSB`, '0x0200');

    // USB strings
    mkdirSync(`${gadgetPath}/strings/0x409`, { recursive: true });
    writeFileSync(`${gadgetPath}/strings/0x409/serialnumber`, '000000000001');
    writeFileSync(`${gadgetPath}/strings/0x409/manufacturer`, 'Apple Inc.');
    writeFileSync(`${gadgetPath}/strings/0x409/product`, 'iPod');

    // Configuration
    mkdirSync(`${gadgetPath}/configs/c.1/strings/0x409`, { recursive: true });
    writeFileSync(`${gadgetPath}/configs/c.1/strings/0x409/configuration`, 'Mass Storage');
    writeFileSync(`${gadgetPath}/configs/c.1/MaxPower`, '500');

    // Mass storage function
    mkdirSync(`${gadgetPath}/functions/mass_storage.0/lun.0`, { recursive: true });
    writeFileSync(`${gadgetPath}/functions/mass_storage.0/lun.0/file`, imagePath);
    writeFileSync(`${gadgetPath}/functions/mass_storage.0/lun.0/removable`, '0');

    // Link function to config
    const linkPath = `${gadgetPath}/configs/c.1/mass_storage.0`;
    if (!existsSync(linkPath)) {
      symlinkSync(`${gadgetPath}/functions/mass_storage.0`, linkPath);
    }

    // Bind to UDC
    const udcList = readdirSync('/sys/class/udc');
    if (udcList.length === 0) throw new Error('No UDC available');
    writeFileSync(`${gadgetPath}/UDC`, udcList[0]!);

    // Wait for block device to appear after UDC bind, then mount
    const blockDev = await waitForBlockDevice();
    mkdirSync(mountPoint, { recursive: true });
    execSync(`mount -o fmask=0000,dmask=0000 ${blockDev} ${mountPoint}`);
  }

  async function unplug(mountPoint: string): Promise<void> {
    // 1. Unmount
    try {
      execSync(`umount ${mountPoint}`);
    } catch {
      // may already be unmounted
    }

    // 2. Unbind UDC
    try {
      writeFileSync(`${gadgetPath}/UDC`, '');
    } catch {
      // may already be unbound
    }

    // 3. Remove function-to-config symlink
    try {
      unlinkSync(`${gadgetPath}/configs/c.1/mass_storage.0`);
    } catch {
      // may not exist
    }

    // 4. Remove configfs directories (reverse order matters for configfs)
    const removeDirs = [
      `${gadgetPath}/configs/c.1/strings/0x409`,
      `${gadgetPath}/configs/c.1`,
      `${gadgetPath}/functions/mass_storage.0/lun.0`,
      `${gadgetPath}/functions/mass_storage.0`,
      `${gadgetPath}/strings/0x409`,
      gadgetPath,
    ];
    for (const dir of removeDirs) {
      try {
        rmdirSync(dir);
      } catch {
        // may not exist or not empty
      }
    }

    // 5. Unload modules
    try {
      execSync('modprobe -r dummy_hcd');
    } catch {
      // may be in use or already unloaded
    }
  }

  function isPluggedIn(): boolean {
    try {
      const udc = readFileSync(`${gadgetPath}/UDC`, 'utf-8').trim();
      return udc.length > 0;
    } catch {
      return false;
    }
  }

  return { plug, unplug, isPluggedIn };
}

async function waitForBlockDevice(timeout = 10000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // The image has an MBR partition table, so the kernel creates sda1
    if (existsSync('/dev/sda1')) return '/dev/sda1';
    // Fallback to whole disk for unpartitioned images
    if (existsSync('/dev/sda')) {
      // Give the kernel a moment to scan for partitions
      await new Promise((r) => setTimeout(r, 500));
      if (existsSync('/dev/sda1')) return '/dev/sda1';
      return '/dev/sda';
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Block device did not appear within timeout');
}
