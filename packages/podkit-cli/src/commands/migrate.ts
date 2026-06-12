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
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import { OutputContext } from '../output/index.js';

/**
 * Error codes emitted by `podkit migrate`.
 *
 * Exhaustive — every CliError thrown from this command's runner uses one
 * of these. Consumers branching on `output.code` can rely on this union.
 */
export const MigrateErrorCodes = {
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_VERSION_UNREADABLE: 'CONFIG_VERSION_UNREADABLE',
  MIGRATION_ABORTED: 'MIGRATION_ABORTED',
  CONFIG_WRITE_FAILED: 'CONFIG_WRITE_FAILED',
} as const;
export type MigrateErrorCode = (typeof MigrateErrorCodes)[keyof typeof MigrateErrorCodes];

export interface MigrateSuccess {
  success: true;
  configPath: string;
  version?: number;
  fromVersion?: number;
  toVersion?: number;
  upToDate?: boolean;
  dryRun?: boolean;
  applied?: unknown[];
  diff?: string[];
  backupPath?: string;
}

export type MigrateErrorOutput = CliErrorOutput & { code: MigrateErrorCode };
export type MigrateOutput = MigrateSuccess | MigrateErrorOutput;

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
        // Direct stderr writes are intentional here: they're paired with
        // the readline interface above, which binds to `process.stderr`
        // by design (readline takes a writable stream, not an OutputSink).
        // Routing the prompt copy through OutputContext while readline
        // still owns the actual TTY would split the interactive flow
        // across two channels. See conventions.md §2 carve-out.
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
      // info/warn write to stderr alongside the readline-coupled prompts
      // above so the interactive flow stays on one channel. Same carve-out
      // as `choose` / `text` — see conventions.md §2.
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
    const rootCommand = command.parent;
    const globalOpts = rootCommand.opts() as GlobalOptions;
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const dryRun = options.dryRun as boolean | undefined;
    const skipConfirm = options.yes as boolean | undefined;
    const configPath = resolveConfigPath(globalOpts);

    await runAction(out, async () => {
      if (!fs.existsSync(configPath)) {
        throw new CliError({
          message: `Config file not found: ${configPath}`,
          code: MigrateErrorCodes.CONFIG_NOT_FOUND,
          details: { configPath },
          printText: (o) => {
            o.error(`Config file not found: ${configPath}`);
            o.print("Run 'podkit init' to create a config file.");
          },
        });
      }

      const content = fs.readFileSync(configPath, 'utf-8');

      let currentVersion: number;
      try {
        currentVersion = readConfigVersion(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message,
          code: MigrateErrorCodes.CONFIG_VERSION_UNREADABLE,
          details: { configPath },
          printText: (o) => o.error(`Error reading config version: ${message}`),
        });
      }

      if (currentVersion >= CURRENT_CONFIG_VERSION) {
        if (out.isJson) {
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

      const pending = getPendingMigrations(currentVersion);

      if (!out.isJson) {
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

      const context = createMigrationContext(!!dryRun);

      let result;
      try {
        result = await runMigrations(content, currentVersion, context);
      } catch (err) {
        if (err instanceof MigrationAbortError) {
          throw new CliError({
            message: err.message,
            code: MigrateErrorCodes.MIGRATION_ABORTED,
            exitCode: 0,
            details: { aborted: true, configPath },
            printText: (o) => o.print('Migration aborted. No changes were made.'),
          });
        }
        throw err;
      }

      const diffLines = simpleDiff(content, result.content);

      if (!out.isJson && diffLines.length > 0) {
        out.print('Changes:');
        for (const line of diffLines) {
          out.print(`  ${line}`);
        }
        out.print('');
      }

      if (dryRun) {
        if (out.isJson) {
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

      if (!skipConfirm && !out.isJson) {
        const confirmed = await confirm('Apply changes? (y/N) ');
        if (!confirmed) {
          out.print('Migration cancelled.');
          return;
        }
      }

      let backupPath: string;
      try {
        backupPath = generateBackupPath(configPath);
        fs.copyFileSync(configPath, backupPath);
        fs.writeFileSync(configPath, result.content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to write config: ${message}`,
          code: MigrateErrorCodes.CONFIG_WRITE_FAILED,
          details: { configPath },
          printText: (o) => o.error(`Failed to write config: ${message}`),
        });
      }

      if (out.isJson) {
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
  });
