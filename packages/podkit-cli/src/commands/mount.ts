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
import { OutputContext } from '../output/index.js';

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
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const explicitDisk = options.disk;
    const dryRun = options.dryRun ?? false;

    // Resolve device from positional argument or default
    // Note: explicitDisk (--disk option) bypasses named device resolution
    // Mount's --disk is for disk identifier (e.g., /dev/disk4s2), not mount point
    const cliDeviceArg = parseCliDeviceArg(undefined, config); // Don't use globalOpts.device here
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, name, config);

    // If explicit device identifier provided, we don't need a named device
    if (!deviceResult.success && !explicitDisk) {
      out.result<MountOutput>(
        { success: false, error: deviceResult.error },
        () => out.error(deviceResult.error)
      );
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
      out.result<MountOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    // Check early if privileges are required (before device lookup)
    if (!dryRun && manager.requiresPrivileges('mount')) {
      out.result<MountOutput>(
        { success: false, error: 'Mount requires elevated privileges', requiresSudo: true },
        () => {
          out.error('Mount requires elevated privileges.');
          out.newline();
          out.error('Run with sudo:');
          out.error('  sudo podkit mount [options]');
        }
      );
      process.exitCode = 1;
      return;
    }

    if (!manager.isSupported) {
      out.result<MountOutput>(
        { success: false, error: `Mount is not supported on ${manager.platform}` },
        () => {
          out.error(`Mount is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('mount'));
        }
      );
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
        const deviceIdentity = getDeviceIdentity(resolvedDevice);
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          out.result<MountOutput>(
            { success: false, error: `iPod not found with UUID: ${volumeUuid}` },
            () => {
              out.error(`iPod not found with UUID: ${volumeUuid}`);
              out.newline();
              out.error('Make sure the iPod is connected.');
              out.newline();
              out.error('You can specify a device explicitly:');
              out.error('  podkit mount --disk /dev/disk4s2');
            }
          );
          process.exitCode = 1;
          return;
        }

        if (device.isMounted && device.mountPoint) {
          out.result<MountOutput>(
            { success: true, device: device.identifier, mountPoint: device.mountPoint },
            () => out.print(`iPod already mounted at: ${device.mountPoint}`)
          );
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        out.result<MountOutput>(
          { success: false, error: 'No device specified and no iPod registered in config' },
          () => {
            out.error('No device specified and no iPod registered in config.');
            out.newline();
            out.error('Either specify a device:');
            out.error('  podkit mount --disk /dev/disk4s2');
            out.newline();
            out.error('Or register an iPod first:');
            out.error('  podkit device add <name>');
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    if (!dryRun) {
      const displayName = volumeName || deviceId;
      out.print(`Mounting iPod: ${displayName}...`);
    }

    const result = await manager.mount(deviceId, {
      target: volumeName ? `/tmp/podkit-${volumeName}` : undefined,
      dryRun,
    });

    if (dryRun) {
      out.result<MountOutput>(
        { success: true, device: deviceId, mountPoint: result.mountPoint, dryRunCommand: result.dryRunCommand },
        () => {
          out.print('Dry run - command that would be executed:');
          out.print(`  ${result.dryRunCommand}`);
          if (result.mountPoint) {
            out.print(`  Mount point: ${result.mountPoint}`);
          }
        }
      );
      return;
    }

    if (result.requiresSudo) {
      out.result<MountOutput>(
        { success: false, device: deviceId, error: 'Mount requires elevated privileges', requiresSudo: true, dryRunCommand: result.dryRunCommand },
        () => {
          out.error('Mount requires elevated privileges.');
          out.newline();
          out.error('Run:');
          out.error(`  ${result.dryRunCommand}`);
        }
      );
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      out.result<MountOutput>(
        { success: true, device: deviceId, mountPoint: result.mountPoint },
        () => {
          out.print(`iPod mounted at: ${result.mountPoint}`);
          out.newline();
          out.print('You can now use:');
          out.print('  podkit device info');
          out.print('  podkit sync');
        }
      );
    } else {
      out.result<MountOutput>(
        { success: false, device: deviceId, error: result.error },
        () => {
          out.error('Failed to mount iPod.');
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
        }
      );
      process.exitCode = 1;
    }
  });
