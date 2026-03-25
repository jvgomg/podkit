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
import { OutputContext } from '../output/index.js';
import { getDeviceLabel } from './open-device.js';

export interface EjectOutput {
  success: boolean;
  device?: string;
  forced?: boolean;
  attempts?: number;
  error?: string;
}

interface EjectOptions {
  force?: boolean;
}

export const ejectCommand = new Command('eject')
  .alias('unmount')
  .description('safely unmount a device (shortcut for "device eject")')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (options: EjectOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const force = options.force ?? false;

    // Resolve device from --device flag or default
    const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

    if (!deviceResult.success) {
      out.result<EjectOutput>({ success: false, error: deviceResult.error }, () =>
        out.error(deviceResult.error)
      );
      process.exitCode = 1;
      return;
    }

    const resolvedDevice = deviceResult.device;
    const cliPath = deviceResult.cliPath;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
    let ejectWithRetry: typeof import('@podkit/core').ejectWithRetry;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
      ejectWithRetry = core.ejectWithRetry;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<EjectOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      out.result<EjectOutput>(
        { success: false, error: `Eject is not supported on ${manager.platform}` },
        () => {
          out.error(`Eject is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('eject'));
        }
      );
      process.exitCode = 1;
      return;
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
      out.result<EjectOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    const deviceLabel = getDeviceLabel(resolvedDevice?.config?.type);

    if (!existsSync(devicePath)) {
      out.result<EjectOutput>(
        { success: false, device: devicePath, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`${deviceLabel} not found at: ${devicePath}`);
          out.newline();
          out.error(`Make sure the ${deviceLabel.toLowerCase()} is connected and mounted.`);
        }
      );
      process.exitCode = 1;
      return;
    }

    const result = await ejectWithRetry(manager, devicePath, {
      force,
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
        }
      },
    });

    if (result.success) {
      out.result<EjectOutput>(
        { success: true, device: devicePath, forced: result.forced, attempts: result.attempts },
        () => out.success(`${deviceLabel} ejected successfully. Safe to disconnect.`)
      );
    } else {
      out.result<EjectOutput>(
        {
          success: false,
          device: devicePath,
          forced: result.forced,
          attempts: result.attempts,
          error: result.error,
        },
        () => {
          out.error(`Failed to eject ${deviceLabel.toLowerCase()}.`);
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
          if (!force) {
            out.newline();
            out.error('Try: podkit eject --force');
          }
        }
      );
      process.exitCode = 1;
    }
  });
