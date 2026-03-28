/**
 * E2E tests for codec preference resolution in sync flows.
 *
 * Tests that the codec preference config correctly controls which output codec
 * is used when syncing FLAC sources to mass-storage devices that do not support
 * FLAC natively. This forces the sync engine to transcode, and the codec
 * preference determines the target codec:
 *
 * - `lossy: ['opus', 'aac']` -> `.opus` output (first supported wins)
 * - `lossy: ['aac']` -> `.m4a` output
 * - Changing codec preference triggers re-sync with new codec
 *
 * These tests use mass-storage (generic) device targets, not iPod targets,
 * because codec preference is most relevant for mass-storage DAPs with broad
 * codec support.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliJson } from '../helpers/cli-runner';
import { areFixturesAvailable, getAlbumDir, Albums } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Helpers
// =============================================================================

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
 * Create a temporary directory to act as a mass-storage device.
 */
async function createTempDevice(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'podkit-codec-device-'));
}

/**
 * Recursively find all audio files in the device's Music/ directory.
 * Returns absolute paths.
 */
async function findMusicFiles(devicePath: string): Promise<string[]> {
  const musicDir = join(devicePath, 'Music');
  if (!existsSync(musicDir)) return [];

  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(musicDir);
  return files;
}

/**
 * Get file extensions from a list of file paths.
 */
function getExtensions(files: string[]): string[] {
  return files.map((f) => {
    const parts = f.split('.');
    return '.' + (parts[parts.length - 1] ?? '');
  });
}

/**
 * Write a config file for a mass-storage device with codec preference.
 *
 * Uses a named device ("test") with type = "generic" so the CLI opens
 * a MassStorageAdapter instead of trying to open an iPod database.
 * The device path is embedded in the config so --device test resolves it.
 *
 * IMPORTANT: supportedAudioCodecs should NOT include 'flac' when testing
 * codec preference for lossy transcoding — otherwise the device natively
 * supports the source format and the file is copied instead of transcoded.
 */
async function writeCodecConfig(
  configPath: string,
  options: {
    musicPath: string;
    devicePath: string;
    lossyCodecs: string[];
    supportedAudioCodecs: string[];
    quality?: string;
  }
): Promise<void> {
  const quality = options.quality ?? 'low';
  const lossyArray = options.lossyCodecs.map((c) => `"${c}"`).join(', ');
  const codecsArray = options.supportedAudioCodecs.map((c) => `"${c}"`).join(', ');

  // Use artworkSources = ["sidecar"] to avoid the embedded artwork code path,
  // which causes FFmpeg to try embedding mjpeg in OGG containers (unsupported).
  // artwork = false disables artwork syncing entirely.
  const content = `version = 1

quality = "${quality}"
artwork = false

[codec]
lossy = [${lossyArray}]

[music.default]
path = "${options.musicPath}"

[devices.test]
type = "generic"
path = "${options.devicePath}"
supportedAudioCodecs = [${codecsArray}]
artworkSources = ["sidecar"]

[defaults]
music = "default"
device = "test"
`;

  await writeFile(configPath, content);
}

// =============================================================================
// Tests
// =============================================================================

describe('codec preference: mass-storage sync', () => {
  let fixturesAvailable: boolean;
  let ffmpegAvailable: boolean;
  let goldbergPath: string;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    ffmpegAvailable = isFfmpegAvailable();
    goldbergPath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
  });

  function skipIfUnavailable(): boolean {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return true;
    }
    if (!ffmpegAvailable) {
      console.log('Skipping: ffmpeg not available');
      return true;
    }
    return false;
  }

  it('syncs FLAC to Opus when codec preference is opus-first', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-codec-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Device supports opus, aac, mp3 but NOT flac — forces transcoding of FLAC sources
      await writeCodecConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        lossyCodecs: ['opus', 'aac'],
        supportedAudioCodecs: ['opus', 'aac', 'mp3'],
      });

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'test',
        '--json',
      ]);

      if (result.exitCode !== 0) {
        console.log('JSON:', JSON.stringify(json, null, 2));
        console.log('STDERR:', result.stderr.slice(0, 2000));
      }
      expect(result.exitCode).toBe(0);
      expect(json?.success).toBe(true);
      expect(json?.result?.completed).toBe(3);

      // Verify output files on the device
      const files = await findMusicFiles(devicePath);
      expect(files.length).toBe(3);

      // All files should have .opus extension (first preferred lossy codec)
      const extensions = getExtensions(files);
      for (const ext of extensions) {
        expect(ext).toBe('.opus');
      }

      // All files should have non-zero size
      for (const file of files) {
        const stats = await stat(file);
        expect(stats.size).toBeGreaterThan(0);
      }
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  it('syncs FLAC to AAC when codec preference is aac-first', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-codec-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Device supports aac, mp3 but NOT flac — forces transcoding
      await writeCodecConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        lossyCodecs: ['aac'],
        supportedAudioCodecs: ['aac', 'mp3'],
      });

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'test',
        '--json',
      ]);

      if (result.exitCode !== 0) {
        console.log('JSON:', JSON.stringify(json, null, 2));
        console.log('STDERR:', result.stderr.slice(0, 2000));
      }
      expect(result.exitCode).toBe(0);
      expect(json?.success).toBe(true);
      expect(json?.result?.completed).toBe(3);

      // Verify output files on the device
      const files = await findMusicFiles(devicePath);
      expect(files.length).toBe(3);

      // All files should have .m4a extension (AAC container)
      const extensions = getExtensions(files);
      for (const ext of extensions) {
        expect(ext).toBe('.m4a');
      }

      // All files should have non-zero size
      for (const file of files) {
        const stats = await stat(file);
        expect(stats.size).toBeGreaterThan(0);
      }
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  it('re-syncs with new codec when codec preference changes from AAC to Opus', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-codec-resync-config-'));
    const configPath = join(configDir, 'config.toml');
    // Device supports opus, aac, mp3 but NOT flac — forces transcoding
    const supportedCodecs = ['opus', 'aac', 'mp3'];

    try {
      // Step 1: Sync with AAC codec preference
      await writeCodecConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        lossyCodecs: ['aac'],
        supportedAudioCodecs: supportedCodecs,
      });

      const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'test',
        '--json',
      ]);

      if (result1.exitCode !== 0) {
        console.log('Step 1 JSON:', JSON.stringify(json1, null, 2));
        console.log('Step 1 STDERR:', result1.stderr.slice(0, 2000));
      }
      expect(result1.exitCode).toBe(0);
      expect(json1?.success).toBe(true);
      expect(json1?.result?.completed).toBe(3);

      // Verify initial sync produced .m4a files
      const initialFiles = await findMusicFiles(devicePath);
      expect(initialFiles.length).toBe(3);
      const initialExtensions = getExtensions(initialFiles);
      for (const ext of initialExtensions) {
        expect(ext).toBe('.m4a');
      }

      // Step 2: Change codec preference to Opus and re-sync
      await writeCodecConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        lossyCodecs: ['opus', 'aac'],
        supportedAudioCodecs: supportedCodecs,
      });

      const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'test',
        '--json',
      ]);

      if (result2.exitCode !== 0) {
        console.log('Step 2 JSON:', JSON.stringify(json2, null, 2));
        console.log('Step 2 STDERR:', result2.stderr.slice(0, 2000));
      }
      expect(result2.exitCode).toBe(0);
      expect(json2?.success).toBe(true);

      // Verify re-sync produced files (should be updates, not additions)
      // completed > 0 means tracks were re-processed (codec change detected)
      expect(json2?.result?.completed).toBeGreaterThan(0);

      // Verify output files are now .opus
      const resyncFiles = await findMusicFiles(devicePath);
      expect(resyncFiles.length).toBe(3);

      const resyncExtensions = getExtensions(resyncFiles);
      for (const ext of resyncExtensions) {
        expect(ext).toBe('.opus');
      }

      // All files should have non-zero size
      for (const file of resyncFiles) {
        const stats = await stat(file);
        expect(stats.size).toBeGreaterThan(0);
      }

      // Verify no leftover .m4a files from the previous codec
      const m4aCount = resyncExtensions.filter((ext) => ext === '.m4a').length;
      expect(m4aCount).toBe(0);

      // Step 3: Verify no new tracks are added on re-sync
      // (track count is preserved through the codec change)
      const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'test',
        '--dry-run',
        '--json',
      ]);

      if (result3.exitCode !== 0) {
        console.log('Step 3 JSON:', JSON.stringify(json3, null, 2));
        console.log('Step 3 STDERR:', result3.stderr.slice(0, 2000));
      }
      expect(result3.exitCode).toBe(0);
      expect(json3?.plan?.tracksToAdd).toBe(0);
      expect(json3?.plan?.tracksToRemove).toBe(0);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 180000);
});
