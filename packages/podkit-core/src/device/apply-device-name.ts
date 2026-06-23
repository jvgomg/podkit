/**
 * Orchestrates renaming a device across its two independent name surfaces:
 *
 *   1. **Database name** — the iTunesDB master-playlist name (the case-correct
 *      device name the iPod firmware displays, e.g. "Party iPod"). Written via
 *      {@link IpodDatabaseNameWriter.setDeviceName}.
 *   2. **Disk label** — the OS-level volume label (the `/Volumes/<LABEL>`
 *      mountpoint name on macOS, the FAT/HFS volume label on disk). Derived
 *      from the name via {@link labelFromName} (FAT folds to uppercase + 11
 *      chars; HFS+ preserves case) and written via the injected
 *      {@link DeviceLabelWriter.setVolumeLabel}.
 *
 * The two surfaces are independent: a user may want one without the other
 * (e.g. `--no-disk` for a database-only rename that avoids remounting), so the
 * caller selects which branches run via the `disk` / `database` flags.
 *
 * ## Ordering contract (load-bearing)
 *
 * When BOTH branches run, the database name MUST be written first and the disk
 * label LAST. Relabeling the volume moves the OS mountpoint (e.g.
 * `/Volumes/IPOD` → `/Volumes/Party iPod`), which invalidates the path the
 * open database was using. So the safe order is:
 *
 *   1. Write the DB name (master playlist) while the current mountpoint is
 *      still valid, and persist it.
 *   2. Write the disk label (relabel the volume) — this may move the mountpoint.
 *   3. Re-resolve the path to point at the new mountpoint.
 *
 * Step 3's config refresh (persisting the new path into the device config) is
 * slice .03 — the `mountPath` re-resolution seam (`resolveMountPath`) is left in
 * place so .03 can add the config write without reshaping this signature.
 *
 * ## Injected seams
 *
 * The disk branch's three side-effecting dependencies are injected so the
 * orchestrator stays unit-testable with fakes (mirroring how the database
 * branch injects {@link IpodDatabaseNameWriter}):
 *
 *   - `detectFilesystem(path)` — reports the volume's filesystem string.
 *   - `setVolumeLabel(path, label)` — relabels the volume.
 *   - `resolveMountPath(oldPath, newLabel)` — re-resolves the mountpoint after
 *     a relabel moved it.
 *
 * All three have real defaults wired from the platform device manager, so
 * callers normally pass only `db` / `mountPath` / `name`.
 */

import { getDeviceManager } from './manager.js';
import {
  classifyVolumeFilesystem,
  labelFromName,
  type VolumeFilesystem,
} from './label-from-name.js';
import { VolumeLabelError } from './types.js';

/**
 * Minimal database seam this orchestrator needs. Satisfied by
 * `@podkit/core`'s `IpodDatabase`, but narrowed so tests can inject a fake
 * without constructing a full database.
 */
export interface IpodDatabaseNameWriter {
  /** Write the device name (iTunesDB master-playlist name). */
  setDeviceName(name: string): void;
  /** Persist pending changes to disk. */
  save(): Promise<unknown>;
}

/**
 * Disk-side seams the orchestrator needs to detect the filesystem, relabel the
 * volume, and re-resolve the mountpoint after a relabel. Defaulted from the
 * platform device manager; injected as fakes in tests.
 */
export interface DeviceLabelWriter {
  /** Report the filesystem string of the volume at `path` (e.g. "MS-DOS FAT32"). */
  detectFilesystem(path: string): Promise<string | null>;
  /** Relabel the volume mounted at `path`. May move the mountpoint. */
  setVolumeLabel(path: string, label: string): Promise<void>;
}

/**
 * Re-resolve the mountpoint after a relabel moved it. The default queries the
 * platform device manager; tests inject a fake. Returns the path unchanged when
 * the new mountpoint cannot be resolved (best-effort — the relabel succeeded).
 */
export type ResolveMountPath = (oldPath: string, newLabel: string) => Promise<string>;

/**
 * Info passed to the optional config-refresh seam after a disk relabel
 * completes. The seam lives in the CLI layer; core provides only this type and
 * a no-op default, keeping `@podkit/core` free of any CLI config dependency.
 *
 * Fields:
 * - `volumeUuid` — stable device identity key (undefined when the device was
 *   opened by path and the UUID is unknown).
 * - `oldPath` — the mountpoint before the relabel.
 * - `newPath` — the mountpoint after the relabel (may equal `oldPath` on HFS+
 *   when the volume name was already the same, or when re-resolution fell back).
 * - `newLabel` — the disk label that was written (FAT-lossy form).
 * - `name` — the case-correct display name (what the DB master-playlist got).
 */
export interface ConfigRefreshInfo {
  volumeUuid?: string;
  oldPath: string;
  newPath: string;
  newLabel: string;
  name: string;
}

/**
 * Optional seam called after a successful disk relabel. The CLI injects a real
 * implementation that updates the config's cached `volumeName` / `path` for the
 * device matched by `volumeUuid`. Core defaults to a no-op so Docker/headless
 * callers and `--no-disk` invocations are unaffected.
 */
export type RefreshConfig = (info: ConfigRefreshInfo) => Promise<void>;

export interface ApplyDeviceNameInput {
  /**
   * Open iPod database to write the name into. Required when the database
   * branch runs (`database !== false`); may be omitted for a disk-only call
   * (`database: false`), where no database handle is needed — `reset` uses this
   * to reuse the disk-relabel branch after it has already recreated the DB with
   * the name baked in.
   */
  db?: IpodDatabaseNameWriter;
  /** Current mountpoint of the device. */
  mountPath: string;
  /** The new device name. */
  name: string;
  /**
   * Write the OS volume label. Defaults to `true`. Set `false` for a
   * database-only rename (`--no-disk`).
   */
  disk?: boolean;
  /**
   * Write the iTunesDB master-playlist name. Defaults to `true`. Set `false`
   * to relabel the disk only (`--no-database`).
   */
  database?: boolean;
  /**
   * Disk-side seam (filesystem detection + relabel). Defaults to the platform
   * device manager.
   */
  labelWriter?: DeviceLabelWriter;
  /**
   * Re-resolve the mountpoint after a relabel. Defaults to a platform
   * device-manager lookup.
   */
  resolveMountPath?: ResolveMountPath;
  /**
   * Optional post-relabel hook that the CLI uses to update the config's cached
   * `volumeName` / `path` for the device. Core defaults to a no-op so
   * Docker/headless callers are unaffected. Only called when the disk branch
   * ran (i.e. `disk !== false`).
   *
   * The `volumeUuid` on the info object is available only when the caller
   * supplies it; the seam must tolerate it being absent.
   */
  refreshConfig?: RefreshConfig;
  /**
   * The stable volume UUID of the device being renamed. Forwarded to
   * `refreshConfig` so the CLI can locate the config entry by UUID instead of
   * by path (which changes after a relabel).
   */
  volumeUuid?: string;
}

export interface ApplyDeviceNameResult {
  /** The name that was applied. */
  name: string;
  /** Whether the database (master-playlist) name was written + saved. */
  databaseUpdated: boolean;
  /** Whether the OS volume label was written. */
  diskUpdated: boolean;
  /**
   * The mountpoint after applying the name. Re-resolved after a relabel moves
   * the mountpoint; equal to the input `mountPath` when the disk branch did not
   * run or the new mountpoint could not be resolved.
   */
  mountPath: string;
  /**
   * The disk label that was written, when the disk branch ran. Differs from
   * `name` on lossy filesystems (FAT folds to uppercase + 11 chars).
   */
  diskLabel?: string;
  /**
   * Human-readable warning when the disk label is a lossy rendering of the name
   * (e.g. FAT uppercasing / truncation). The CLI surfaces this to the user.
   */
  diskWarning?: string;
}

/** Default disk-side seam backed by the platform device manager. */
function defaultLabelWriter(): DeviceLabelWriter {
  const manager = getDeviceManager();
  return {
    detectFilesystem: (path) => manager.detectFilesystem(path),
    setVolumeLabel: (path, label) => manager.setVolumeLabel(path, label),
  };
}

/**
 * Default mountpoint re-resolution: locate the volume by its new label, falling
 * back to the old path when the platform cannot resolve the moved mountpoint.
 */
function defaultResolveMountPath(): ResolveMountPath {
  const manager = getDeviceManager();
  return async (oldPath, newLabel) => {
    // macOS moves /Volumes/OLD → /Volumes/<label>. Try the conventional new
    // path first; fall back to the old path if it does not exist as a mount.
    const candidate = `/Volumes/${newLabel}`;
    const located = await manager.locate({ path: candidate });
    if (located?.isMounted) return located.mountPoint;
    return oldPath;
  };
}

/**
 * Apply a new device name across the selected surfaces.
 *
 * The database branch runs first (while the current mountpoint is valid), then
 * the disk branch relabels the volume and re-resolves the mountpoint. See the
 * module doc for the full ordering contract.
 */
export async function applyDeviceName({
  db,
  mountPath,
  name,
  disk = true,
  database = true,
  labelWriter,
  resolveMountPath,
  refreshConfig,
  volumeUuid,
}: ApplyDeviceNameInput): Promise<ApplyDeviceNameResult> {
  let databaseUpdated = false;

  // Step 1: write the database (master-playlist) name first, while the current
  // mountpoint is still valid, then persist it.
  if (database) {
    if (!db) {
      // Misuse guard: the database branch needs a handle. A disk-only call
      // (`reset`) must pass `database: false`.
      throw new Error('applyDeviceName: database branch requested but no db handle was supplied.');
    }
    db.setDeviceName(name);
    await db.save();
    databaseUpdated = true;
  }

  // Step 2: write the disk label LAST. Relabeling moves the OS mountpoint, so
  // it must happen after the DB write + save above.
  let diskUpdated = false;
  let resolvedMountPath = mountPath;
  let diskLabel: string | undefined;
  let diskWarning: string | undefined;

  if (disk) {
    const writer = labelWriter ?? defaultLabelWriter();

    const filesystemString = await writer.detectFilesystem(mountPath);
    const family: VolumeFilesystem | null = classifyVolumeFilesystem(filesystemString ?? undefined);
    if (family === null) {
      throw new VolumeLabelError(
        `Cannot relabel ${mountPath}: unsupported or unresolved filesystem ` +
          `"${filesystemString ?? 'unknown'}".`,
        filesystemString ? 'UNSUPPORTED_FILESYSTEM' : 'FILESYSTEM_UNRESOLVED'
      );
    }

    const derived = labelFromName(name, family);
    await writer.setVolumeLabel(mountPath, derived.label);
    diskUpdated = true;
    diskLabel = derived.label;
    diskWarning = derived.warning;

    // Step 3: re-resolve the mountpoint the relabel may have moved.
    const resolver = resolveMountPath ?? defaultResolveMountPath();
    resolvedMountPath = await resolver(mountPath, derived.label);

    // Step 4: notify the optional config-refresh seam so the caller (CLI)
    // can update the cached volumeName/path in the podkit config. Core
    // defaults to a no-op; only called when the disk branch actually ran.
    if (refreshConfig) {
      await refreshConfig({
        volumeUuid,
        oldPath: mountPath,
        newPath: resolvedMountPath,
        newLabel: derived.label,
        name,
      });
    }
  }

  return {
    name,
    databaseUpdated,
    diskUpdated,
    mountPath: resolvedMountPath,
    ...(diskLabel !== undefined ? { diskLabel } : {}),
    ...(diskWarning !== undefined ? { diskWarning } : {}),
  };
}
