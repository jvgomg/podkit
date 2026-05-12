/**
 * `podkit device reset` — recreate iPod database from scratch.
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
import { OutputContext, formatNumber } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg, type DeviceOpDeps } from './shared.js';
import type { DeviceResetOutput } from './output-types.js';

interface ResetOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export const resetSubcommand = new Command('reset')
  .description(
    'recreate iPod database from scratch (note: does not delete orphaned audio files in iPod_Control/Music/; use "device clear --type all" first to remove all content)'
  )
  .option('-y, --yes', 'skip confirmation prompt')
  .option('--dry-run', 'show what would happen without making changes')
  .action(async (options: ResetOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceReset(options, out));
  });

export async function runDeviceReset(
  options: ResetOptions,
  out: OutputContext,
  deps: DeviceOpDeps = {}
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

  // Check if database exists and get current track count
  const hasDb = await IpodDatabase.hasDatabase(devicePath);
  let currentTrackCount = 0;

  if (hasDb) {
    try {
      const ipod = await IpodDatabase.open(devicePath);
      try {
        currentTrackCount = ipod.trackCount;
      } finally {
        ipod.close();
      }
    } catch {
      // Database exists but couldn't be read - that's fine, we're resetting anyway
    }
  }

  const actionVerb = hasDb ? 'recreate' : 'create';
  const actionVerbPast = hasDb ? 'recreated' : 'created';
  const actionVerbIng = hasDb ? 'Recreating' : 'Creating';

  if (options.dryRun) {
    out.result<DeviceResetOutput>(
      { success: true, mountPoint: devicePath, tracksRemoved: currentTrackCount, dryRun: true },
      () => {
        out.print('Dry run - would perform the following:');
        out.newline();
        if (hasDb) {
          out.print(`  1. Remove existing database (${formatNumber(currentTrackCount)} tracks)`);
          out.print('  2. Create fresh iTunesDB');
        } else {
          out.print('  1. Create new iTunesDB (no existing database found)');
        }
        out.print(`  ${hasDb ? '3' : '2'}. Preserve filesystem and volume UUID`);
        out.newline();
        out.print('No changes made.');
      }
    );
    return;
  }

  // Strong confirmation (defaults to No) - only needed if there's content to lose
  if (!autoConfirm && out.isText) {
    out.newline();
    if (hasDb) {
      out.print('WARNING: This will recreate the iPod database from scratch.');
      out.print('All tracks, playlists, and play counts will be lost.');
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
    } else {
      out.print('No existing database found. A fresh database will be created.');
      out.newline();
    }
  }

  out.print(`${actionVerbIng} database...`);

  try {
    const ipod = await IpodDatabase.initializeIpod(devicePath);
    const modelName = ipod.device.modelName;
    ipod.close();

    out.result<DeviceResetOutput>(
      { success: true, mountPoint: devicePath, modelName, tracksRemoved: currentTrackCount },
      () => {
        out.newline();
        out.print(`Database ${actionVerbPast}.`);
        out.print(`  Model:  ${modelName}`);
        out.print(`  Tracks: 0`);
        out.print(`  Path:   ${devicePath}`);
        if (currentTrackCount > 0) {
          out.newline();
          out.print(`Removed ${formatNumber(currentTrackCount)} tracks.`);
        }
        out.newline();
        out.print('You can now sync fresh content:');
        out.print('  podkit sync');
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message,
      code: DeviceErrorCodes.RESET_FAILED,
      details: { mountPoint: devicePath },
      printText: (o) => o.error(`Failed to ${actionVerb} iPod database: ${message}`),
    });
  }
}
