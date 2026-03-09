/**
 * Mount command - mount an iPod device
 *
 * This command mounts an iPod device, either by explicit device identifier
 * or by auto-detecting using the stored Volume UUID from config.
 *
 * @example
 * ```bash
 * podkit mount                        # Auto-detect using stored Volume UUID
 * podkit mount -d terapod             # Use named device from config
 * podkit mount --device /dev/disk4s2  # Explicit device identifier
 * podkit mount --dry-run              # Show command without executing
 * ```
 */
import { Command } from 'commander';
import { getContext } from '../context.js';
import {
  resolveDeviceFromConfig,
  formatDeviceNotFoundError,
} from '../device-resolver.js';

/**
 * Output structure for JSON format
 */
export interface MountOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  error?: string;
  requiresSudo?: boolean;
}

interface MountOptions {
  device?: string;
  dryRun?: boolean;
  deviceName?: string;
}

export const mountCommand = new Command('mount')
  .description('mount an iPod device')
  .option('-d, --device-name <name>', 'device name from config')
  .option('--device <identifier>', 'device identifier (e.g., /dev/disk4s2)')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const explicitDevice = options.device;
    const dryRun = options.dryRun ?? false;

    const outputJson = (data: MountOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Dynamically import to handle platform-specific errors
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load podkit-core';
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

    // Check platform support
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

    // Resolve named device (if -d flag used)
    const resolvedDevice = options.deviceName
      ? resolveDeviceFromConfig(config, options.deviceName)
      : resolveDeviceFromConfig(config); // Try default device

    // Check if named device was requested but not found
    if (options.deviceName && !resolvedDevice) {
      const errorMsg = formatDeviceNotFoundError(options.deviceName, config);
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: errorMsg,
        });
      } else {
        console.error(errorMsg);
      }
      process.exitCode = 1;
      return;
    }

    // Determine device identifier
    let deviceId: string | undefined;
    let volumeName: string | undefined;

    if (explicitDevice) {
      // Use explicit device from CLI
      deviceId = explicitDevice;
    } else {
      // Get volumeUuid from named device
      const volumeUuid = resolvedDevice?.config.volumeUuid;

      if (volumeUuid) {
        // Auto-detect using stored Volume UUID
        if (!globalOpts.quiet && !globalOpts.json) {
          console.log(`Looking for iPod with UUID: ${volumeUuid}...`);
        }

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          if (globalOpts.json) {
            outputJson({
              success: false,
              error: `iPod not found with UUID: ${volumeUuid}`,
            });
          } else {
            console.error(
              `iPod not found with UUID: ${volumeUuid}`
            );
            console.error('');
            console.error('Make sure the iPod is connected.');
            console.error('');
            console.error('You can specify a device explicitly:');
            console.error('  podkit mount --device /dev/disk4s2');
          }
          process.exitCode = 1;
          return;
        }

        // Check if already mounted
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
        // No device specified and no UUID in config
        if (globalOpts.json) {
          outputJson({
            success: false,
            error: 'No device specified and no iPod registered in config',
          });
        } else {
          console.error('No device specified and no iPod registered in config.');
          console.error('');
          console.error('Either specify a device:');
          console.error('  podkit mount --device /dev/disk4s2');
          console.error('');
          console.error('Or register an iPod first:');
          console.error('  podkit add-device');
        }
        process.exitCode = 1;
        return;
      }
    }

    // Show progress message
    if (!globalOpts.quiet && !globalOpts.json && !dryRun) {
      const displayName = volumeName || deviceId;
      console.log(`Mounting iPod: ${displayName}...`);
    }

    // Perform mount
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
        console.log(`  podkit status --device ${result.mountPoint}`);
        console.log(`  podkit sync --device ${result.mountPoint}`);
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
