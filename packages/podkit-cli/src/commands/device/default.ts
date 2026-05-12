/**
 * `podkit device default` — set or clear the default device.
 */
import { Command } from 'commander';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { setDefaultDevice, DEFAULT_CONFIG_PATH } from '../../config/index.js';
import { OutputContext } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import type { DeviceDefaultOutput } from './output-types.js';

export const defaultSubcommand = new Command('default')
  .description('set or clear the default device')
  .option('--clear', 'clear the default device')
  .action(async (options: { clear?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const name = globalOpts.device;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    await runAction(out, async () => {
      if (options.clear) {
        // Clear the default
        const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
        const result = setDefaultDevice('', { configPath });

        if (!result.success) {
          const errMsg = result.error ?? 'Failed to clear default device';
          throw new CliError({
            message: errMsg,
            code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
            printText: (o) => o.error(`Failed to clear default device: ${errMsg}`),
          });
        }

        out.result<DeviceDefaultOutput>({ success: true, cleared: true }, () =>
          out.print('Cleared default device.')
        );
        return;
      }

      if (!name) {
        // Show current default
        const defaultDevice = config.defaults?.device;
        out.result<DeviceDefaultOutput>({ success: true, device: defaultDevice }, () => {
          if (defaultDevice) {
            out.print(`Default device: ${defaultDevice}`);
          } else {
            out.print('No default device set.');
          }
        });
        return;
      }

      // Set default
      const devices = config.devices || {};
      if (!(name in devices)) {
        const error = `Device "${name}" not found in config.`;
        throw new CliError({
          message: error,
          code: DeviceErrorCodes.DEVICE_NOT_FOUND,
          printText: (o) => {
            o.error(error);
            const available = Object.keys(devices);
            if (available.length > 0) {
              o.error(`Available devices: ${available.join(', ')}`);
            }
          },
        });
      }

      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const result = setDefaultDevice(name, { configPath });

      if (!result.success) {
        const errMsg = result.error ?? 'Failed to set default device';
        throw new CliError({
          message: errMsg,
          code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
          printText: (o) => o.error(`Failed to set default device: ${errMsg}`),
        });
      }

      out.result<DeviceDefaultOutput>({ success: true, device: name }, () =>
        out.print(`Set "${name}" as the default device.`)
      );
    });
  });
