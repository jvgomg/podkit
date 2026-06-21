/**
 * `podkit device mount` — mount a device.
 */
import { Command } from 'commander';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../../handler-deps.js';
import { getDeviceIdentity, formatDeviceLookupMessage } from '../../device-resolver.js';
import { OutputContext, bold } from '../../output/index.js';
import { getDeviceLabel } from '../open-device.js';
import { mergedPresets } from '../../config/preset-registry.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg } from './shared.js';
import type { DeviceMountOutput } from './output-types.js';

interface MountOptions {
  disk?: string;
  target?: string;
  dryRun?: boolean;
}

/**
 * Dependency injection seam for `runDeviceMount` (the `podkit device mount`
 * subcommand). Mirrors the root `podkit mount` runner's seam, kept separate
 * for the same reason as eject above.
 */
export interface DeviceMountDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
}

export const mountSubcommand = new Command('mount')
  .description('mount a device')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--target <path>', 'mount point path (default: /tmp/podkit-{volumeName})')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    await runAction(out, () => runDeviceMount(options, out));
  });

export async function runDeviceMount(
  options: MountOptions,
  out: OutputContext,
  deps: DeviceMountDeps = {}
): Promise<void> {
  const { config } = getContext();
  const explicitDisk = options.disk;
  const dryRun = options.dryRun ?? false;

  const resolved = resolveDeviceArg();
  if ('error' in resolved && !explicitDisk) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const resolvedDevice = 'resolvedDevice' in resolved ? resolved.resolvedDevice : undefined;

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  if (!manager.isSupported) {
    throw new CliError({
      message: `Mount is not supported on ${manager.platform}`,
      code: DeviceErrorCodes.MOUNT_UNSUPPORTED,
      printText: (o) => {
        o.error(`Mount is not supported on ${manager.platform}.`);
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
        const devLabel = getDeviceLabel(resolvedDevice?.config, mergedPresets(config));
        throw new CliError({
          message: `${devLabel} not found with UUID: ${volumeUuid}`,
          code: DeviceErrorCodes.DEVICE_NOT_FOUND,
          printText: (o) => {
            o.error(`${devLabel} not found with UUID: ${volumeUuid}`);
            o.newline();
            o.error(`Make sure the ${devLabel.toLowerCase()} is connected.`);
            o.newline();
            o.error('You can specify a device explicitly:');
            o.error('  podkit device mount --disk /dev/disk4s2');
          },
        });
      }

      // Type narrowing on `isMounted` makes `mountPoint` non-nullable.
      if (device.isMounted) {
        out.result<DeviceMountOutput>(
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
        code: DeviceErrorCodes.NO_DEVICE,
        printText: (o) => {
          o.error('No device specified and no device registered in config.');
          o.newline();
          o.error('Either specify a device:');
          o.error('  podkit device mount --disk /dev/disk4s2');
          o.newline();
          o.error('Or register a device first:');
          o.error('  podkit device add -d <name>');
        },
      });
    }
  }

  if (!dryRun) {
    const displayName = volumeName || deviceId;
    const devLabel = getDeviceLabel(resolvedDevice?.config, mergedPresets(config));
    out.print(`Mounting ${devLabel}: ${displayName}...`);
  }

  const mountTarget = options.target ?? (volumeName ? `/tmp/podkit-${volumeName}` : undefined);

  const result = await manager.mount(deviceId, {
    target: mountTarget,
    dryRun,
  });

  if (dryRun) {
    out.result<DeviceMountOutput>(
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
      code: DeviceErrorCodes.MOUNT_REQUIRES_SUDO,
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
        o.error(`  ${bold('sudo')} podkit device mount`);

        o.printTips({ mountRequiresSudo: true });
      },
    });
  }

  if (result.success) {
    out.result<DeviceMountOutput>(
      { success: true, device: deviceId, mountPoint: result.mountPoint },
      () => {
        const devLabel = getDeviceLabel(resolvedDevice?.config, mergedPresets(config));
        out.print(`${devLabel} mounted at: ${result.mountPoint}`);
        out.newline();
        out.print('You can now use:');
        out.print(`  podkit device info`);
        out.print(`  podkit sync`);
      }
    );
  } else {
    throw new CliError({
      message: result.error ?? 'Mount failed',
      code: DeviceErrorCodes.MOUNT_FAILED,
      details: { device: deviceId },
      printText: (o) => {
        o.error(
          `Failed to mount ${getDeviceLabel(resolvedDevice?.config, mergedPresets(config)).toLowerCase()}.`
        );
        o.newline();
        if (result.error) {
          o.error(result.error);
        }
      },
    });
  }
}
