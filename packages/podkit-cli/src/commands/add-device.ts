/**
 * Add-device command - DEPRECATED
 *
 * This command is deprecated in favor of `podkit device add <name>`.
 * It is kept for backwards compatibility and will print a deprecation warning.
 *
 * @deprecated Use `podkit device add <name>` instead
 *
 * @example
 * ```bash
 * # Old (deprecated):
 * podkit add-device
 *
 * # New:
 * podkit device add myipod
 * ```
 */
import { Command } from 'commander';
import { getContext } from '../context.js';

/**
 * Output structure for JSON format
 */
export interface AddDeviceOutput {
  success: boolean;
  deprecated: true;
  message: string;
  device?: {
    identifier: string;
    volumeName: string;
    volumeUuid: string;
    size: number;
    isMounted: boolean;
    mountPoint?: string;
  };
  saved?: boolean;
  configPath?: string;
  error?: string;
}

export const addDeviceCommand = new Command('add-device')
  .description('(deprecated) use "podkit device add <name>" instead')
  .argument('[name]', 'device name (required for new usage)')
  .action(async (_name?: string) => {
    const { globalOpts } = getContext();

    const deprecationMessage =
      'DEPRECATED: "podkit add-device" is deprecated. Use "podkit device add <name>" instead.';

    if (globalOpts.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            deprecated: true,
            message: deprecationMessage,
            error: 'Please use "podkit device add <name>" to add a device.',
          },
          null,
          2
        )
      );
    } else {
      console.error(deprecationMessage);
      console.error('');
      console.error('Example:');
      console.error('  podkit device add myipod     # Add a device named "myipod"');
      console.error('  podkit device list           # List configured devices');
      console.error('  podkit device show myipod    # Show device details');
    }

    process.exitCode = 1;
  });
