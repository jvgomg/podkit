/**
 * CLI runner — shells out to the podkit binary for all operations.
 *
 * The daemon never loads config files or creates adapters itself.
 * It delegates everything to the CLI and parses JSON output.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliResult<T = unknown> {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed JSON from stdout, if available */
  json?: T;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * A CLI invocation that exposes the child process for signal forwarding.
 * The `result` promise resolves when the child exits.
 */
export interface AbortableCliResult<T = unknown> {
  result: Promise<CliResult<T>>;
  child: ChildProcess;
}

export interface CliRunnerOptions {
  timeout?: number;
  env?: Record<string, string>;
}

/** Subset of MountOutput the daemon cares about */
export interface MountOutput {
  success: boolean;
  mountPoint?: string;
  error?: string;
}

/** Subset of SyncOutput the daemon cares about */
export interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToUpdate: number;
    tracksExisting: number;
    albumCount?: number;
    artistCount?: number;
    videoSummary?: {
      movieCount: number;
      showCount: number;
      episodeCount: number;
    };
  };
  result?: {
    completed: number;
    failed: number;
    duration: number;
  };
  error?: string;
}

/** Subset of EjectOutput the daemon cares about */
export interface EjectOutput {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLI_BINARY = 'podkit';

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Spawn the podkit CLI and capture output.
 *
 * Returns both the result promise and the child process reference, allowing
 * callers to send signals (e.g. SIGINT for graceful abort) to the child.
 */
export function spawnCli<T = unknown>(
  args: string[],
  options?: CliRunnerOptions
): AbortableCliResult<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const startTime = performance.now();

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options?.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  const child = spawn(CLI_BINARY, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const result = new Promise<CliResult<T>>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin.end();

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        reject(new Error(`CLI timed out after ${timeout}ms: podkit ${args.join(' ')}`));
      }
    }, timeout);

    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      const duration = performance.now() - startTime;

      let json: T | undefined;
      try {
        const trimmed = stdout.trim();
        if (trimmed) {
          json = JSON.parse(trimmed) as T;
        }
      } catch {
        // Not JSON — that's fine for non-JSON commands
      }

      resolve({ exitCode: code ?? 1, stdout, stderr, json, duration });
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(err);
    });
  });

  return { result, child };
}

/**
 * Spawn the podkit CLI and capture output.
 *
 * Convenience wrapper around {@link spawnCli} that just returns the result promise.
 */
export async function runCli<T = unknown>(
  args: string[],
  options?: CliRunnerOptions
): Promise<CliResult<T>> {
  return spawnCli<T>(args, options).result;
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/**
 * Mount a device to a target path.
 *
 * `podkit --json mount --disk /dev/sdXN --target /tmp/podkit-sdXN`
 */
export async function runMount(disk: string, target: string): Promise<CliResult<MountOutput>> {
  log('info', `Mounting ${disk} to ${target}`);
  // --json is a global flag and must precede the subcommand
  return runCli<MountOutput>(['--json', 'mount', '--disk', disk, '--target', target]);
}

/**
 * Run a sync against a mounted device.
 *
 * `podkit --json -d /tmp/podkit-sdXN sync [--dry-run]`
 */
export async function runSync(
  device: string,
  options?: { dryRun?: boolean }
): Promise<CliResult<SyncOutput>> {
  return spawnSync(device, options).result;
}

/**
 * Run a sync against a mounted device, returning an abortable handle.
 *
 * The caller can send SIGINT to the child process via `child.kill('SIGINT')`
 * to trigger the CLI's graceful shutdown (drain + save).
 */
export function spawnSync(
  device: string,
  options?: { dryRun?: boolean }
): AbortableCliResult<SyncOutput> {
  // --json and -d are global flags and must precede the subcommand
  const args = ['--json', '-d', device, 'sync'];
  if (options?.dryRun) {
    args.push('--dry-run');
  }
  log('info', `Running sync`, { device, dryRun: options?.dryRun ?? false });
  return spawnCli<SyncOutput>(args);
}

/**
 * Eject (unmount) a device.
 *
 * `podkit --json -d /tmp/podkit-sdXN eject`
 */
export async function runEject(device: string): Promise<CliResult<EjectOutput>> {
  log('info', `Ejecting device at ${device}`);
  // --json and -d are global flags and must precede the subcommand
  return runCli<EjectOutput>(['--json', '-d', device, 'eject']);
}
