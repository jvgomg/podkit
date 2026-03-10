/**
 * Mount command - root shortcut for `podkit device mount`
 *
 * This is a convenience command that delegates to `podkit device mount`.
 *
 * @example
 * ```bash
 * podkit mount                     # Mount default device
 * podkit mount terapod             # Mount named device
 * podkit mount --disk /dev/disk4s2    # Explicit disk identifier
 * podkit mount --dry-run           # Show mount command without executing
 * ```
 */
import { Command } from 'commander';
import { getContext } from '../context.js';
import {
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';

export interface MountOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  error?: string;
  requiresSudo?: boolean;
}

interface MountOptions {
  disk?: string;
  dryRun?: boolean;
}

export const mountCommand = new Command('mount')
  .description('mount an iPod device (shortcut for "device mount")')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--dry-run', 'show mount command without executing')
  .action(async (name: string | undefined, options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const explicitDisk = options.disk;
    const dryRun = options.dryRun ?? false;

    const outputJson = (data: MountOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Resolve device from positional argument or default
    // Note: explicitDisk (--disk option) bypasses named device resolution
    // Mount's --disk is for disk identifier (e.g., /dev/disk4s2), not mount point
    const cliDeviceArg = parseCliDeviceArg(undefined, config); // Don't use globalOpts.device here
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, name, config);

    // If explicit device identifier provided, we don't need a named device
    if (!deviceResult.success && !explicitDisk) {
      if (globalOpts.json) {
        outputJson({ success: false, error: deviceResult.error });
      } else {
        console.error(deviceResult.error);
      }
      process.exitCode = 1;
      return;
    }

    // Get resolved device (may be undefined if using explicit device identifier)
    const resolvedDevice = deviceResult.success ? deviceResult.device : undefined;

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

    // Check early if privileges are required (before device lookup)
    if (!options.dryRun && manager.requiresPrivileges('mount')) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
        });
      } else {
        console.error('Mount requires elevated privileges.');
        console.error('');
        console.error('Run with sudo:');
        console.error('  sudo podkit mount [options]');
      }
      process.exitCode = 1;
      return;
    }

    if (!manager.isSupported) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: `Mount is not supported on ${manager.platform}`,
        });
      } else {
        console.error(`Mount is not supported on ${manager.platform}.`);
        console.error('');
        console.error(manager.getManualInstructions('mount'));
      }
      process.exitCode = 1;
      return;
    }

    let deviceId: string | undefined;
    let volumeName: string | undefined;

    if (explicitDisk) {
      deviceId = explicitDisk;
    } else {
      const volumeUuid = resolvedDevice?.config.volumeUuid;

      if (volumeUuid) {
        if (!globalOpts.quiet && !globalOpts.json) {
          const deviceIdentity = getDeviceIdentity(resolvedDevice);
          console.log(
            formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, globalOpts.verbose > 0)
          );
        }

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          if (globalOpts.json) {
            outputJson({
              success: false,
              error: `iPod not found with UUID: ${volumeUuid}`,
            });
          } else {
            console.error(`iPod not found with UUID: ${volumeUuid}`);
            console.error('');
            console.error('Make sure the iPod is connected.');
            console.error('');
            console.error('You can specify a device explicitly:');
            console.error('  podkit mount --disk /dev/disk4s2');
          }
          process.exitCode = 1;
          return;
        }

        if (device.isMounted && device.mountPoint) {
          if (globalOpts.json) {
            outputJson({
              success: true,
              device: device.identifier,
              mountPoint: device.mountPoint,
            });
          } else if (!globalOpts.quiet) {
            console.log(`iPod already mounted at: ${device.mountPoint}`);
          }
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        if (globalOpts.json) {
          outputJson({
            success: false,
            error: 'No device specified and no iPod registered in config',
          });
        } else {
          console.error('No device specified and no iPod registered in config.');
          console.error('');
          console.error('Either specify a device:');
          console.error('  podkit mount --disk /dev/disk4s2');
          console.error('');
          console.error('Or register an iPod first:');
          console.error('  podkit device add <name>');
        }
        process.exitCode = 1;
        return;
      }
    }

    if (!globalOpts.quiet && !globalOpts.json && !dryRun) {
      const displayName = volumeName || deviceId;
      console.log(`Mounting iPod: ${displayName}...`);
    }

    const result = await manager.mount(deviceId, {
      target: volumeName ? `/tmp/podkit-${volumeName}` : undefined,
      dryRun,
    });

    if (dryRun) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
          dryRunCommand: result.dryRunCommand,
        });
      } else {
        console.log('Dry run - command that would be executed:');
        console.log(`  ${result.dryRunCommand}`);
        if (result.mountPoint) {
          console.log(`  Mount point: ${result.mountPoint}`);
        }
      }
      return;
    }

    if (result.requiresSudo) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: deviceId,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
          dryRunCommand: result.dryRunCommand,
        });
      } else {
        console.error('Mount requires elevated privileges.');
        console.error('');
        console.error('Run:');
        console.error(`  ${result.dryRunCommand}`);
      }
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
        });
      } else if (!globalOpts.quiet) {
        console.log(`iPod mounted at: ${result.mountPoint}`);
        console.log('');
        console.log('You can now use:');
        console.log(`  podkit device info`);
        console.log(`  podkit sync`);
      }
    } else {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: deviceId,
          error: result.error,
        });
      } else {
        console.error('Failed to mount iPod.');
        console.error('');
        if (result.error) {
          console.error(result.error);
        }
      }
      process.exitCode = 1;
    }
  });
