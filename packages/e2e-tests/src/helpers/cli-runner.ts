/**
 * CLI runner for E2E tests.
 *
 * Spawns the podkit CLI as a subprocess and captures output, exactly as
 * a real user would invoke it.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Result of running the CLI.
 */
export interface CliResult {
  /** Process exit code */
  exitCode: number;

  /** Captured stdout */
  stdout: string;

  /** Captured stderr */
  stderr: string;

  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Options for running the CLI.
 */
export interface CliOptions {
  /** Working directory for the process */
  cwd?: string;

  /** Environment variables (merged with process.env) */
  env?: Record<string, string>;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Standard input to send to the process */
  stdin?: string;
}

/**
 * Path to the built CLI artifact.
 *
 * E2E tests run against the compiled CLI, not TypeScript source.
 */
export function getCliPath(): string {
  // Resolve relative to this package
  return resolve(__dirname, '../../../podkit-cli/dist/main.js');
}

/**
 * Run the podkit CLI with given arguments.
 *
 * @param args - Command-line arguments
 * @param options - Execution options
 * @returns CLI result with exit code, output, and timing
 *
 * @example
 * ```typescript
 * const result = await runCli(['status', '/Volumes/iPod']);
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('Track count');
 * ```
 */
export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  const cliPath = getCliPath();
  const timeout = options.timeout ?? 30000;

  const startTime = performance.now();

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...options.env,
      // Ensure consistent output
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };

    const child = spawn('node', [cliPath, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Send stdin if provided
    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        reject(new Error(`CLI timed out after ${timeout}ms`));
      }
    }, timeout);

    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      const duration = performance.now() - startTime;
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration,
      });
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Result of running CLI with JSON parsing.
 */
export interface CliJsonResult<T> {
  /** Raw CLI result */
  result: CliResult;

  /** Parsed JSON, or null if parsing failed */
  json: T | null;

  /** Parse error, if any */
  parseError?: string;
}

/**
 * Run the CLI and parse JSON output.
 *
 * @param args - Command-line arguments (should include --json or -f json)
 * @param options - Execution options
 * @returns CLI result with parsed JSON
 *
 * @example
 * ```typescript
 * const { result, json } = await runCliJson<StatusOutput>(['status', path, '--json']);
 * if (json) {
 *   expect(json.trackCount).toBeGreaterThan(0);
 * }
 * ```
 */
export async function runCliJson<T>(
  args: string[],
  options: CliOptions = {}
): Promise<CliJsonResult<T>> {
  const result = await runCli(args, options);

  let json: T | null = null;
  let parseError: string | undefined;

  try {
    // Handle potential leading/trailing whitespace
    const trimmed = result.stdout.trim();
    if (trimmed) {
      json = JSON.parse(trimmed);
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return { result, json, parseError };
}

/**
 * Check if the CLI is available (built).
 */
export async function isCliAvailable(): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(getCliPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temporary config file with a music collection.
 *
 * @param musicPath - Path to the music directory
 * @param devicePath - Optional path to the device (omit to require --device flag)
 * @returns Path to the temp config file
 *
 * @example
 * ```typescript
 * const configPath = await createTempConfig('/path/to/music', target.path);
 * const result = await runCli(['--config', configPath, 'sync']);
 * ```
 */
export async function createTempConfig(musicPath: string, devicePath?: string): Promise<string> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podkit-e2e-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  let content = `[music.main]
path = "${musicPath}"

[defaults]
music = "main"
`;

  if (devicePath) {
    // Add a device config that uses the device path directly
    // Note: This is a workaround for testing - real configs use UUID
    content += `
[devices.test]
volumeUuid = "test-uuid"
volumeName = "test"
`;
  }

  await fs.writeFile(configPath, content);
  return configPath;
}

/**
 * Create a temporary config file for a Subsonic music collection.
 *
 * @param serverUrl - Subsonic server URL (e.g., 'http://localhost:4533')
 * @param username - Subsonic username
 * @returns Path to the temp config file
 *
 * @example
 * ```typescript
 * const configPath = await createSubsonicConfig('http://localhost:4533', 'admin');
 * const result = await runCli(['--config', configPath, 'sync'], {
 *   env: { SUBSONIC_PASSWORD: 'testpass' }
 * });
 * ```
 */
export async function createSubsonicConfig(serverUrl: string, username: string): Promise<string> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podkit-subsonic-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  const content = `[music.main]
type = "subsonic"
url = "${serverUrl}"
username = "${username}"

[defaults]
music = "main"
`;

  await fs.writeFile(configPath, content);
  return configPath;
}

/**
 * Clean up a temp config file created by createTempConfig.
 */
export async function cleanupTempConfig(configPath: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  try {
    const dir = path.dirname(configPath);
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
