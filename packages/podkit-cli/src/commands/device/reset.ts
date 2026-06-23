/**
 * `podkit device reset` — factory-reset an already-initialised iPod.
 *
 * Reset is a true one-shot factory wipe (doc-048 slice .04):
 *
 *   1. Open the existing iTunesDB and read the device's current name (the
 *      master-playlist name). A device with no readable database errors out,
 *      pointing the user at `podkit device init` (reset re-sets an
 *      already-initialised device; init does first-time setup).
 *   2. Recreate an empty iTunesDB via `initializeIpod`, baking the name in at
 *      creation (so the DB-name branch of `applyDeviceName` is unnecessary).
 *   3. Brute-force sweep on-disk content (`sweepDeviceContent`) — all audio
 *      under `iPod_Control/Music/F*` and all artwork `.ithmb`/`ArtworkDB`.
 *      This is what removes orphan files an ordinary `clear` would leave.
 *   4. Make the OS volume label consistent via the disk-only branch of
 *      `applyDeviceName` (`database: false`), reusing its relabel + config
 *      refresh rather than duplicating that logic. The relabel runs LAST
 *      because it moves the mountpoint.
 *
 * Reset is all-or-nothing — there are no `--no-*` partial-wipe flags. Partial
 * wipes remain on `clear` / `reset-artwork`.
 */
import { Command } from 'commander';
import { confirmNo } from '../../utils/confirm.js';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail } from '../../handler-deps.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
} from '../../device-resolver.js';
import { OutputContext, formatNumber, formatBytes } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg, assertIpodDevice, type DeviceOpDeps } from './shared.js';
import type { DeviceResetOutput } from './output-types.js';
import { makeDeviceConfigRefresh } from '../../config/device-config-refresh.js';
import type { RefreshConfig } from '@podkit/core';

interface ResetOptions {
  /** New name for the recreated database + disk label (defaults to current name). */
  name?: string;
  yes?: boolean;
  dryRun?: boolean;
}

/** Reset-specific dep-injection extras (on top of DeviceOpDeps). */
interface ResetOpDeps extends DeviceOpDeps {
  /**
   * Override the config-refresh seam injected into `applyDeviceName`'s disk
   * branch. Defaults to `makeDeviceConfigRefresh()`. Tests inject a fake.
   */
  refreshConfig?: RefreshConfig;
}

export const resetSubcommand = new Command('reset')
  .description(
    'factory-reset the iPod: recreate an empty database and wipe all audio + artwork files on disk'
  )
  .option('--name <name>', 'name for the reset device (defaults to its current name)')
  .option('-y, --yes', 'skip confirmation prompt')
  .option('-n, --dry-run', 'show what would happen without making changes')
  .action(async (options: ResetOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceReset(options, out));
  });

export async function runDeviceReset(
  options: ResetOptions,
  out: OutputContext,
  deps: ResetOpDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();
  const autoConfirm = options.yes ?? false;
  const confirmFn = deps.confirm ?? confirmNo;

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const { resolvedDevice, cliPath } = resolved;

  // Gate: this command only works with iPod devices (requires iTunesDB)
  assertIpodDevice(resolvedDevice, 'reset');

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const IpodDatabase = deps.ipodDatabase ?? core.IpodDatabase;
  const sweepDeviceContent = deps.sweepDeviceContent ?? core.sweepDeviceContent;
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
  const deviceIdentity = getDeviceIdentity(resolvedDevice);

  if (deviceIdentity?.volumeUuid) {
    out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
  }

  const resolveResult = await resolveDevicePath({
    cliDevice: cliPath,
    deviceIdentity,
    manager,
    requireMounted: true,
    quiet: globalOpts.quiet,
  });

  if (!resolveResult.path) {
    throw new CliError({
      message: resolveResult.error ?? formatDeviceError(resolveResult),
      code: DeviceErrorCodes.DEVICE_PATH_UNRESOLVED,
    });
  }

  const devicePath = resolveResult.path;

  if (!existsSync(devicePath)) {
    throw new CliError({
      message: `Device path not found: ${devicePath}`,
      code: DeviceErrorCodes.DEVICE_PATH_NOT_FOUND,
      printText: (o) => {
        o.error(`iPod not found at: ${devicePath}`);
        o.newline();
        o.error('Make sure the iPod is connected and mounted.');
      },
    });
  }

  // Step 1: open the existing database and read the current device name.
  // A device with no readable iTunesDB cannot be *re*-set — point the user to
  // `device init` for first-time setup (AC#4).
  const hasDb = await IpodDatabase.hasDatabase(devicePath);
  if (!hasDb) {
    throw notInitializedError(devicePath, options.name);
  }

  let currentTrackCount = 0;
  let currentName: string | undefined;
  let modelName: string | undefined;
  try {
    const ipod = await IpodDatabase.open(devicePath);
    try {
      currentTrackCount = ipod.trackCount;
      currentName = ipod.getMasterPlaylist().name;
      modelName = ipod.device.modelName;
    } finally {
      ipod.close();
    }
  } catch {
    // Database present on disk but unreadable / no name → treat as uninitialised.
    throw notInitializedError(devicePath, options.name);
  }

  if (!currentName || !currentName.trim()) {
    throw notInitializedError(devicePath, options.name);
  }

  const overrideName = options.name?.trim();
  const effectiveName = overrideName || currentName;

  // ── Dry run: report every step, mutate nothing ──────────────────────────────
  if (options.dryRun) {
    out.result<DeviceResetOutput>(
      {
        success: true,
        mountPoint: devicePath,
        name: effectiveName,
        tracksRemoved: currentTrackCount,
        dryRun: true,
      },
      () => {
        out.print('Dry run - would perform the following:');
        out.newline();
        out.print(
          `  1. Wipe all audio + artwork files and delete the database (currently ${formatNumber(currentTrackCount)} tracks)`
        );
        out.print(`  2. Recreate an empty iTunesDB named "${effectiveName}"`);
        out.print(`  3. Set the disk label to match "${effectiveName}"`);
        out.newline();
        out.print('No changes made.');
      }
    );
    return;
  }

  // ── Confirmation (defaults to No) ───────────────────────────────────────────
  if (!autoConfirm && out.isText) {
    out.newline();
    out.print('WARNING: This is a factory reset.');
    out.print('All tracks, playlists, play counts, audio files, and artwork will be erased.');
    if (currentTrackCount > 0) {
      out.print(`Currently: ${formatNumber(currentTrackCount)} tracks`);
    }
    out.newline();
    out.print('Your device configuration in podkit will remain valid.');
    out.newline();

    const confirmed = await confirmFn('Continue?');
    if (!confirmed) {
      out.print('Cancelled. No changes made.');
      return;
    }
  }

  out.print('Resetting iPod...');

  // Step 2: brute-force wipe everything on disk — audio, artwork, AND the
  // database files. Deleting the iTunesDB (rather than clearing tracks through
  // the API) is the only way to remove orphaned playlist members — phantom
  // "track ID 0" entries a corrupt or foreign database can carry, which survive
  // track-level removal and make libgpod warn on every reopen. The empty DB is
  // recreated in step 3.
  let sweep;
  try {
    sweep = sweepDeviceContent(devicePath, { music: true, artwork: true, database: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message,
      code: DeviceErrorCodes.RESET_FAILED,
      details: { mountPoint: devicePath },
      printText: (o) => o.error(`Failed to wipe device content: ${message}`),
    });
  }

  // Step 3: recreate a pristine empty database with the name baked in. Because
  // step 2 deleted the iTunesDB, initializeIpod creates a fresh empty one (given
  // an existing DB it would instead parse + preserve it — see step 2).
  let initIpod: Awaited<ReturnType<typeof IpodDatabase.initializeIpod>> | undefined;
  try {
    initIpod = await IpodDatabase.initializeIpod(devicePath, { name: effectiveName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message,
      code: DeviceErrorCodes.RESET_FAILED,
      details: { mountPoint: devicePath },
      printText: (o) => o.error(`Failed to recreate iPod database: ${message}`),
    });
  } finally {
    initIpod?.close();
  }

  // Step 4: make the disk label consistent. Reuse the disk-only branch of
  // applyDeviceName (database: false — the DB name was already baked in at
  // step 3). This relabels the volume LAST (it moves the mountpoint) and
  // refreshes the cached config path/name.
  const refreshConfig = deps.refreshConfig ?? makeDeviceConfigRefresh({ warn: (m) => out.warn(m) });

  let diskLabel: string | undefined;
  let diskWarning: string | undefined;
  try {
    const labelResult = await core.applyDeviceName({
      mountPath: devicePath,
      name: effectiveName,
      database: false,
      disk: true,
      volumeUuid: deviceIdentity?.volumeUuid,
      refreshConfig,
    });
    diskLabel = labelResult.diskLabel;
    diskWarning = labelResult.diskWarning;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The database wipe + recreate already succeeded; a failed disk relabel is
    // cosmetic (the OS volume label stays stale). Downgrade to a non-fatal
    // warning so a completed factory reset still reports success.
    diskWarning = `Database reset, but setting the disk label failed: ${message}`;
  }

  out.result<DeviceResetOutput>(
    {
      success: true,
      mountPoint: devicePath,
      name: effectiveName,
      modelName,
      tracksRemoved: currentTrackCount,
      musicFilesRemoved: sweep.musicFilesRemoved,
      artworkFilesRemoved: sweep.artworkFilesRemoved,
      bytesFreed: sweep.bytesFreed,
      ...(diskLabel !== undefined ? { diskLabel } : {}),
      ...(diskWarning !== undefined ? { diskWarning } : {}),
    },
    () => {
      out.newline();
      out.print('Factory reset complete.');
      out.print(`  Name:    ${effectiveName}`);
      if (modelName) out.print(`  Model:   ${modelName}`);
      out.print(`  Tracks:  0`);
      out.print(
        `  Wiped:   ${formatNumber(sweep.musicFilesRemoved)} audio + ${formatNumber(sweep.artworkFilesRemoved)} artwork files (${formatBytes(sweep.bytesFreed)})`
      );
      out.print(`  Path:    ${devicePath}`);
      if (diskWarning) {
        out.newline();
        out.warn(diskWarning);
      }
      out.newline();
      out.print('You can now sync fresh content:');
      out.print('  podkit sync');
    }
  );
}

/**
 * Build the AC#4 "not initialised" error. Reset re-sets an already-initialised
 * device; first-time setup is `device init`. The suggested init command carries
 * `--name` through when the user supplied one.
 */
function notInitializedError(devicePath: string, name?: string): CliError {
  const trimmed = name?.trim();
  const initCmd = trimmed
    ? `podkit device init --name "${trimmed}"`
    : 'podkit device init --name "<name>"';
  return new CliError({
    message: `No iPod database found at ${devicePath}. Reset re-sets an already-initialised device; use \`${initCmd}\` for first-time setup.`,
    code: DeviceErrorCodes.NOT_INITIALIZED,
    details: { mountPoint: devicePath },
    printText: (o) => {
      o.error(`This iPod has no database to reset (${devicePath}).`);
      o.newline();
      o.error('Reset re-sets a device that has already been initialised.');
      o.error('For first-time setup, run:');
      o.error(`  ${initCmd}`);
    },
  });
}
