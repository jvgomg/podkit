/**
 * Eject command - root shortcut for `podkit device eject`
 *
 * This is a convenience command that delegates to `podkit device eject`.
 *
 * @example
 * ```bash
 * podkit eject                    # Eject default device
 * podkit eject -d terapod         # Eject named device
 * podkit eject --force            # Force unmount if busy
 * ```
 */
import { Command } from 'commander';
import type { DeviceManager } from '@podkit/core';
import { existsSync } from '../utils/fs.js';
import { getContext } from '../context.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import { OutputContext } from '../output/index.js';
import { getDeviceLabel } from './open-device.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../handler-deps.js';

/**
 * Error codes emitted by `podkit eject`.
 *
 * Exhaustive — every CliError thrown from this command's runner uses one
 * of these. Consumers branching on `output.code` can rely on this union.
 */
export const EjectErrorCodes = {
  DEVICE_NOT_RESOLVED: 'DEVICE_NOT_RESOLVED',
  CORE_LOAD_FAILED: 'CORE_LOAD_FAILED',
  EJECT_UNSUPPORTED: 'EJECT_UNSUPPORTED',
  DEVICE_PATH_UNRESOLVED: 'DEVICE_PATH_UNRESOLVED',
  DEVICE_PATH_NOT_FOUND: 'DEVICE_PATH_NOT_FOUND',
  EJECT_FAILED: 'EJECT_FAILED',
} as const;
export type EjectErrorCode = (typeof EjectErrorCodes)[keyof typeof EjectErrorCodes];

export interface EjectSuccess {
  success: true;
  device?: string;
  forced?: boolean;
  attempts?: number;
}

export type EjectErrorOutput = CliErrorOutput & { code: EjectErrorCode };
export type EjectOutput = EjectSuccess | EjectErrorOutput;

interface EjectOptions {
  force?: boolean;
}

/**
 * Dependency injection seam for `runEject`. Tests pass stubs to avoid
 * real USB walks and disk operations. Production passes nothing — the
 * defaults are the real implementations.
 */
export interface EjectDeps extends CoreLoaderDeps {
  getDeviceManager?: () => DeviceManager;
}

export const ejectCommand = new Command('eject')
  .alias('unmount')
  .description('safely unmount a device (shortcut for "device eject")')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (options: EjectOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runEject(options, out));
  });

/**
 * `eject` runner — testable in-process.
 *
 * Extracted from the action callback. Tests construct an OutputContext with
 * BufferSinks, call this directly, then assert on captured output. Use `deps`
 * to inject fakes for the device manager and the dynamic `@podkit/core`
 * import.
 */
export async function runEject(
  options: EjectOptions,
  out: OutputContext,
  deps: EjectDeps = {}
): Promise<void> {
  const { config, globalOpts } = getContext();
  const force = options.force ?? false;

  const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
  const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

  if (!deviceResult.success) {
    throw new CliError({
      message: deviceResult.error,
      code: EjectErrorCodes.DEVICE_NOT_RESOLVED,
    });
  }

  const resolvedDevice = deviceResult.device;
  const cliPath = deviceResult.cliPath;

  const core = await loadCoreOrFail(deps, EjectErrorCodes.CORE_LOAD_FAILED);
  const { ejectWithRetry } = core;
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  if (!manager.isSupported) {
    throw new CliError({
      message: `Eject is not supported on ${manager.platform}`,
      code: EjectErrorCodes.EJECT_UNSUPPORTED,
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
    const message = resolveResult.error ?? formatDeviceError(resolveResult);
    throw new CliError({ message, code: EjectErrorCodes.DEVICE_PATH_UNRESOLVED });
  }

  const devicePath = resolveResult.path;
  const deviceLabel = getDeviceLabel(resolvedDevice?.config);

  if (!existsSync(devicePath)) {
    throw new CliError({
      message: `Device path not found: ${devicePath}`,
      code: EjectErrorCodes.DEVICE_PATH_NOT_FOUND,
      details: { device: devicePath },
      printText: (o) => {
        o.error(`${deviceLabel} not found at: ${devicePath}`);
        o.newline();
        o.error(`Make sure the ${deviceLabel.toLowerCase()} is connected and mounted.`);
      },
    });
  }

  let additionalMountPoints: string[] = [];
  try {
    additionalMountPoints = await manager.getSiblingVolumes(devicePath);
  } catch {
    // Best-effort — if discovery fails, just eject the primary volume
  }

  const result = await ejectWithRetry(manager, devicePath, {
    force,
    deviceLabel,
    additionalMountPoints,
    onProgress: (event) => {
      if (!out.isText) return;
      switch (event.phase) {
        case 'sync':
          out.verbose1(event.message);
          break;
        case 'eject':
        case 'waiting':
          out.print(event.message);
          break;
        case 'eject-sibling':
          out.verbose1(event.message);
          break;
      }
    },
  });

  if (result.success) {
    out.result<EjectOutput>(
      { success: true, device: devicePath, forced: result.forced, attempts: result.attempts },
      () => out.success(`${deviceLabel} ejected successfully. Safe to disconnect.`)
    );
  } else {
    throw new CliError({
      message: result.error ?? 'Eject failed',
      code: EjectErrorCodes.EJECT_FAILED,
      details: { device: devicePath, forced: result.forced, attempts: result.attempts },
      printText: (o) => {
        o.error(`Failed to eject ${deviceLabel.toLowerCase()}.`);
        o.newline();
        if (result.error) {
          o.error(result.error);
        }
        if (!force) {
          o.newline();
          o.error('Try: podkit eject --force');
        }
      },
    });
  }
}
