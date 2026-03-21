/**
 * E2E test for graceful shutdown during sync.
 *
 * Verifies that when SIGINT is sent during an active sync:
 * 1. The process exits with code 130
 * 2. Tracks that completed before the signal are saved to the iPod database
 * 3. No orphaned files remain on disk (every file in iPod_Control/Music/ has
 *    a matching database entry)
 *
 * Signal timing strategy:
 * - We spawn `podkit sync` as a child process with the full test fixtures
 *   directory (14 tracks across multiple formats), which includes FLAC files
 *   that require transcoding.
 * - We monitor stdout for the "Overall:" progress line pattern that indicates
 *   at least 1 track has been processed.
 * - Once we see progress, we send SIGINT and wait for the process to exit.
 * - A fallback timer sends SIGINT after 30s if no progress is detected,
 *   preventing the test from hanging indefinitely.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestIpod } from '@podkit/gpod-testing';
import { areFixturesAvailable, getFixturesDir } from '../helpers/fixtures';
import { getCliPath, isCliAvailable } from '../helpers/cli-runner';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a config file pointing at the fixtures directory.
 * Uses "low" quality to speed up transcoding.
 */
async function createConfigFile(configDir: string, sourcePath: string): Promise<string> {
  const configPath = join(configDir, 'config.toml');
  const content = `version = 1
quality = "low"

[music.main]
path = "${sourcePath}"

[defaults]
music = "main"
`;
  await writeFile(configPath, content);
  return configPath;
}

/**
 * Recursively find all audio files in the iPod's Music directory.
 * Returns absolute paths to every file under iPod_Control/Music/F*.
 */
async function findIpodMusicFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];

  const files: string[] = [];
  const subdirs = await readdir(musicDir);
  for (const subdir of subdirs) {
    const subdirPath = join(musicDir, subdir);
    try {
      const entries = await readdir(subdirPath);
      for (const entry of entries) {
        files.push(join(subdirPath, entry));
      }
    } catch {
      // Not a directory, skip
    }
  }
  return files;
}

/**
 * Spawn the CLI and return a promise that resolves when it exits.
 *
 * Unlike the standard runCli helper, this gives us access to the
 * ChildProcess so we can send signals and monitor stdout in real-time.
 */
function spawnCli(
  args: string[],
  options: { env?: Record<string, string>; timeout?: number }
): {
  child: ReturnType<typeof spawn>;
  result: Promise<{ exitCode: number; stdout: string; stderr: string }>;
  onStdoutLine: (callback: (line: string) => void) => void;
} {
  const cliPath = getCliPath();
  const timeout = options.timeout ?? 60000;

  const env = {
    ...process.env,
    ...options.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  const child = spawn('node', [cliPath, ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.end();

  let stdout = '';
  let stderr = '';
  const lineCallbacks: Array<(line: string) => void> = [];
  let stdoutBuffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;

    // Parse lines from the stream for real-time monitoring.
    stdoutBuffer += text;
    const lines = stdoutBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      for (const cb of lineCallbacks) {
        cb(line);
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const result = new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      let resolved = false;

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
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        reject(err);
      });
    }
  );

  const onStdoutLine = (callback: (line: string) => void) => {
    lineCallbacks.push(callback);
  };

  return { child, result, onStdoutLine };
}

// =============================================================================
// Test
// =============================================================================

describe('graceful shutdown during sync', () => {
  let fixturesAvailable: boolean;
  let cliAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    cliAvailable = await isCliAvailable();
  });

  it('saves completed tracks and exits 130 on SIGINT', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }
    if (!cliAvailable) {
      console.log('Skipping: CLI not built');
      return;
    }

    // Use the fixtures audio root directory which contains subdirectories
    // with tracks in multiple formats. The collection scanner recursively
    // finds all audio files.
    const sourceDir = getFixturesDir();

    const configDir = await mkdtemp(join(tmpdir(), 'podkit-shutdown-config-'));
    const testIpod = await createTestIpod({ name: 'Shutdown Test iPod' });

    try {
      const configPath = await createConfigFile(configDir, sourceDir);

      const { child, result, onStdoutLine } = spawnCli(
        ['--config', configPath, 'sync', '--device', testIpod.path],
        { timeout: 60000 }
      );

      // Wait for progress indicating at least 1 track has been processed,
      // then send SIGINT. The progress display emits lines like:
      //   "Overall:  [====>   ]  14%  2/14 tracks"
      // We match on the "N/M tracks" pattern where N >= 1.
      let signalSent = false;

      const sendSignalOnce = () => {
        if (signalSent) return;
        signalSent = true;
        child.kill('SIGINT');
      };

      onStdoutLine((line) => {
        const match = line.match(/(\d+)\/\d+\s+tracks/);
        if (match) {
          const completed = parseInt(match[1]!, 10);
          if (completed >= 1) {
            sendSignalOnce();
          }
        }
      });

      // Fallback: if we don't see progress within 30 seconds, send SIGINT
      // anyway. This prevents the test from hanging if the output format
      // changes or transcoding is unexpectedly fast.
      let signalledByFallback = false;
      const fallbackTimer = setTimeout(() => {
        signalledByFallback = true;
        sendSignalOnce();
      }, 30000);

      const { exitCode, stdout: fullStdout, stderr: fullStderr } = await result;
      clearTimeout(fallbackTimer);

      if (signalledByFallback) {
        console.warn('Warning: SIGINT sent by fallback timer, not progress detection. ' +
          'The progress regex may no longer match CLI output.');
      }

      // --- Assertions ---

      // 1. Exit code should be 130 (SIGINT convention)
      expect(exitCode).toBe(130);

      // 2. The shutdown message should appear in stderr
      expect(fullStderr).toContain('Graceful shutdown requested');

      // 3. Check the iPod database — should have some tracks saved
      const verifyResult = await testIpod.verify();

      // The database should be valid (graceful shutdown saves it)
      expect(verifyResult.valid).toBe(true);

      // At least 1 track should have been saved before the interrupt,
      // but not all of them (sync should have been interrupted mid-way).
      const TOTAL_FIXTURE_TRACKS = 14;
      const dbTrackCount = verifyResult.trackCount;
      expect(dbTrackCount).toBeGreaterThan(0);
      expect(dbTrackCount).toBeLessThan(TOTAL_FIXTURE_TRACKS);

      // 4. No orphaned files: every file on disk should have a DB entry.
      //    The number of files on disk must equal the number of tracks in
      //    the database. More files than DB entries means orphaned files;
      //    fewer means unexpected cleanup occurred.
      const filesOnDisk = await findIpodMusicFiles(testIpod.path);
      expect(filesOnDisk.length).toBe(dbTrackCount);

      // 5. Output should indicate the database was saved
      expect(fullStdout).toContain('Database saved');
    } finally {
      await testIpod.cleanup();
      await rm(configDir, { recursive: true, force: true });
    }
  }, 90000); // 90s timeout for the full test including transcoding
});
