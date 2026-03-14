#!/usr/bin/env node
/**
 * podkit CLI
 *
 * Command-line interface for syncing music to iPods.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { deviceCommand } from './commands/device.js';
import { collectionCommand } from './commands/collection.js';
import { ejectCommand } from './commands/eject.js';
import { mountCommand } from './commands/mount.js';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config/index.js';
import type { GlobalOptions } from './config/index.js';
import { setContext } from './context.js';

declare const PODKIT_VERSION: string | undefined;

const version =
  typeof PODKIT_VERSION !== 'undefined'
    ? PODKIT_VERSION
    : (await import('../package.json', { with: { type: 'json' } })).default.version;

const program = new Command();

program
  .name('podkit')
  .description('Modern sync for classic iPods')
  .version(version)
  .option('-v, --verbose', 'increase verbosity (stackable: -v, -vv, -vvv)', increaseVerbosity, 0)
  .option('-q, --quiet', 'suppress non-essential output')
  .option('--json', 'output in JSON format')
  .option('--no-color', 'disable colored output')
  .option('--device <name|path>', 'device name or path (auto-detect if omitted)')
  .option('--config <path>', `config file path (default: ${DEFAULT_CONFIG_PATH})`);

function increaseVerbosity(_value: string, previous: number): number {
  return previous + 1;
}

/**
 * Hook to load config before any command runs
 *
 * This sets up the CLI context with merged configuration from:
 * 1. Defaults
 * 2. Config file (~/.config/podkit/config.toml or --config path)
 * 3. Environment variables (PODKIT_*)
 * 4. CLI arguments
 */
program.hook('preAction', (thisCommand, actionCommand) => {
  const globalOpts = thisCommand.opts() as GlobalOptions;

  // Get command-specific options that affect config
  const commandOpts = actionCommand.opts() as {
    quality?: string;
    artwork?: boolean;
  };

  // Load and merge config from all sources
  const configResult = loadConfig(globalOpts, commandOpts);

  // Set up context for commands to access
  setContext({
    config: configResult.config,
    globalOpts,
    configResult,
  });
});

// Register commands
// Core workflow commands
program.addCommand(initCommand);
program.addCommand(syncCommand);

// Entity management commands
program.addCommand(deviceCommand);
program.addCommand(collectionCommand);

// Root shortcuts (delegate to device subcommands)
program.addCommand(ejectCommand);
program.addCommand(mountCommand);

program.parse();
