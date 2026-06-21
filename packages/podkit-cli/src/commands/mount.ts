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
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import { OutputContext, bold } from '../output/index.js';
import { displayForConfig } from './open-device.js';
import { mergedPresets } from '../config/preset-registry.js';
import type { DeviceAssessment, DeviceManager } from '@podkit/core';
import { loadCoreOrFail, type CoreLoaderDeps } from '../handler-deps.js';

/**
 * Error codes emitted by `podkit mount`.
 *
 * Exhaustive — every CliError thrown from this command's runner uses one
 * of these. Consumers branching on `output.code` can rely on this union.
 */
export const MountErrorCodes = {
  DEVICE_NOT_RESOLVED: 'DEVICE_NOT_RESOLVED',
  CORE_LOAD_FAILED: 'CORE_LOAD_FAILED',
  MOUNT_UNSUPPORTED: 'MOUNT_UNSUPPORTED',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  NO_DEVICE: 'NO_DEVICE',
  MOUNT_REQUIRES_SUDO: 'MOUNT_REQUIRES_SUDO',
  MOUNT_FAILED: 'MOUNT_FAILED',
} as const;
export type MountErrorCode = (typeof MountErrorCodes)[keyof typeof MountErrorCodes];

export interface MountSuccess {
  success: true;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  requiresSudo?: boolean;
  assessment?: DeviceAssessment;
}

export type MountErrorOutput = CliErrorOutput & { code: MountErrorCode };
export type MountOutput = MountSuccess | MountErrorOutput;

interface MountOptions {
  disk?: string;
  target?: string;
  dryRun?: boolean;
}

/**
 * Dependency injection seam for `runMount`. Tests pass stubs to avoid
 * real USB walks and disk operations. Production passes nothing — the
 * defaults are the real implementations.
 */
export interface MountDeps extends CoreLoaderDeps {
  getDeviceManager?: () => DeviceManager;
}

export const mountCommand = new Command('mount')
  .description('mount a device (shortcut for "device mount")')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--target <path>', 'mount point path (default: /tmp/podkit-{volumeName})')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    await runAction(out, () => runMount(options, out));
  });

export async function runMount(
  options: MountOptions,
  out: OutputContext,
  deps: MountDeps = {}
): Promise<void> {
  const { config, globalOpts } = getContext();
  const explicitDisk = options.disk;
  const dryRun = options.dryRun ?? false;

  const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
  const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

  if (!deviceResult.success && !explicitDisk) {
    throw new CliError({
      message: deviceResult.error,
      code: MountErrorCodes.DEVICE_NOT_RESOLVED,
    });
  }

  const resolvedDevice = deviceResult.success ? deviceResult.device : undefined;

  const core = await loadCoreOrFail(deps, MountErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  if (!manager.isSupported) {
    const message = `Mount is not supported on ${manager.platform}`;
    throw new CliError({
      message,
      code: MountErrorCodes.MOUNT_UNSUPPORTED,
      printText: (o) => {
        o.error(`${message}.`);
        o.newline();
        o.error(manager.getManualInstructions('mount'));
      },
    });
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

      const device = await manager.locate({ volumeUuid });

      if (!device) {
        const devLabel = displayForConfig(resolvedDevice?.config, mergedPresets(config)).short;
        const message = `${devLabel} not found with UUID: ${volumeUuid}`;
        throw new CliError({
          message,
          code: MountErrorCodes.DEVICE_NOT_FOUND,
          printText: (o) => {
            o.error(message);
            o.newline();
            o.error(`Make sure the ${devLabel.toLowerCase()} is connected.`);
            o.newline();
            o.error('You can specify a device explicitly:');
            o.error('  podkit mount --disk /dev/disk4s2');
          },
        });
      }

      // Type narrowing on `isMounted` makes `mountPoint` non-nullable.
      if (device.isMounted) {
        out.result<MountOutput>(
          { success: true, device: device.identifier, mountPoint: device.mountPoint },
          () => out.print(`Device already mounted at: ${device.mountPoint}`)
        );
        return;
      }

      deviceId = device.identifier;
      volumeName = device.volumeName;
    } else {
      throw new CliError({
        message: 'No device specified and no device registered in config',
        code: MountErrorCodes.NO_DEVICE,
        printText: (o) => {
          o.error('No device specified and no device registered in config.');
          o.newline();
          o.error('Either specify a device:');
          o.error('  podkit mount --disk /dev/disk4s2');
          o.newline();
          o.error('Or register a device first:');
          o.error('  podkit device add -d <name>');
        },
      });
    }
  }

  if (!dryRun) {
    const displayName = volumeName || deviceId;
    const devLabel = displayForConfig(resolvedDevice?.config, mergedPresets(config)).short;
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
    throw new CliError({
      message: 'Mount requires elevated privileges',
      code: MountErrorCodes.MOUNT_REQUIRES_SUDO,
      details: {
        device: deviceId,
        requiresSudo: true,
        dryRunCommand: result.dryRunCommand,
        assessment,
      },
      printText: (o) => {
        const displayName = assessment?.volumeName ?? deviceId;
        const diskId = assessment?.diskIdentifier ?? deviceId;
        o.error(`Mount failed for ${displayName} (${diskId})`);
        o.newline();

        if (assessment?.iFlash.confirmed) {
          o.error('iFlash storage detected:');
          for (const evidence of assessment.iFlash.evidence) {
            o.error(`  • ${evidence.signal}: ${evidence.value}`);
            o.error(`    ${evidence.detail}`);
          }
          o.newline();
          o.error('macOS refuses to automatically mount large FAT32 volumes created by');
          o.error('iFlash adapters. Elevated privileges are required to bypass this.');
        } else {
          o.error('This device requires elevated privileges to mount.');
        }

        o.newline();
        o.error('Run:');
        o.error(`  ${bold('sudo')} podkit mount`);

        o.printTips({ mountRequiresSudo: true });
      },
    });
  }

  if (result.success) {
    out.result<MountOutput>(
      { success: true, device: deviceId, mountPoint: result.mountPoint },
      () => {
        const devLabel = displayForConfig(resolvedDevice?.config, mergedPresets(config)).short;
        out.print(`${devLabel} mounted at: ${result.mountPoint}`);
        out.newline();
        out.print('You can now use:');
        out.print('  podkit device info');
        out.print('  podkit sync');
      }
    );
  } else {
    const message = result.error ?? 'Mount failed';
    throw new CliError({
      message,
      code: MountErrorCodes.MOUNT_FAILED,
      details: { device: deviceId },
      printText: (o) => {
        o.error(
          `Failed to mount ${displayForConfig(resolvedDevice?.config, mergedPresets(config)).short.toLowerCase()}.`
        );
        o.newline();
        if (result.error) {
          o.error(result.error);
        }
      },
    });
  }
}
