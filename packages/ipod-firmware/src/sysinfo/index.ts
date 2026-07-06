/**
 * SysInfoExtended file I/O — public surface
 *
 * @module
 */

export { SYSINFO_EXTENDED_PATH, SYSINFO_PATH, SYSINFO_DEVICE_DIR } from './paths.js';

export {
  readSysInfoExtended,
  readSysInfoModelNumber,
  type SysInfoExtendedResult,
  type SysInfoIdentity,
} from './read.js';

export { writeSysInfoExtended } from './write.js';

export {
  ensureSysInfoExtended,
  type ReadFromUsbFn,
  type EnsureSysInfoExtendedOptions,
} from './ensure.js';
