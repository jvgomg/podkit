/**
 * `podkit device remove` — remove a device from the configured devices list.
 */
import { Command } from 'commander';
import { confirmNo } from '../../utils/confirm.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { removeDevice, setDefaultDevice, DEFAULT_CONFIG_PATH } from '../../config/index.js';
import { OutputContext } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceName } from './shared.js';
import type { DeviceRemoveOutput } from './output-types.js';

export const removeSubcommand = new Command('remove')
  .description('remove a device from config')
  .argument('[name]', 'device name (alternative to passing -d <name> at the program level)')
  .option('--confirm', 'skip confirmation prompt')
  .action(async (positionalName: string | undefined, options: { confirm?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    await runAction(out, async () => {
      const name = resolveDeviceName(positionalName, globalOpts.device, 'remove');

      const devices = config.devices || {};
      const defaultDevice = config.defaults?.device;

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

      const wasDefault = name === defaultDevice;

      if (!options.confirm && out.isText) {
        out.print(`This will remove device "${name}" from the config.`);
        if (wasDefault) {
          out.print('This device is currently set as the default.');
        }
        out.newline();

        const confirmed = await confirmNo(`Remove device "${name}"?`);
        if (!confirmed) {
          out.print('Cancelled. No changes made.');
          return;
        }
      }

      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const result = removeDevice(name, { configPath });

      if (!result.success) {
        const errMsg = result.error ?? 'Failed to remove device';
        throw new CliError({
          message: errMsg,
          code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
          printText: (o) => o.error(`Failed to remove device: ${errMsg}`),
        });
      }

      if (wasDefault) {
        setDefaultDevice('', { configPath });
      }

      out.result<DeviceRemoveOutput>({ success: true, device: name, wasDefault }, () => {
        out.print(`Device "${name}" removed from config.`);
        if (wasDefault) {
          out.print('Cleared default device setting.');
        }
      });
    });
  });
