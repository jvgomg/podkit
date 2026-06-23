/**
 * `podkit device rename [device] <name>` — rename an iPod.
 *
 * The case-correct device name lives in two places: the iTunesDB master-playlist
 * name (what the iPod firmware displays) and the OS volume label. This command
 * writes both by default; `--no-disk` writes only the database name (the
 * remount-free path) and `--no-database` writes only the disk label.
 *
 * `applyDeviceName` carries the ordering contract (DB name first, disk relabel
 * last — relabeling moves the mountpoint). FAT volume labels are lossy
 * (uppercase + 11 chars), so a relabel may produce a label that differs from
 * the displayed name; the resulting label is surfaced as a warning.
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
import { OutputContext } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg, assertIpodDevice, type DeviceOpDeps } from './shared.js';
import type { DeviceRenameOutput } from './output-types.js';
import { makeDeviceConfigRefresh } from '../../config/device-config-refresh.js';
import type { RefreshConfig } from '@podkit/core';

interface RenameOptions {
  /** `--no-disk` inverts to `disk: false`; default `true`. */
  disk?: boolean;
  /** `--no-database` inverts to `database: false`; default `true`. */
  database?: boolean;
  yes?: boolean;
}

/** Rename-specific dep-injection extras (on top of DeviceOpDeps). */
interface RenameOpDeps extends DeviceOpDeps {
  /**
   * Override the config-refresh seam injected into `applyDeviceName`.
   * Defaults to `makeDeviceConfigRefresh()`. Tests inject a fake so they
   * can assert the seam was called with the right arguments without touching
   * a real config file.
   */
  refreshConfig?: RefreshConfig;
}

export const renameSubcommand = new Command('rename')
  .description("rename the device (writes the iPod's name and the disk label)")
  .argument('<name>', 'new name for the device')
  .option('--no-disk', 'do not change the OS volume label (rename the database only)')
  .option('--no-database', 'do not change the iPod database name (relabel the disk only)')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (name: string, options: RenameOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceRename(name, options, out));
  });

export async function runDeviceRename(
  name: string,
  options: RenameOptions,
  out: OutputContext,
  deps: RenameOpDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();
  const autoConfirm = options.yes ?? false;
  const confirmFn = deps.confirm ?? confirmNo;

  // Commander inverts `--no-X` to `options.X === false`; absent → undefined → default true.
  const writeDisk = options.disk !== false;
  const writeDatabase = options.database !== false;

  // Both branches disabled is a no-op — reject early with a clear error.
  if (!writeDisk && !writeDatabase) {
    throw new CliError({
      message: 'Nothing to rename: --no-disk and --no-database cancel each other out.',
      code: DeviceErrorCodes.NOTHING_TO_RENAME,
    });
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new CliError({
      message:
        'Missing new name. Usage: podkit device rename <name> (use -d to select the device).',
      code: DeviceErrorCodes.NAME_REQUIRED,
    });
  }

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const { resolvedDevice, cliPath } = resolved;

  // Gate: this command only works with iPod devices (requires iTunesDB)
  assertIpodDevice(resolvedDevice, 'rename');

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const IpodDatabase = deps.ipodDatabase ?? core.IpodDatabase;
  const { IpodError } = core;
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

  let ipod;
  try {
    ipod = await IpodDatabase.open(devicePath);
  } catch (err) {
    const isIpodError = err instanceof IpodError;
    const message = err instanceof Error ? err.message : String(err);

    throw new CliError({
      message: isIpodError ? `Not an iPod or database corrupted: ${message}` : message,
      code: isIpodError
        ? DeviceErrorCodes.IPOD_DATABASE_INVALID
        : DeviceErrorCodes.IPOD_DATABASE_OPEN_FAILED,
      printText: (o) => {
        o.error(`Cannot read iPod database at: ${devicePath}`);
        o.newline();
        if (isIpodError) {
          o.error('This path does not appear to be a valid iPod:');
          o.error('  - Missing iTunesDB file');
          o.error('  - Database may be corrupted');
        } else {
          o.error(`Error: ${message}`);
        }
      },
    });
  }

  try {
    if (!autoConfirm && out.isText) {
      out.print(`Rename this iPod to "${trimmedName}"?`);
      out.newline();
      const confirmed = await confirmFn('Continue?');
      if (!confirmed) {
        throw new CliError({
          message: 'Operation cancelled by user',
          code: DeviceErrorCodes.CANCELLED,
          printText: (o) => o.print('Operation cancelled.'),
        });
      }
    }

    // The config-refresh seam updates the cached volumeName/path in the podkit
    // config after the disk relabel moves the mountpoint. Tests override this
    // via deps.refreshConfig; production uses makeDeviceConfigRefresh() which
    // matches by volumeUuid and silently skips when no entry is found.
    const refreshConfig =
      deps.refreshConfig ?? makeDeviceConfigRefresh({ warn: (m) => out.warn(m) });

    let result;
    try {
      result = await core.applyDeviceName({
        db: ipod,
        mountPath: devicePath,
        name: trimmedName,
        disk: writeDisk,
        database: writeDatabase,
        refreshConfig,
        volumeUuid: deviceIdentity?.volumeUuid,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CliError({
        message,
        code: DeviceErrorCodes.RENAME_FAILED,
        details: { mountPoint: devicePath },
        printText: (o) => o.error(`Failed to rename iPod: ${message}`),
      });
    }

    out.result<DeviceRenameOutput>(
      {
        success: true,
        name: result.name,
        mountPoint: result.mountPath,
        databaseUpdated: result.databaseUpdated,
        diskUpdated: result.diskUpdated,
        ...(result.diskLabel !== undefined ? { diskLabel: result.diskLabel } : {}),
        ...(result.diskWarning !== undefined ? { diskWarning: result.diskWarning } : {}),
      },
      () => {
        // One line per surface that was actually changed.
        if (result.databaseUpdated) {
          out.print(`Renamed iPod to "${result.name}".`);
        }
        if (result.diskUpdated && result.diskLabel !== undefined) {
          out.print(`Disk label set to "${result.diskLabel}".`);
        }
        // Only warn when the label is a *lossy* rendering of the name
        // (truncated / illegal characters) — not for plain case-folding, which
        // the line above already makes obvious.
        if (result.diskWarning) {
          out.warn(result.diskWarning);
        }
      }
    );
  } finally {
    ipod.close();
  }
}
