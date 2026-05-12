/**
 * `podkit device clear` — remove content from an iPod (all, music, or video).
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
import { OutputContext, formatBytes, formatNumber } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg, type DeviceOpDeps } from './shared.js';
import type { DeviceClearOutput } from './output-types.js';

interface ClearOptions {
  confirm?: boolean;
  dryRun?: boolean;
  type?: 'music' | 'video' | 'all';
}

export const clearSubcommand = new Command('clear')
  .description('remove content from the device (all, music only, or video only)')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .option(
    '--type <type>',
    'content type to clear: "music", "video", or "all" (default: all)',
    'all'
  )
  .action(async (options: ClearOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceClear(options, out));
  });

export async function runDeviceClear(
  options: ClearOptions,
  out: OutputContext,
  deps: DeviceOpDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();
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

  // Validate type option (before opening the database, to avoid a needless open/close)
  const contentType = options.type ?? 'all';
  if (!['music', 'video', 'all'].includes(contentType)) {
    throw new CliError({
      message: `Invalid type "${contentType}". Must be "music", "video", or "all".`,
      code: DeviceErrorCodes.INVALID_TYPE,
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
    const { isMusicMediaType, isVideoMediaType } = core;

    const allTracks = ipod.getTracks();

    // Filter tracks based on content type
    let targetTracks;
    if (contentType === 'all') {
      targetTracks = allTracks;
    } else if (contentType === 'music') {
      targetTracks = allTracks.filter((t) => isMusicMediaType(t.mediaType));
    } else {
      targetTracks = allTracks.filter((t) => isVideoMediaType(t.mediaType));
    }

    const targetCount = targetTracks.length;
    const targetSize = targetTracks.reduce((sum, track) => sum + track.size, 0);

    const contentLabel =
      contentType === 'all' ? 'content' : contentType === 'music' ? 'music tracks' : 'videos';

    if (targetCount === 0) {
      out.result<DeviceClearOutput>(
        {
          success: true,
          contentType,
          tracksRemoved: 0,
          totalTracks: 0,
          dryRun: options.dryRun,
        },
        () => out.print(`iPod has no ${contentLabel} to remove.`)
      );
      return;
    }

    if (options.dryRun) {
      out.result<DeviceClearOutput>(
        {
          success: true,
          contentType,
          tracksRemoved: targetCount,
          totalTracks: targetCount,
          totalSize: targetSize,
          dryRun: true,
        },
        () => {
          out.print(
            `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
          );
          out.newline();
          out.print(`Dry run: would remove ${contentLabel} and files.`);
        }
      );
      return;
    }

    if (!options.confirm && out.isText) {
      out.print(`Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`);
      out.newline();
      if (contentType === 'all') {
        out.print('This will remove ALL content from the iPod. Files will be deleted.');
      } else {
        out.print(`This will remove all ${contentLabel} from the iPod. Files will be deleted.`);
      }
      out.print('This action cannot be undone.');
      out.newline();

      const confirmPrompt =
        contentType === 'all' ? 'Delete all content?' : `Delete all ${contentLabel}?`;
      const confirmed = await confirmFn(confirmPrompt);
      if (!confirmed) {
        throw new CliError({
          message: 'Operation cancelled by user',
          code: DeviceErrorCodes.CANCELLED,
          printText: (o) => o.print('Operation cancelled.'),
        });
      }
    }

    out.print(`Removing ${contentLabel}...`);

    // Perform the removal based on content type
    let result;
    if (contentType === 'all') {
      result = ipod.removeAllTracks({ deleteFiles: true });
    } else {
      result = ipod.removeTracksByContentType(contentType, { deleteFiles: true });
    }
    await ipod.save();

    if (result.fileDeleteErrors.length > 0) {
      for (const error of result.fileDeleteErrors) {
        out.warn(error);
      }
    }

    out.result<DeviceClearOutput>(
      {
        success: true,
        contentType,
        tracksRemoved: result.removedCount,
        totalTracks: targetCount,
        totalSize: targetSize,
        fileDeleteErrors: result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
      },
      () =>
        out.print(
          `Removed ${formatNumber(result.removedCount)} ${contentLabel}, freed ${formatBytes(targetSize)}.`
        )
    );
  } finally {
    ipod.close();
  }
}
