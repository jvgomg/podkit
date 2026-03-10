/**
 * Eject command - root shortcut for `podkit device eject`
 *
 * This is a convenience command that delegates to `podkit device eject`.
 *
 * @example
 * ```bash
 * podkit eject                    # Eject default device
 * podkit eject terapod            # Eject named device
 * podkit eject --force            # Force unmount if busy
 * ```
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
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

export interface EjectOutput {
  success: boolean;
  device?: string;
  forced?: boolean;
  error?: string;
}

interface EjectOptions {
  force?: boolean;
}

export const ejectCommand = new Command('eject')
  .description('safely unmount an iPod device (shortcut for "device eject")')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (name: string | undefined, options: EjectOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const force = options.force ?? false;

    // Resolve device from --device flag, positional argument, or default
    const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, name, config);

    if (!deviceResult.success) {
      out.result<EjectOutput>(
        { success: false, error: deviceResult.error },
        () => out.error(deviceResult.error)
      );
      process.exitCode = 1;
      return;
    }

    const resolvedDevice = deviceResult.device;
    const cliPath = deviceResult.cliPath;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
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

    if (!existsSync(devicePath)) {
      out.result<EjectOutput>(
        { success: false, device: devicePath, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    out.print(`Ejecting iPod at ${devicePath}...`);

    const result = await manager.eject(devicePath, { force });

    if (result.success) {
      out.result<EjectOutput>(
        { success: true, device: devicePath, forced: result.forced },
        () => out.success('iPod ejected successfully. Safe to disconnect.')
      );
    } else {
      out.result<EjectOutput>(
        { success: false, device: devicePath, forced: result.forced, error: result.error },
        () => {
          out.error('Failed to eject iPod.');
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
