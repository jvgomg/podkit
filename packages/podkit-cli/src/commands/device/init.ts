/**
 * `podkit device init` — initialize iPod database on a device.
 */
import { Command } from 'commander';
import { confirmNo } from '../../utils/confirm.js';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { mergedPresets } from '../../config/preset-registry.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail } from '../../handler-deps.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
} from '../../device-resolver.js';
import { OutputContext } from '../../output/index.js';
import type { ReadinessLevel, ReadinessUnsupportedReason } from '@podkit/core';
import { DOCS_URLS } from '@podkit/core';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg, type DeviceOpDeps } from './shared.js';
import type { DeviceInitOutput } from './output-types.js';

interface InitOptions {
  force?: boolean;
  yes?: boolean;
}

export const initSubcommand = new Command('init')
  .description('initialize iPod database on a device')
  .option('-f, --force', 'overwrite existing database')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (options: InitOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceInit(options, out));
  });

export async function runDeviceInit(
  options: InitOptions,
  out: OutputContext,
  deps: DeviceOpDeps = {}
): Promise<void> {
  const { globalOpts, config } = getContext();
  const autoConfirm = options.yes ?? false;
  const confirmFn = deps.confirm ?? confirmNo;

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }

  const { resolvedDevice, cliPath } = resolved;

  // Gate: this command only works with iPod devices (requires iTunesDB)
  const resolvedType = resolvedDevice?.config?.type;
  if (resolvedType && resolvedType !== 'ipod') {
    throw new CliError({
      message:
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.',
      code: DeviceErrorCodes.IPOD_ONLY,
    });
  }

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const IpodDatabase = deps.ipodDatabase ?? core.IpodDatabase;
  const { checkReadiness } = core;
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
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
    throw new CliError({
      message: resolveResult.error ?? formatDeviceError(resolveResult),
      code: DeviceErrorCodes.DEVICE_PATH_UNRESOLVED,
    });
  }

  const devicePath = resolveResult.path;

  if (!existsSync(devicePath)) {
    throw new CliError({
      message: `Device path not found: ${devicePath}`,
      code: DeviceErrorCodes.DEVICE_PATH_NOT_FOUND,
      printText: (o) => {
        o.error(`iPod not found at: ${devicePath}`);
        o.newline();
        o.error('Make sure the iPod is connected and mounted.');
      },
    });
  }

  // Run readiness check to determine device state. After T5, the readiness
  // pipeline consumes a `DiscoveredDevice`, so we go through
  // `discoverConnectedDevices` to get the iPod arm with its full reconciled
  // USB context (rather than driving readiness off a bare PlatformDeviceInfo).
  let readinessLevel: ReadinessLevel | undefined;
  let readinessUnsupported: ReadinessUnsupportedReason | undefined;
  if (manager.isSupported) {
    try {
      const discovered = await core.discoverConnectedDevices({
        deviceManager: manager,
        massStoragePresets: mergedPresets(config),
      });
      const matchingIpod = discovered.find(
        (d): d is import('@podkit/core').DiscoveredDeviceIpod =>
          d.kind === 'ipod' && d.block?.mountPoint === devicePath
      );
      if (matchingIpod) {
        const readiness = await checkReadiness({ device: matchingIpod });
        readinessLevel = readiness.level;
        readinessUnsupported = readiness.unsupported;
      }
    } catch {
      // Fall through to legacy hasDatabase check if readiness fails
    }
  }

  // Branch on readiness level (when available)
  if (readinessLevel) {
    switch (readinessLevel) {
      case 'ready': {
        if (!options.force) {
          throw new CliError({
            message: 'Device is already initialized. Use --force to reinitialize.',
            code: DeviceErrorCodes.DEVICE_ALREADY_INITIALIZED,
            details: { readinessLevel },
            printText: (o) => {
              o.print('Device is already initialized.');
              o.newline();
              o.print('Use --force to reinitialize (this will delete all tracks and playlists).');
            },
          });
        }
        // --force on ready device: proceed with reinit (handled below)
        break;
      }
      case 'needs-init':
        // Proceed with init (handled below)
        break;
      case 'needs-format': {
        throw new CliError({
          message: 'Device has a partition table but no recognized filesystem.',
          code: DeviceErrorCodes.NEEDS_FORMAT,
          details: { readinessLevel },
          printText: (o) => {
            o.print('This device has a partition table but no recognized filesystem.');
            o.newline();
            o.print('Automatic formatting is not yet supported by podkit.');
            o.print('To format manually:');
            o.print(
              '  macOS: Open Disk Utility \u2192 Select the device \u2192 Erase \u2192 Format: MS-DOS (FAT32)'
            );
            o.print('  Or: Use iTunes/Finder to restore the iPod');
            o.newline();
            o.print('After formatting, run: podkit device init');
          },
        });
      }
      case 'needs-partition': {
        throw new CliError({
          message: 'Device has no partition table. It appears to be completely uninitialized.',
          code: DeviceErrorCodes.NEEDS_PARTITION,
          details: { readinessLevel },
          printText: (o) => {
            o.print(
              'This device has no partition table. It appears to be completely uninitialized.'
            );
            o.newline();
            o.print('Automatic partitioning is not yet supported by podkit.');
            o.print('To set up manually:');
            o.print(
              '  macOS: Open Disk Utility \u2192 Select the device \u2192 Erase \u2192 Scheme: Master Boot Record, Format: MS-DOS (FAT32)'
            );
            o.print('  Or: Use iTunes/Finder to restore the iPod');
            o.newline();
            o.print('After partitioning and formatting, run: podkit device init');
          },
        });
      }
      case 'needs-repair': {
        throw new CliError({
          message:
            'Device database or SysInfo appears corrupt. Run `podkit device reset` to recreate.',
          code: DeviceErrorCodes.NEEDS_REPAIR,
          details: { readinessLevel },
        });
      }
      case 'hardware-error': {
        throw new CliError({
          message:
            'Hardware error detected. Check that the device is properly connected and the cable is working.',
          code: DeviceErrorCodes.HARDWARE_ERROR,
          details: { readinessLevel },
        });
      }
      case 'unsupported': {
        const headline =
          readinessUnsupported?.headline ?? 'This device is not on podkit’s supported-device list.';
        const docsUrl = readinessUnsupported?.docsUrl ?? DOCS_URLS.supportedDevices;
        throw new CliError({
          message: `Device is not supported by podkit. ${headline}`,
          code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
          details: { readinessLevel, unsupported: readinessUnsupported },
          printText: (o) => {
            o.error('Device is not supported by podkit.');
            o.newline();
            o.print(headline);
            if (readinessUnsupported?.details) {
              for (const line of readinessUnsupported.details) {
                o.print(`  ${line}`);
              }
            }
            o.newline();
            o.print(`See: ${docsUrl}`);
          },
        });
      }
      default:
        // Unknown level — fall through to legacy check
        break;
    }
  }

  // Legacy path: readiness not available (unsupported platform) or --force on ready device
  if (!readinessLevel) {
    // Fall back to hasDatabase check
    const hasDb = await IpodDatabase.hasDatabase(devicePath);

    if (hasDb && !options.force) {
      throw new CliError({
        message: 'Database already exists. Use --force to overwrite.',
        code: DeviceErrorCodes.DATABASE_EXISTS,
        printText: (o) => {
          o.error('iPod already has a database. Use --force to reinitialize.');
          o.newline();
          o.error('Warning: This will delete all tracks and playlists!');
        },
      });
    }
  }

  // Confirm reinit when --force is used
  if (options.force && !autoConfirm && out.isText) {
    out.newline();
    out.print('WARNING: This will delete all existing tracks and playlists!');
    out.newline();
    const confirmed = await confirmFn('Reinitialize the iPod database?');
    if (!confirmed) {
      out.print('Cancelled. No changes made.');
      return;
    }
  }

  out.print('Initializing iPod database...');

  try {
    const ipod = await IpodDatabase.initializeIpod(devicePath);
    const modelName = ipod.device.modelName;
    ipod.close();

    out.result<DeviceInitOutput>(
      {
        success: true,
        device: resolvedDevice?.name,
        mountPoint: devicePath,
        modelName,
        readinessLevel: readinessLevel ?? undefined,
      },
      () => {
        out.newline();
        out.print(`iPod database initialized successfully.`);
        out.print(`  Model: ${modelName}`);
        out.print(`  Path:  ${devicePath}`);
        out.newline();
        out.print('You can now use:');
        out.print('  podkit sync    # Sync content to this device');
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message,
      code: DeviceErrorCodes.INIT_FAILED,
      details: {
        device: resolvedDevice?.name,
        mountPoint: devicePath,
        readinessLevel: readinessLevel ?? undefined,
      },
      printText: (o) => o.error(`Failed to initialize iPod database: ${message}`),
    });
  }
}
