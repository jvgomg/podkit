import { Command } from 'commander';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { DEFAULT_CONFIG_PATH } from '../config/index.js';
import { readConfigVersion, CURRENT_CONFIG_VERSION } from '../config/version.js';
import {
  runMigrations,
  getPendingMigrations,
  MigrationAbortError,
} from '../config/migrations/index.js';
import type { MigrationContext } from '../config/migrations/index.js';
import type { GlobalOptions } from '../config/types.js';
import { OutputContext } from '../output/index.js';

/**
 * Resolve the config file path from global options/environment.
 * Same logic as loader.ts but without loading the full config.
 */
function resolveConfigPath(globalOpts: Partial<GlobalOptions>): string {
  return globalOpts.config ?? process.env.PODKIT_CONFIG ?? DEFAULT_CONFIG_PATH;
}

/**
 * Generate a simple line-by-line diff between two strings.
 * Returns lines prefixed with + (added) or - (removed).
 */
export function simpleDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [];

  // Find lines that differ using a simple approach:
  // Walk both arrays and report insertions/deletions
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      // Remaining new lines are additions
      diff.push(`+ ${newLines[ni]}`);
      ni++;
    } else if (ni >= newLines.length) {
      // Remaining old lines are removals
      diff.push(`- ${oldLines[oi]}`);
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      // Lines match, skip
      oi++;
      ni++;
    } else {
      // Look ahead in new lines to see if old line appears later (it was removed)
      // Look ahead in old lines to see if new line appears later (it was added)
      const newIdx = newLines.indexOf(oldLines[oi]!, ni + 1);
      const oldIdx = oldLines.indexOf(newLines[ni]!, oi + 1);

      if (newIdx !== -1 && (oldIdx === -1 || newIdx - ni <= oldIdx - oi)) {
        // The current new lines up to newIdx are insertions
        while (ni < newIdx) {
          diff.push(`+ ${newLines[ni]}`);
          ni++;
        }
      } else if (oldIdx !== -1) {
        // The current old lines up to oldIdx are removals
        while (oi < oldIdx) {
          diff.push(`- ${oldLines[oi]}`);
          oi++;
        }
      } else {
        // No match found — treat as removal + addition
        diff.push(`- ${oldLines[oi]}`);
        diff.push(`+ ${newLines[ni]}`);
        oi++;
        ni++;
      }
    }
  }

  return diff;
}

/**
 * Generate a backup file path with date suffix.
 * Handles collisions by appending a counter.
 */
export function generateBackupPath(configPath: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const base = `${configPath}.backup.${date}`;

  if (!fs.existsSync(base)) {
    return base;
  }

  // Find next available counter
  let counter = 2;
  while (fs.existsSync(`${base}.${counter}`)) {
    counter++;
  }
  return `${base}.${counter}`;
}

/**
 * Ask the user for confirmation via stdin.
 * Returns true if user types 'y' or 'yes' (case-insensitive).
 */
async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * Create a MigrationContext with real readline-based prompts and filesystem access.
 */
function createMigrationContext(dryRun: boolean): MigrationContext {
  return {
    dryRun,
    prompt: {
      confirm: async (message, defaultValue = false) => {
        const suffix = defaultValue ? '(Y/n)' : '(y/N)';
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        return new Promise((resolve) => {
          rl.question(`${message} ${suffix} `, (answer) => {
            rl.close();
            const trimmed = answer.trim().toLowerCase();
            if (trimmed === '') resolve(defaultValue);
            else resolve(trimmed === 'y' || trimmed === 'yes');
          });
        });
      },
      choose: async (message, choices) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        process.stderr.write(`${message}\n`);
        choices.forEach((c, i) => {
          process.stderr.write(`  ${i + 1}) ${c.label}`);
          if (c.description) process.stderr.write(` — ${c.description}`);
          process.stderr.write('\n');
        });
        return new Promise((resolve, reject) => {
          rl.question('Choice: ', (answer) => {
            rl.close();
            const num = parseInt(answer.trim(), 10);
            if (num >= 1 && num <= choices.length) {
              resolve(choices[num - 1]!.value);
            } else {
              reject(new MigrationAbortError('Invalid choice'));
            }
          });
        });
      },
      text: async (message, defaultValue) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `;
        return new Promise((resolve) => {
          rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue || '');
          });
        });
      },
      info: (message) => process.stderr.write(`  ${message}\n`),
      warn: (message) => process.stderr.write(`  Warning: ${message}\n`),
    },
    fs: {
      exists: (p) => fs.existsSync(p),
      readFile: (p) => fs.readFileSync(p, 'utf-8'),
      readdir: (p) => fs.readdirSync(p),
      isDirectory: (p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
    },
  };
}

export const migrateCommand = new Command('migrate')
  .description('migrate config file to the latest version')
  .option('-n, --dry-run', 'show what would change without writing')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (options, command) => {
    // Access global options from the root command (bypasses normal config loading)
    const rootCommand = command.parent;
    const globalOpts = rootCommand.opts() as GlobalOptions;
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const dryRun = options.dryRun as boolean | undefined;
    const skipConfirm = options.yes as boolean | undefined;

    // Resolve config path
    const configPath = resolveConfigPath(globalOpts);

    // Check if config file exists
    if (!fs.existsSync(configPath)) {
      if (globalOpts.json) {
        out.json({
          success: false,
          error: 'Config file not found',
          configPath,
        });
      } else {
        out.error(`Config file not found: ${configPath}`);
        out.print("Run 'podkit init' to create a config file.");
      }
      process.exitCode = 1;
      return;
    }

    // Read raw TOML content
    const content = fs.readFileSync(configPath, 'utf-8');

    // Determine current version
    let currentVersion: number;
    try {
      currentVersion = readConfigVersion(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (globalOpts.json) {
        out.json({ success: false, error: message, configPath });
      } else {
        out.error(`Error reading config version: ${message}`);
      }
      process.exitCode = 1;
      return;
    }

    // Check if already up to date
    if (currentVersion >= CURRENT_CONFIG_VERSION) {
      if (globalOpts.json) {
        out.json({
          success: true,
          configPath,
          version: currentVersion,
          upToDate: true,
          applied: [],
        });
      } else {
        out.print(`Config is up to date (version ${currentVersion}).`);
      }
      return;
    }

    // Show pending migrations
    const pending = getPendingMigrations(currentVersion);

    if (!globalOpts.json) {
      out.print(`Config file: ${configPath}`);
      out.print(`Current version: ${currentVersion}`);
      out.print(`Target version:  ${CURRENT_CONFIG_VERSION}`);
      out.print('');
      out.print(`Pending migrations (${pending.length}):`);
      for (const m of pending) {
        const typeTag = m.type === 'interactive' ? ' [interactive]' : '';
        out.print(`  ${m.fromVersion} -> ${m.toVersion}: ${m.description}${typeTag}`);
      }
      out.print('');
    }

    // Create migration context with prompt and filesystem utilities
    const context = createMigrationContext(!!dryRun);

    // Run migrations (may throw MigrationAbortError for interactive migrations)
    let result;
    try {
      result = await runMigrations(content, currentVersion, context);
    } catch (err) {
      if (err instanceof MigrationAbortError) {
        if (globalOpts.json) {
          out.json({
            success: false,
            aborted: true,
            configPath,
            error: err.message,
          });
        } else {
          out.print('Migration aborted. No changes were made.');
        }
        return;
      }
      throw err;
    }

    // Show diff
    const diffLines = simpleDiff(content, result.content);

    if (!globalOpts.json && diffLines.length > 0) {
      out.print('Changes:');
      for (const line of diffLines) {
        out.print(`  ${line}`);
      }
      out.print('');
    }

    // Handle dry run
    if (dryRun) {
      if (globalOpts.json) {
        out.json({
          success: true,
          dryRun: true,
          configPath,
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
          applied: result.applied,
          diff: diffLines,
        });
      } else {
        out.print('Dry run — no changes written.');
      }
      return;
    }

    // Confirm with user (unless --yes or --json)
    if (!skipConfirm && !globalOpts.json) {
      const confirmed = await confirm('Apply changes? (y/N) ');
      if (!confirmed) {
        out.print('Migration cancelled.');
        return;
      }
    }

    // Create backup and write migrated content
    let backupPath: string;
    try {
      backupPath = generateBackupPath(configPath);
      fs.copyFileSync(configPath, backupPath);
      fs.writeFileSync(configPath, result.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (globalOpts.json) {
        out.json({ success: false, error: `Failed to write config: ${message}`, configPath });
      } else {
        out.error(`Failed to write config: ${message}`);
      }
      process.exitCode = 1;
      return;
    }

    if (globalOpts.json) {
      out.json({
        success: true,
        configPath,
        backupPath,
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        applied: result.applied,
      });
    } else {
      out.print(`Backup saved to ${backupPath}`);
      out.print(`Config migrated from version ${result.fromVersion} to ${result.toVersion}.`);
    }
  });
