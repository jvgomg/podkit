/**
 * Centralized re-export of every command's error-code enum.
 *
 * JSON consumers can import a typed union of all codes any podkit command
 * may emit:
 *
 *   import type { PodkitErrorCode } from 'podkit/error-codes';
 */
export { MountErrorCodes, type MountErrorCode } from './mount.js';
export { EjectErrorCodes, type EjectErrorCode } from './eject.js';
export { InitErrorCodes, type InitErrorCode } from './init.js';
export { MigrateErrorCodes, type MigrateErrorCode } from './migrate.js';
export { CompletionsErrorCodes, type CompletionsErrorCode } from './completions.js';
export { CollectionErrorCodes, type CollectionErrorCode } from './collection.js';
export { DeviceErrorCodes, type DeviceErrorCode } from './device.js';
export { DoctorErrorCodes, type DoctorErrorCode } from './doctor.js';
export { SyncErrorCodes, type SyncErrorCode } from './sync.js';

import type { MountErrorCode } from './mount.js';
import type { EjectErrorCode } from './eject.js';
import type { InitErrorCode } from './init.js';
import type { MigrateErrorCode } from './migrate.js';
import type { CompletionsErrorCode } from './completions.js';
import type { CollectionErrorCode } from './collection.js';
import type { DeviceErrorCode } from './device.js';
import type { DoctorErrorCode } from './doctor.js';
import type { SyncErrorCode } from './sync.js';

/**
 * Union of every error code any podkit command may emit.
 *
 * Note: codes are not globally unique — many commands share codes like
 * `DEVICE_NOT_RESOLVED` or `CORE_LOAD_FAILED` because the failure modes
 * are the same. Branch on `command` first if you need to disambiguate.
 */
export type PodkitErrorCode =
  | MountErrorCode
  | EjectErrorCode
  | InitErrorCode
  | MigrateErrorCode
  | CompletionsErrorCode
  | CollectionErrorCode
  | DeviceErrorCode
  | DoctorErrorCode
  | SyncErrorCode;
