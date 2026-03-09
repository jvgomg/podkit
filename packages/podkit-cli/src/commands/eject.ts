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

// Import the device command to access the eject subcommand
// We re-export the subcommand action implementation
import { existsSync } from 'node:fs';
import { getContext } from '../context.js';
import {
  resolveDevicePath,
  formatDeviceError,
  resolveDeviceFromConfig,
  getDeviceIdentity,
  formatDeviceNotFoundError,
} from '../device-resolver.js';

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
    const force = options.force ?? false;

    const outputJson = (data: EjectOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Resolve device from positional argument or default
    const resolvedDevice = name
      ? resolveDeviceFromConfig(config, name)
      : resolveDeviceFromConfig(config);

    if (name && !resolvedDevice) {
      const error = formatDeviceNotFoundError(name, config);
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
      }
      process.exitCode = 1;
      return;
    }

    if (!name && !resolvedDevice) {
      const hasDevices = config.devices && Object.keys(config.devices).length > 0;
      const error = hasDevices
        ? 'No default device set. Specify a device name or set a default with: podkit device default <name>'
        : "No devices configured. Run 'podkit device add <name>' to add one.";
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
      }
      process.exitCode = 1;
      return;
    }

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: `Eject is not supported on ${manager.platform}`,
        });
      } else {
        console.error(`Eject is not supported on ${manager.platform}.`);
        console.error('');
        console.error(manager.getManualInstructions('eject'));
      }
      process.exitCode = 1;
      return;
    }

    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (!globalOpts.quiet && !globalOpts.json && deviceIdentity?.volumeUuid) {
      console.log(`Looking for iPod...`);
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: globalOpts.device,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: resolveResult.error ?? formatDeviceError(resolveResult),
        });
      } else {
        console.error(resolveResult.error ?? formatDeviceError(resolveResult));
      }
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: devicePath,
          error: `Device path not found: ${devicePath}`,
        });
      } else {
        console.error(`iPod not found at: ${devicePath}`);
        console.error('');
        console.error('Make sure the iPod is connected and mounted.');
      }
      process.exitCode = 1;
      return;
    }

    if (!globalOpts.quiet && !globalOpts.json) {
      console.log(`Ejecting iPod at ${devicePath}...`);
    }

    const result = await manager.eject(devicePath, { force });

    if (result.success) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: devicePath,
          forced: result.forced,
        });
      } else if (!globalOpts.quiet) {
        console.log('iPod ejected successfully. Safe to disconnect.');
      }
    } else {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: devicePath,
          forced: result.forced,
          error: result.error,
        });
      } else {
        console.error('Failed to eject iPod.');
        console.error('');
        if (result.error) {
          console.error(result.error);
        }
        if (!force) {
          console.error('');
          console.error('Try: podkit eject --force');
        }
      }
      process.exitCode = 1;
    }
  });
