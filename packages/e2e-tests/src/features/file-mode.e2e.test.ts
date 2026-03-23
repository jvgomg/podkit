/**
 * E2E tests for the `transferMode` config option.
 *
 * Tests that the transferMode option correctly controls whether embedded artwork
 * is preserved or stripped from transcoded files:
 *
 * - `transferMode: 'fast'` (default): strips embedded artwork, optimized for iPod
 * - `transferMode: 'optimized'`: strips embedded artwork (-vn)
 * - `transferMode: 'portable'`: preserves embedded artwork (-c:v copy)
 *
 * This only affects transcoded files (FLAC->AAC). Direct copies (MP3, lossy M4A)
 * are not modified. iPods read artwork from their database, not embedded file data,
 * so stripping is safe for iPod playback.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, getAlbumDir, Albums } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if ffprobe is available.
 */
function isFfprobeAvailable(): boolean {
  try {
    execSync('which ffprobe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ffmpeg is available.
 */
function isFfmpegAvailable(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively find all .m4a files in the iPod's music directory.
 */
async function findTranscodedFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];

  const files: string[] = [];
  const { readdir } = await import('node:fs/promises');

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.m4a')) {
        files.push(fullPath);
      }
    }
  }

  await walk(musicDir);
  return files;
}

/**
 * Check whether a file has an embedded video/image stream (artwork).
 *
 * Uses ffprobe to inspect streams. Embedded artwork appears as a video
 * stream with codec_type "video" (typically mjpeg or png).
 */
function hasEmbeddedArtwork(filePath: string): boolean {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries stream=codec_type -of json "${filePath}"`,
      { encoding: 'utf-8' }
    );
    const data = JSON.parse(result);
    const streams = data.streams ?? [];
    return streams.some((s: { codec_type: string }) => s.codec_type === 'video');
  } catch {
    return false;
  }
}

/**
 * Create a config file with transferMode setting.
 */
async function createTransferModeConfig(
  musicPath: string,
  options: { transferMode?: 'fast' | 'optimized' | 'portable' }
): Promise<{ configPath: string; configDir: string }> {
  const configDir = await mkdtemp(join(tmpdir(), 'podkit-transfermode-config-'));
  const configPath = join(configDir, 'config.toml');

  let content = `version = 1

# Use low quality for fast transcodes in tests
quality = "low"
`;

  if (options.transferMode) {
    content += `transferMode = "${options.transferMode}"\n`;
  }

  content += `
[music.default]
path = "${musicPath}"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return { configPath, configDir };
}

// =============================================================================
// Tests
// =============================================================================

describe('transferMode: embedded artwork in transcoded files', () => {
  let fixturesAvailable: boolean;
  let ffprobeAvailable: boolean;
  let ffmpegAvailable: boolean;
  let goldbergPath: string;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    ffprobeAvailable = isFfprobeAvailable();
    ffmpegAvailable = isFfmpegAvailable();
    goldbergPath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
  });

  /**
   * Skip helper for tests that need fixtures, ffprobe, and ffmpeg.
   */
  function skipIfUnavailable(): boolean {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return true;
    }
    if (!ffprobeAvailable) {
      console.log('Skipping: ffprobe not available');
      return true;
    }
    if (!ffmpegAvailable) {
      console.log('Skipping: ffmpeg not available');
      return true;
    }
    return false;
  }

  it('strips embedded artwork with transferMode "optimized"', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      // Create config with optimized transferMode
      const { configPath, configDir } = await createTransferModeConfig(goldbergPath, {
        transferMode: 'optimized',
      });

      try {
        // Sync the goldberg-selections (3 FLAC tracks with embedded artwork)
        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(3);

        // Find the transcoded .m4a files on the iPod
        const m4aFiles = await findTranscodedFiles(target.path);
        expect(m4aFiles.length).toBe(3);

        // All transcoded files should NOT have embedded artwork
        for (const file of m4aFiles) {
          expect(hasEmbeddedArtwork(file)).toBe(false);
        }
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('preserves embedded artwork with transferMode "portable"', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      // Create config with portable transferMode
      const { configPath, configDir } = await createTransferModeConfig(goldbergPath, {
        transferMode: 'portable',
      });

      try {
        // Sync the goldberg-selections (3 FLAC tracks with embedded artwork)
        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(3);

        // Find the transcoded .m4a files on the iPod
        const m4aFiles = await findTranscodedFiles(target.path);
        expect(m4aFiles.length).toBe(3);

        // All transcoded files SHOULD have embedded artwork
        for (const file of m4aFiles) {
          expect(hasEmbeddedArtwork(file)).toBe(true);
        }
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('defaults to fast when transferMode is not specified', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      // Create config WITHOUT transferMode (should default to fast)
      const { configPath, configDir } = await createTransferModeConfig(goldbergPath, {});

      try {
        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(3);

        // Find the transcoded .m4a files on the iPod
        const m4aFiles = await findTranscodedFiles(target.path);
        expect(m4aFiles.length).toBe(3);

        // Default behavior should strip artwork (fast mode)
        for (const file of m4aFiles) {
          expect(hasEmbeddedArtwork(file)).toBe(false);
        }
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('respects --transfer-mode CLI flag override', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      // Create config with optimized
      const { configPath, configDir } = await createTransferModeConfig(goldbergPath, {
        transferMode: 'optimized',
      });

      try {
        // Override with --transfer-mode portable via CLI flag
        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--transfer-mode',
          'portable',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(3);

        // Find the transcoded .m4a files on the iPod
        const m4aFiles = await findTranscodedFiles(target.path);
        expect(m4aFiles.length).toBe(3);

        // CLI flag should override config — artwork should be preserved
        for (const file of m4aFiles) {
          expect(hasEmbeddedArtwork(file)).toBe(true);
        }
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});
