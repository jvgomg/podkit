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
import { IpodArchiveError } from './errors.js';
import { RAW_DUMP_SUBDIR } from './run-dump.js';
import { resolveDumpIdentity, type DumpDeviceIdentity } from './device-identity.js';

/** Marker directory that identifies an iPod root inside a dump. */
const IPOD_CONTROL_DIR = 'iPod_Control';

// The device-identity render contract + resolution live in `device-identity.ts`.
// Re-exported here so existing importers (`archive-report`, `index`) are stable.
export type { DumpDeviceIdentity } from './device-identity.js';

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
 * Open a raw dump and surface its database + identity + iPod root.
 *
 * Identity is resolved by {@link resolveDumpIdentity}: the captured
 * `podkit-device.json` (if the dump carries one), else offline model
 * resolution, else libgpod capabilities.
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

  // Hand the open database to the caller only once identity resolution succeeds;
  // if it throws, close the db first so the handle never leaks. The captured
  // artifact is read from `dumpDir` (the named dir), not `ipodRoot` (`raw dump/`).
  try {
    const identity = await resolveDumpIdentity({ db, ipodRoot, dumpDir });
    return { db, identity, ipodRoot };
  } catch (err) {
    db.close();
    throw err;
  }
}
