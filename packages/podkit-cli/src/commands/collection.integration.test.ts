/**
 * Integration tests for collection music and collection video subcommands.
 *
 * These tests verify that the CLI correctly scans music and video directories
 * and returns properly formatted output.
 *
 * Prerequisites:
 * - FFmpeg (for video probing)
 * - Test fixtures in test/fixtures/audio/ and test/fixtures/video/
 */

import { describe, expect, it, beforeEach, afterEach, beforeAll } from 'bun:test';
import { mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Path to test audio fixtures
 */
const AUDIO_FIXTURES_PATH = resolve(__dirname, '../../../../test/fixtures/audio');

/**
 * Path to test video fixtures
 */
const VIDEO_FIXTURES_PATH = resolve(__dirname, '../../../../test/fixtures/video');

/**
 * Path to the built CLI
 */
const CLI_PATH = resolve(__dirname, '../main.ts');

/**
 * Run the CLI and capture output
 */
async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', CLI_PATH, ...args], {
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI timed out after 60 seconds'));
    }, 60000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Run CLI and parse JSON output
 */
async function runCliJson<T>(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  json: T | null;
  parseError?: string;
}> {
  const result = await runCli(args);
  let json: T | null = null;
  let parseError: string | undefined;

  try {
    const trimmed = result.stdout.trim();
    if (trimmed) {
      json = JSON.parse(trimmed);
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return { ...result, json, parseError };
}

/**
 * Create a temporary config file with a music collection
 */
async function createMusicConfig(musicPath: string): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  const configPath = join(tempDir, 'config.toml');
  await writeFile(
    configPath,
    `[music.test]
path = "${musicPath}"

[defaults]
music = "test"
`
  );
  return configPath;
}

/**
 * Create a temporary config file with a video collection
 */
async function createVideoConfig(videoPath: string): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  const configPath = join(tempDir, 'config.toml');
  await writeFile(
    configPath,
    `[video.test]
path = "${videoPath}"

[defaults]
video = "test"
`
  );
  return configPath;
}

/**
 * Create an empty temporary config file (no collections)
 */
async function createEmptyConfig(): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  const configPath = join(tempDir, 'config.toml');
  await writeFile(configPath, `# Empty config\n`);
  return configPath;
}

/**
 * Clean up a temporary config file
 */
async function cleanupConfig(configPath: string): Promise<void> {
  try {
    const dir = join(configPath, '..');
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Check if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Tests: collection music
// =============================================================================

describe('collection music integration', () => {
  let configPath: string;
  let emptyDir: string;

  beforeEach(async () => {
    // Create an empty directory for empty tests
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    if (configPath) {
      await cleanupConfig(configPath);
    }
    if (emptyDir) {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('scans directory and returns tracks', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const result = await runCli(['--config', configPath, 'collection', 'music', '-q']);

    expect(result.exitCode).toBe(0);
    // Should contain track data (table format by default)
    expect(result.stdout).toContain('Title');
    expect(result.stdout).toContain('Artist');
    // Should find at least one of our test tracks
    expect(
      result.stdout.includes('Harmony') ||
        result.stdout.includes('A440') ||
        result.stdout.includes('Podkit')
    ).toBe(true);
  });

  it('returns metadata (title, artist, album, duration)', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const { json, exitCode } = await runCliJson<
      Array<{
        title: string;
        artist: string;
        album: string;
        duration: number;
        durationFormatted: string;
      }>
    >(['--config', configPath, 'collection', 'music', '--format', 'json', '-q']);

    expect(exitCode).toBe(0);
    expect(json).toBeArray();
    expect(json!.length).toBeGreaterThan(0);

    // Check that all tracks have required metadata fields
    for (const track of json!) {
      expect(track).toHaveProperty('title');
      expect(track).toHaveProperty('artist');
      expect(track).toHaveProperty('album');
      expect(track).toHaveProperty('duration');
      expect(track).toHaveProperty('durationFormatted');
      // Duration should be a number (milliseconds)
      expect(typeof track.duration).toBe('number');
      // Duration formatted should be a string like "0:20"
      expect(track.durationFormatted).toMatch(/^\d+:\d{2}$/);
    }

    // Verify we can find a known track
    const harmonyTrack = json!.find((t) => t.title === 'Harmony');
    if (harmonyTrack) {
      expect(harmonyTrack.artist).toBe('Podkit Test Generator');
      expect(harmonyTrack.album).toBe('Synthetic Classics');
    }
  });

  it('handles empty directory', async () => {
    configPath = await createMusicConfig(emptyDir);
    const result = await runCli(['--config', configPath, 'collection', 'music', '-q']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No tracks found');
  });

  it('respects --format json option', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const { json, exitCode, parseError } = await runCliJson<unknown[]>([
      '--config',
      configPath,
      'collection',
      'music',
      '--format',
      'json',
      '-q',
    ]);

    expect(exitCode).toBe(0);
    expect(parseError).toBeUndefined();
    expect(json).toBeArray();
  });

  it('respects --format csv option', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const result = await runCli([
      '--config',
      configPath,
      'collection',
      'music',
      '--format',
      'csv',
      '-q',
    ]);

    expect(result.exitCode).toBe(0);
    // CSV should have header row
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Check header contains expected fields
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Artist');
    expect(lines[0]).toContain('Album');
  });

  it('respects --fields option', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const { json, exitCode } = await runCliJson<Array<Record<string, unknown>>>([
      '--config',
      configPath,
      'collection',
      'music',
      '--format',
      'json',
      '--fields',
      'title,artist',
      '-q',
    ]);

    expect(exitCode).toBe(0);
    expect(json).toBeArray();
    expect(json!.length).toBeGreaterThan(0);

    // Should only have the requested fields
    const firstTrack = json![0]!;
    expect(firstTrack).toHaveProperty('title');
    expect(firstTrack).toHaveProperty('artist');
    // Should NOT have album field
    expect(firstTrack).not.toHaveProperty('album');
  });
});

// =============================================================================
// Tests: collection video
// =============================================================================

describe('collection video integration', () => {
  let configPath: string;
  let emptyDir: string;
  let videoFixturesExist: boolean;

  beforeAll(async () => {
    // Check if video fixtures exist
    videoFixturesExist = await pathExists(VIDEO_FIXTURES_PATH);
    // Also check for at least one video file
    if (videoFixturesExist) {
      const compatibleVideo = join(VIDEO_FIXTURES_PATH, 'compatible-h264.mp4');
      videoFixturesExist = await pathExists(compatibleVideo);
    }
  });

  beforeEach(async () => {
    // Create an empty directory for empty tests
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    if (configPath) {
      await cleanupConfig(configPath);
    }
    if (emptyDir) {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('scans directory for video files', async () => {
    if (!videoFixturesExist) {
      console.log('Skipping: video fixtures not available');
      return;
    }

    configPath = await createVideoConfig(VIDEO_FIXTURES_PATH);
    const result = await runCli(['--config', configPath, 'collection', 'video', '-q']);

    expect(result.exitCode).toBe(0);
    // Should contain video data (table format by default)
    expect(result.stdout).toContain('Title');
    // Should find at least one of our test videos
    expect(
      result.stdout.includes('compatible') ||
        result.stdout.includes('movie') ||
        result.stdout.includes('tvshow') ||
        result.stdout.includes('Video')
    ).toBe(true);
  });

  it('returns video metadata', async () => {
    if (!videoFixturesExist) {
      console.log('Skipping: video fixtures not available');
      return;
    }

    configPath = await createVideoConfig(VIDEO_FIXTURES_PATH);
    const { json, exitCode } = await runCliJson<
      Array<{
        title: string;
        duration: number;
        durationFormatted: string;
        filePath?: string;
        format?: string;
      }>
    >(['--config', configPath, 'collection', 'video', '--format', 'json', '-q']);

    expect(exitCode).toBe(0);
    expect(json).toBeArray();
    expect(json!.length).toBeGreaterThan(0);

    // Check that videos have expected fields
    for (const video of json!) {
      expect(video).toHaveProperty('title');
      expect(video).toHaveProperty('duration');
      expect(video).toHaveProperty('durationFormatted');
      // Duration should be a number (milliseconds after conversion)
      expect(typeof video.duration).toBe('number');
    }
  });

  it('handles empty directory', async () => {
    configPath = await createVideoConfig(emptyDir);
    const result = await runCli(['--config', configPath, 'collection', 'video', '-q']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No tracks found');
  });

  it('JSON output format is correct', async () => {
    if (!videoFixturesExist) {
      console.log('Skipping: video fixtures not available');
      return;
    }

    configPath = await createVideoConfig(VIDEO_FIXTURES_PATH);
    const { json, exitCode, parseError } = await runCliJson<unknown[]>([
      '--config',
      configPath,
      'collection',
      'video',
      '--format',
      'json',
      '-q',
    ]);

    expect(exitCode).toBe(0);
    expect(parseError).toBeUndefined();
    expect(json).toBeArray();
    expect(json!.length).toBeGreaterThan(0);

    // Verify it's valid JSON that can be re-serialized
    const serialized = JSON.stringify(json);
    expect(JSON.parse(serialized)).toEqual(json);
  });
});

// =============================================================================
// Tests: Error handling
// =============================================================================

describe('collection subcommands error handling', () => {
  let configPath: string;

  afterEach(async () => {
    if (configPath) {
      await cleanupConfig(configPath);
    }
  });

  it('non-existent path returns error', async () => {
    const nonExistentPath = '/this/path/does/not/exist/ever';
    const tempDir = join(tmpdir(), `podkit-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.toml');
    await writeFile(
      configPath,
      `[music.test]
path = "${nonExistentPath}"

[defaults]
music = "test"
`
    );

    const result = await runCli(['--config', configPath, 'collection', 'music', '-q']);

    expect(result.exitCode).toBe(1);
    expect(
      result.stderr.includes('does not exist') ||
        result.stdout.includes('does not exist') ||
        result.stderr.includes('Error') ||
        result.stdout.includes('error')
    ).toBe(true);
  });

  it('invalid collection name returns error', async () => {
    configPath = await createMusicConfig(AUDIO_FIXTURES_PATH);
    const result = await runCli([
      '--config',
      configPath,
      'collection',
      'music',
      'nonexistent-collection',
      '-q',
    ]);

    expect(result.exitCode).toBe(1);
    // Should mention collection not found
    expect(
      result.stderr.includes('not found') ||
        result.stdout.includes('not found') ||
        result.stderr.includes('Error') ||
        result.stdout.includes('error')
    ).toBe(true);
  });

  it('no default collection returns helpful error', async () => {
    // Create config without defaults
    const tempDir = join(tmpdir(), `podkit-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.toml');
    await writeFile(
      configPath,
      `[music.mylib]
path = "${AUDIO_FIXTURES_PATH}"
# No defaults section
`
    );

    const result = await runCli(['--config', configPath, 'collection', 'music', '-q']);

    expect(result.exitCode).toBe(1);
    // Should mention no default or ask to specify collection
    expect(
      result.stderr.includes('default') ||
        result.stdout.includes('default') ||
        result.stderr.includes('specify') ||
        result.stdout.includes('specify') ||
        result.stderr.includes('collection') ||
        result.stdout.includes('collection')
    ).toBe(true);
  });

  it('no music collections configured returns helpful error', async () => {
    configPath = await createEmptyConfig();
    const result = await runCli(['--config', configPath, 'collection', 'music', '-q']);

    expect(result.exitCode).toBe(1);
    // Should mention no collections configured
    expect(
      result.stderr.toLowerCase().includes('collection') ||
        result.stdout.toLowerCase().includes('collection') ||
        result.stderr.toLowerCase().includes('configured') ||
        result.stdout.toLowerCase().includes('configured') ||
        result.stderr.toLowerCase().includes('add') ||
        result.stdout.toLowerCase().includes('add')
    ).toBe(true);
  });

  it('no video collections configured returns helpful error', async () => {
    configPath = await createEmptyConfig();
    const result = await runCli(['--config', configPath, 'collection', 'video', '-q']);

    expect(result.exitCode).toBe(1);
    // Should mention no collections configured
    expect(
      result.stderr.toLowerCase().includes('collection') ||
        result.stdout.toLowerCase().includes('collection') ||
        result.stderr.toLowerCase().includes('configured') ||
        result.stdout.toLowerCase().includes('configured') ||
        result.stderr.toLowerCase().includes('add') ||
        result.stdout.toLowerCase().includes('add')
    ).toBe(true);
  });
});
