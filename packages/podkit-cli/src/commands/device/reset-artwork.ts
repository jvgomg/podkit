/**
 * `podkit device reset-artwork` — wipe all artwork and clear artwork sync tags.
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
import { resolveDeviceArg, type DeviceOpDeps } from './shared.js';
import type { DeviceResetArtworkOutput, DeviceResetArtworkSuccess } from './output-types.js';

interface ResetArtworkOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export const resetArtworkSubcommand = new Command('reset-artwork')
  .description('wipe all artwork and clear artwork sync tags')
  .option('-y, --yes', 'skip confirmation prompt')
  .option('--dry-run', 'show what would happen without making changes')
  .action(async (options: ResetArtworkOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceResetArtwork(options, out));
  });

export async function runDeviceResetArtwork(
  options: ResetArtworkOptions,
  out: OutputContext,
  deps: DeviceOpDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();
  const autoConfirm = options.yes ?? false;
  const dryRun = options.dryRun ?? false;
  const confirmFn = deps.confirm ?? confirmNo;

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const { resolvedDevice, cliPath } = resolved;

  // Gate: this command only works with iPod devices (requires iTunesDB)
  const resolvedType = resolvedDevice?.config?.type;
  if (resolvedType && resolvedType !== 'ipod') {
    throw new CliError({
      message:
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.',
      code: DeviceErrorCodes.IPOD_ONLY,
    });
  }

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const IpodDatabase = deps.ipodDatabase ?? core.IpodDatabase;
  const resetArtworkDatabase = deps.resetArtworkDatabase ?? core.resetArtworkDatabase;
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

  // Open database to get track count for confirmation message
  let db: Awaited<ReturnType<typeof IpodDatabase.open>>;
  try {
    db = await IpodDatabase.open(devicePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to open iPod database';
    throw new CliError({
      message,
      code: DeviceErrorCodes.IPOD_DATABASE_OPEN_FAILED,
    });
  }

  try {
    const trackCount = db.trackCount;

    // Confirmation prompt (destructive operation — default to NO)
    if (!dryRun && !autoConfirm && out.isText) {
      out.print(`This will remove all artwork from ${trackCount.toLocaleString()} tracks`);
      out.print('and clear artwork sync tags so the next sync re-adds artwork.');
      out.newline();

      const confirmed = await confirmFn('Reset artwork database?');
      if (!confirmed) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    // `db` may be either a real `IpodDatabase` or an `IpodAdapterStub` (when
    // tests override `deps.ipodDatabase`). The override of `resetArtworkDatabase`
    // is wired to handle either; the cast is safe.
    const result = await resetArtworkDatabase(
      db as import('@podkit/core').IpodDatabase,
      devicePath,
      { dryRun }
    );

    const output: DeviceResetArtworkSuccess = {
      success: true,
      tracksCleared: result.tracksCleared,
      totalTracks: result.totalTracks,
      orphanedFilesRemoved: result.orphanedFilesRemoved,
      dryRun,
    };

    out.result<DeviceResetArtworkOutput>(output, () => {
      if (dryRun) {
        out.print(
          `Dry run: would clear artwork from ${result.tracksCleared.toLocaleString()} of ${result.totalTracks.toLocaleString()} tracks.`
        );
      } else {
        out.success(
          `Cleared artwork from ${result.tracksCleared.toLocaleString()} of ${result.totalTracks.toLocaleString()} tracks.`
        );
        if (result.orphanedFilesRemoved > 0) {
          out.print(
            `Cleaned up ${result.orphanedFilesRemoved} orphaned .ithmb file${result.orphanedFilesRemoved === 1 ? '' : 's'}.`
          );
        }
        out.newline();
        out.print('The next `podkit sync` will re-add artwork from your source collection.');
      }
    });
  } catch (err) {
    if (err instanceof CliError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message,
      code: DeviceErrorCodes.RESET_ARTWORK_FAILED,
      printText: (o) => o.error(`Reset artwork failed: ${message}`),
    });
  } finally {
    db.close();
  }
}
