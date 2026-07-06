/**
 * podkit CLI
 *
 * Command-line interface for syncing music to iPods. Distributed only as a
 * Bun `--compile` binary (see ADR-021) — there is no npm channel, so the
 * `#!/usr/bin/env node` shebang is intentionally absent.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { deviceCommand } from './commands/device.js';
import { collectionCommand } from './commands/collection.js';
import { ejectCommand } from './commands/eject.js';
import { mountCommand } from './commands/mount.js';
import { migrateCommand } from './commands/migrate.js';
import { doctorCommand } from './commands/doctor.js';
import { completionsCommand, completeCommand } from './commands/completions.js';
import { setLogger as setFirmwareLogger } from '@podkit/ipod-firmware';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config/index.js';
import type { GlobalOptions } from './config/index.js';
import { setContext } from './context.js';
import { stripDefaultOptionValues } from './utils/option-source.js';

import { resolvePodkitVersion } from './version.js';

const version = resolvePodkitVersion();

const program = new Command();

program
  .name('podkit')
  .description('Modern sync for classic iPods')
  .version(version)
  .option('-v, --verbose', 'increase verbosity (stackable: -v, -vv, -vvv)', increaseVerbosity, 0)
  .option('-q, --quiet', 'suppress non-essential output')
  .option('--json', 'output in JSON format')
  .option('--no-color', 'disable colored output')
  .option('--no-tips', 'suppress contextual tips')
  .option(
    '--no-tty',
    'suppress interactive output (spinners/progress); auto-detected when stdout is not a TTY'
  )
  .option('-d, --device <name|path>', 'device name or path (auto-detect if omitted)')
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
  // Skip config loading for internal completion helper — it reads config directly
  const cmdChain = [];
  for (let cmd: Command | null = actionCommand; cmd && cmd !== thisCommand; cmd = cmd.parent) {
    cmdChain.unshift(cmd.name());
  }
  if (cmdChain[0] === '__complete' || cmdChain[0] === 'migrate' || cmdChain[0] === 'init') return;

  const globalOpts = thisCommand.opts() as GlobalOptions;

  // Forward library diagnostic events to stderr when -v is passed.
  // Library packages don't write to the console themselves; the CLI
  // installs receivers and decides format/destination.
  if (globalOpts.verbose && globalOpts.verbose >= 1) {
    setFirmwareLogger((event) => {
      process.stderr.write(`[ipod-firmware] ${event.message}\n`);
    });
  }

  // Get command-specific options that affect config. The strip drops
  // Commander's synthesised defaults (e.g. the `true` value `--no-X`
  // publishes when the user didn't pass `--no-X`) so they don't beat the
  // user's TOML at the loader's merge layer. See utils/option-source.ts
  // for the full rationale.
  //
  // Only the three keys `loadConfig`'s `commandOpts` parameter accepts
  // (`quality`, `artwork`, `skipUpgrades`) are cherry-picked here. Adding
  // a new command-level config override means updating both this list and
  // the `LoadConfigCommandOpts`-shaped argument in `config/loader.ts`.
  const rawOpts = stripDefaultOptionValues(
    actionCommand.opts() as Record<string, unknown>,
    actionCommand
  );
  const commandOpts = {
    quality: rawOpts.quality as string | undefined,
    artwork: rawOpts.artwork as boolean | undefined,
    skipUpgrades: rawOpts.skipUpgrades as boolean | undefined,
  };

  // Load and merge config from all sources
  let configResult: ReturnType<typeof loadConfig>;
  try {
    configResult = loadConfig(globalOpts, commandOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }

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
program.addCommand(migrateCommand);
program.addCommand(syncCommand);

// Entity management commands
program.addCommand(deviceCommand);
program.addCommand(collectionCommand);

// Root shortcuts (delegate to device subcommands)
program.addCommand(ejectCommand);
program.addCommand(mountCommand);

// Diagnostic commands
program.addCommand(doctorCommand);

// Utility commands
program.addCommand(completionsCommand);
program.addCommand(completeCommand, { hidden: true });

program.parse();
