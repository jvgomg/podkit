/**
 * DumpLoader — open a raw dump as a readable iPod database + identity.
 *
 * Stage 2 is a pure function of a stage-1 dump and never touches a live device.
 * `loadDump` resolves the actual iPod root inside whatever path it's handed
 * (the named archive dir containing `raw dump/`, or a directory that itself
 * contains `iPod_Control`), opens the iTunesDB through libgpod-node's
 * `Database.open()` (which calls `itdb_parse()` with no device gate), and reads
 * the device identity:
 *
 * - serial number / FireWire GUID / family via `@podkit/ipod-firmware`'s
 *   `readSysInfoExtended`, degrading to `undefined` when the file is absent
 *   (common on stock / dying iPods) — exactly as the stage-1 dump does;
 * - model / generation / capacity via libgpod-node's device capabilities.
 *
 * @module
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from '@podkit/libgpod-node';
import { readSysInfoExtended } from '@podkit/ipod-firmware';
import { IpodArchiveError } from './errors.js';
import { RAW_DUMP_SUBDIR } from './run-dump.js';

/** Marker directory that identifies an iPod root inside a dump. */
const IPOD_CONTROL_DIR = 'iPod_Control';

/**
 * Device identity surfaced from a dump. Every field is best-effort and may be
 * absent when the dump lacks `SysInfoExtended` or libgpod can't classify the
 * model.
 */
export interface DumpDeviceIdentity {
  /** Apple serial number (from `SysInfoExtended`). */
  serialNumber?: string;
  /** FireWire GUID (from `SysInfoExtended`). */
  firewireGuid?: string;
  /** Apple FamilyID integer (from `SysInfoExtended`). */
  familyId?: number;
  /** libgpod model identifier (e.g. `video_white`), or `unknown`. */
  model?: string;
  /** libgpod generation identifier (e.g. `video_1`), or `unknown`. */
  generation?: string;
  /** Human-readable model name (e.g. `iPod Video (60GB)`). */
  modelName?: string;
  /** Model number string (e.g. `MA147`), when libgpod resolves one. */
  modelNumber?: string;
  /** Capacity in GB, when libgpod knows it. */
  capacityGb?: number;
}

/** Everything a transform needs from a loaded dump. */
export interface LoadedDump {
  /** Open libgpod database. The caller owns it and must `close()` it. */
  db: Database;
  /** Resolved best-effort device identity. */
  identity: DumpDeviceIdentity;
  /**
   * The directory inside the dump that contains `iPod_Control` (the iPod root).
   * Track `ipodPath` values resolve relative to this.
   */
  ipodRoot: string;
}

/** Whether `dir` directly contains an `iPod_Control` subdirectory. */
async function hasIpodControl(dir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, IPOD_CONTROL_DIR));
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate the iPod root inside `dumpDir`. Accepts, in order:
 *
 * 1. `dumpDir` itself containing `iPod_Control`;
 * 2. `dumpDir/raw dump/` (the stage-1 named-archive layout);
 * 3. otherwise throws `DUMP_NOT_READABLE`.
 */
async function resolveIpodRoot(dumpDir: string): Promise<string> {
  if (await hasIpodControl(dumpDir)) return dumpDir;

  const rawDumpDir = join(dumpDir, RAW_DUMP_SUBDIR);
  if (await hasIpodControl(rawDumpDir)) return rawDumpDir;

  throw new IpodArchiveError(
    'DUMP_NOT_READABLE',
    `No iPod_Control directory found under ${dumpDir} (looked in the path itself and in "${RAW_DUMP_SUBDIR}/")`
  );
}

/**
 * Read best-effort device identity for the dump's iPod root.
 *
 * `readSysInfoExtended` never throws — it returns null when the file is absent.
 * libgpod device capabilities are read from the already-open database.
 */
function readIdentity(db: Database, ipodRoot: string): DumpDeviceIdentity {
  const identity: DumpDeviceIdentity = {};

  const sysInfo = readSysInfoExtended(ipodRoot);
  if (sysInfo?.serialNumber) identity.serialNumber = sysInfo.serialNumber;
  if (sysInfo?.firewireGuid) identity.firewireGuid = sysInfo.firewireGuid;
  if (sysInfo?.identity.familyId !== undefined) identity.familyId = sysInfo.identity.familyId;

  // libgpod device capabilities — model/generation/capacity. Best-effort: if
  // libgpod can't classify the device these come back as 'unknown' / 0.
  try {
    const caps = db.getDeviceCapabilities();
    if (caps.model && caps.model !== 'unknown') identity.model = caps.model;
    if (caps.generation && caps.generation !== 'unknown') identity.generation = caps.generation;
    if (caps.modelName && caps.modelName !== 'Unknown') identity.modelName = caps.modelName;
    if (caps.modelNumber) identity.modelNumber = caps.modelNumber;
    const capacity = db.device.capacity;
    if (capacity > 0) identity.capacityGb = capacity;
  } catch {
    // Capability read failed — leave model/generation/capacity unset. The
    // database itself parsed, so this is non-fatal for the transform.
  }

  return identity;
}

/**
 * Open a raw dump and surface its database + identity + iPod root.
 *
 * @param dumpDir - the named archive dir (containing `raw dump/`) or a directory
 *   that itself contains `iPod_Control`.
 * @throws IpodArchiveError('DUMP_NOT_READABLE') when no `iPod_Control` is found
 *   or libgpod cannot parse the iTunesDB.
 */
export async function loadDump(dumpDir: string): Promise<LoadedDump> {
  const ipodRoot = await resolveIpodRoot(dumpDir);

  let db: Database;
  try {
    db = await Database.open(ipodRoot);
  } catch (err) {
    throw new IpodArchiveError(
      'DUMP_NOT_READABLE',
      `Failed to parse the iPod database at ${ipodRoot}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  // Hand the open database to the caller only once identity reading succeeds;
  // if it throws, close the db first so the handle never leaks. (readIdentity
  // is defensive today, but this keeps the ownership contract honest.)
  try {
    const identity = readIdentity(db, ipodRoot);
    return { db, identity, ipodRoot };
  } catch (err) {
    db.close();
    throw err;
  }
}
