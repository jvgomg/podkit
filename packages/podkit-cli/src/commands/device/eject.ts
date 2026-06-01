/**
 * `podkit device eject` — safely unmount a device.
 */
import { Command } from 'commander';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../../handler-deps.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
} from '../../device-resolver.js';
import { OutputContext } from '../../output/index.js';
import { isMassStorageDevice, getDeviceTypeDisplayName } from '../open-device.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg } from './shared.js';
import type { DeviceEjectOutput } from './output-types.js';

interface EjectOptions {
  force?: boolean;
}

/**
 * Dependency injection seam for `runDeviceEject` (the `podkit device eject`
 * subcommand). The root `podkit eject` command lives in `commands/eject.ts`
 * with its own `EjectDeps` — both seams are similar; we keep them separate
 * because the user-facing prompts diverge slightly.
 */
export interface DeviceEjectDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
}

export const ejectSubcommand = new Command('eject')
  .alias('unmount')
  .description('safely unmount a device')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (options: EjectOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceEject(options, out));
  });

export async function runDeviceEject(
  options: EjectOptions,
  out: OutputContext,
  deps: DeviceEjectDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();
  const force = options.force ?? false;

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const { resolvedDevice, cliPath } = resolved;

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  if (!manager.isSupported) {
    throw new CliError({
      message: `Eject is not supported on ${manager.platform}`,
      code: DeviceErrorCodes.EJECT_UNSUPPORTED,
      printText: (o) => {
        o.error(`Eject is not supported on ${manager.platform}.`);
        o.newline();
        o.error(manager.getManualInstructions('eject'));
      },
    });
  }

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

  const deviceLabel = isMassStorageDevice(resolvedDevice?.config?.type)
    ? getDeviceTypeDisplayName(resolvedDevice?.config)
    : 'iPod';

  if (!existsSync(devicePath)) {
    throw new CliError({
      message: `Device path not found: ${devicePath}`,
      code: DeviceErrorCodes.DEVICE_PATH_NOT_FOUND,
      details: { device: devicePath },
      printText: (o) => {
        o.error(`${deviceLabel} not found at: ${devicePath}`);
        o.newline();
        o.error(`Make sure the ${deviceLabel.toLowerCase()} is connected and mounted.`);
      },
    });
  }

  out.print(`Ejecting ${deviceLabel} at ${devicePath}...`);

  const result = await manager.eject(devicePath, { force });

  if (result.success) {
    out.result<DeviceEjectOutput>(
      { success: true, device: devicePath, forced: result.forced },
      () => out.success(`${deviceLabel} ejected successfully. Safe to disconnect.`)
    );
  } else {
    throw new CliError({
      message: result.error ?? 'Eject failed',
      code: DeviceErrorCodes.EJECT_FAILED,
      details: { device: devicePath, forced: result.forced },
      printText: (o) => {
        o.error(`Failed to eject ${deviceLabel.toLowerCase()}.`);
        o.newline();
        if (result.error) {
          o.error(result.error);
        }
        if (!force) {
          o.newline();
          o.error('Try: podkit device eject --force');
        }
      },
    });
  }
}
