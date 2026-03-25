/**
 * Mount command - root shortcut for `podkit device mount`
 *
 * This is a convenience command that delegates to `podkit device mount`.
 *
 * @example
 * ```bash
 * podkit mount                     # Mount default device
 * podkit mount -d terapod          # Mount named device
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
import { OutputContext, bold } from '../output/index.js';
import { getDeviceLabel } from './open-device.js';
import type { DeviceAssessment } from '@podkit/core';

export interface MountOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  error?: string;
  requiresSudo?: boolean;
  assessment?: DeviceAssessment;
}

interface MountOptions {
  disk?: string;
  target?: string;
  dryRun?: boolean;
}

export const mountCommand = new Command('mount')
  .description('mount a device (shortcut for "device mount")')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--target <path>', 'mount point path (default: /tmp/podkit-{volumeName})')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const explicitDisk = options.disk;
    const dryRun = options.dryRun ?? false;

    // Resolve device from --device flag or default
    // Note: explicitDisk (--disk option) bypasses named device resolution
    // Mount's --disk is for disk identifier (e.g., /dev/disk4s2), not mount point
    const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

    // If explicit device identifier provided, we don't need a named device
    if (!deviceResult.success && !explicitDisk) {
      out.result<MountOutput>({ success: false, error: deviceResult.error }, () =>
        out.error(deviceResult.error)
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
          const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
          out.result<MountOutput>(
            { success: false, error: `${devLabel} not found with UUID: ${volumeUuid}` },
            () => {
              out.error(`${devLabel} not found with UUID: ${volumeUuid}`);
              out.newline();
              out.error(`Make sure the ${devLabel.toLowerCase()} is connected.`);
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
            () => out.print(`Device already mounted at: ${device.mountPoint}`)
          );
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        out.result<MountOutput>(
          { success: false, error: 'No device specified and no device registered in config' },
          () => {
            out.error('No device specified and no device registered in config.');
            out.newline();
            out.error('Either specify a device:');
            out.error('  podkit mount --disk /dev/disk4s2');
            out.newline();
            out.error('Or register a device first:');
            out.error('  podkit device add -d <name>');
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    if (!dryRun) {
      const displayName = volumeName || deviceId;
      const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
      out.print(`Mounting ${devLabel}: ${displayName}...`);
    }

    const mountTarget = options.target ?? (volumeName ? `/tmp/podkit-${volumeName}` : undefined);

    const result = await manager.mount(deviceId, {
      target: mountTarget,
      dryRun,
    });

    if (dryRun) {
      out.result<MountOutput>(
        {
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
          dryRunCommand: result.dryRunCommand,
        },
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
      const assessment = result.assessment;
      out.result<MountOutput>(
        {
          success: false,
          device: deviceId,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
          dryRunCommand: result.dryRunCommand,
          assessment,
        },
        () => {
          const displayName = assessment?.volumeName ?? deviceId;
          const diskId = assessment?.diskIdentifier ?? deviceId;
          out.error(`Mount failed for ${displayName} (${diskId})`);
          out.newline();

          if (assessment?.iFlash.confirmed) {
            out.error('iFlash storage detected:');
            for (const evidence of assessment.iFlash.evidence) {
              out.error(`  • ${evidence.signal}: ${evidence.value}`);
              out.error(`    ${evidence.detail}`);
            }
            out.newline();
            out.error('macOS refuses to automatically mount large FAT32 volumes created by');
            out.error('iFlash adapters. Elevated privileges are required to bypass this.');
          } else {
            out.error('This device requires elevated privileges to mount.');
          }

          out.newline();
          out.error('Run:');
          out.error(`  ${bold('sudo')} podkit mount`);

          out.printTips({ mountRequiresSudo: true });
        }
      );
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      out.result<MountOutput>(
        { success: true, device: deviceId, mountPoint: result.mountPoint },
        () => {
          const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
          out.print(`${devLabel} mounted at: ${result.mountPoint}`);
          out.newline();
          out.print('You can now use:');
          out.print('  podkit device info');
          out.print('  podkit sync');
        }
      );
    } else {
      out.result<MountOutput>({ success: false, device: deviceId, error: result.error }, () => {
        out.error(`Failed to mount ${getDeviceLabel(resolvedDevice?.config?.type).toLowerCase()}.`);
        out.newline();
        if (result.error) {
          out.error(result.error);
        }
      });
      process.exitCode = 1;
    }
  });
