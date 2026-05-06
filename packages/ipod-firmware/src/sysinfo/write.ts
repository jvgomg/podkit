/**
 * SysInfoExtended file writer.
 *
 * Writes the SysInfoExtended XML payload to an iPod mount point, creating
 * the `iPod_Control/Device` directory if it does not yet exist.
 *
 * @module
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import { SYSINFO_EXTENDED_PATH, SYSINFO_DEVICE_DIR } from './paths.js';

/**
 * Write a SysInfoExtended XML payload to an iPod's filesystem.
 *
 * Creates `iPod_Control/Device/` if it does not exist. The caller is
 * responsible for validating the XML before writing.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param xml - Raw SysInfoExtended XML payload
 */
export function writeSysInfoExtended(mountPoint: string, xml: string): void {
  const deviceDir = join(mountPoint, SYSINFO_DEVICE_DIR);
  fs.mkdirSync(deviceDir, { recursive: true });
  fs.writeFileSync(join(mountPoint, SYSINFO_EXTENDED_PATH), xml, 'utf-8');
}
