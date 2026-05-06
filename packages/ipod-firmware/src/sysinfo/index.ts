/**
 * SysInfoExtended file I/O — public surface
 *
 * @module
 */

export { SYSINFO_EXTENDED_PATH, SYSINFO_DEVICE_DIR } from './paths.js';

export { readSysInfoExtended, type SysInfoExtendedResult, type ModelResolver } from './read.js';

export { writeSysInfoExtended } from './write.js';

export { ensureSysInfoExtended, type UsbDeviceAddress, type ReadFromUsbFn } from './ensure.js';
