/**
 * Safe readers for what the database layer believes about the open device.
 *
 * `IpodDatabase.device` and `IpodDatabase.trackCount` are getters that reach
 * into the open libgpod handle and throw once the handle is closed. The check
 * runner invokes checks without a per-check try/catch, so a throw from either
 * getter takes down the whole `doctor` run rather than skipping one check.
 * An unreadable handle is simply a check with nothing to say, so every access
 * goes through here: "closed handle", "no device record" and "stub without the
 * field" all collapse into a single `undefined`.
 *
 * @module
 */

/** What the database layer believes it is looking at. */
export interface DatabaseDeviceView {
  /** libgpod generation string; `'unknown'` when it could not resolve one. */
  generation: string;
  modelName: string;
}

/** Read the database layer's device view, or `undefined` if unavailable. */
export function readDatabaseDeviceView(db: unknown): DatabaseDeviceView | undefined {
  const device = readGetter(db, 'device');
  if (!device || typeof device !== 'object') return undefined;
  const { generation, modelName } = device as { generation?: unknown; modelName?: unknown };
  if (typeof generation !== 'string') return undefined;
  return {
    generation,
    modelName: typeof modelName === 'string' ? modelName : 'Unknown',
  };
}

/** Read the open database's track count, or `undefined` if unavailable. */
export function readDatabaseTrackCount(db: unknown): number | undefined {
  const value = readGetter(db, 'trackCount');
  return typeof value === 'number' ? value : undefined;
}

/** Read one property off a possibly-closed database handle without throwing. */
function readGetter(db: unknown, key: string): unknown {
  if (!db || typeof db !== 'object') return undefined;
  try {
    return (db as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
