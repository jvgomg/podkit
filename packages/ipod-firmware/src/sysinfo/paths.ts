/**
 * SysInfoExtended filesystem path constants.
 *
 * @module
 */

import { join } from 'node:path';

/** Relative path to SysInfoExtended within an iPod mount point */
export const SYSINFO_EXTENDED_PATH = join('iPod_Control', 'Device', 'SysInfoExtended');

/** Relative path to the Device directory within an iPod mount point */
export const SYSINFO_DEVICE_DIR = join('iPod_Control', 'Device');
