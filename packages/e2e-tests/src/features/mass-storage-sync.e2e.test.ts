/**
 * E2E tests for mass-storage device sync.
 *
 * Tests the full sync pipeline against virtual (temporary directory) mass-storage
 * devices. No real hardware needed — the device is a temp directory configured
 * with a device type (echo-mini or generic) in the config file.
 *
 * Scenarios covered:
 * - Basic sync: FLAC sources -> AAC on echo-mini device
 * - Incremental sync — add: new tracks synced, existing untouched
 * - Incremental sync — remove: deleted source tracks removed with --delete
 * - Pre-existing unmanaged music: sync doesn't touch user files
 * - Quality preset change: max (FLAC copy) -> high (AAC transcode)
 * - Transfer mode change: fast -> portable, tip about --force-transfer-mode
 * - Artwork chroma handling: yuvj444p source -> yuvj420p on device
 * - Codec preference: opus unsupported by echo-mini -> falls back to aac
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir, stat, mkdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { areFixturesAvailable, getAlbumDir, Albums, getAlbumTracks } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Helpers
// =============================================================================

function isFfmpegAvailable(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isFfprobeAvailable(): boolean {
  try {
    execSync('which ffprobe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temporary directory to act as a mass-storage device.
 */
async function createTempDevice(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'podkit-ms-device-'));
}

/**
 * Recursively find all files in a directory (excluding dotfiles/hidden dirs).
 */
async function findFiles(dir: string, extensions?: string[]): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files: string[] = [];

  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (!extensions || extensions.some((ext) => fullPath.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return files;
}

/**
 * Find all audio files on a device. For echo-mini (musicDir=''), searches the
 * entire device root. For generic (musicDir='Music'), searches the Music/ directory.
 */
async function findDeviceAudioFiles(devicePath: string, musicDir: string = ''): Promise<string[]> {
  const searchDir = musicDir ? join(devicePath, musicDir) : devicePath;
  const audioExts = ['.m4a', '.mp3', '.flac', '.ogg', '.opus', '.wav', '.aiff'];
  return findFiles(searchDir, audioExts);
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
 * Check the pixel format of embedded artwork using ffprobe.
 */
function getArtworkPixFmt(filePath: string): string | null {
  try {
    const result = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check whether a file has embedded artwork.
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
 * Get artwork dimensions from a file using ffprobe.
 */
function getArtworkDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const result = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`,
      { encoding: 'utf-8' }
    );
    const data = JSON.parse(result);
    const stream = data.streams?.[0];
    if (stream?.width && stream?.height) {
      return { width: stream.width, height: stream.height };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write a config file for an echo-mini mass-storage device.
 *
 * Echo-mini:
 * - musicDir = "" (root of device)
 * - artworkMaxResolution = 127
 * - supportedAudioCodecs: aac, alac, mp3, flac, ogg, wav (no opus!)
 */
async function writeEchoMiniConfig(
  configPath: string,
  options: {
    musicPath: string;
    devicePath: string;
    quality?: string;
    transferMode?: string;
    artwork?: boolean;
    delete?: boolean;
  }
): Promise<void> {
  const quality = options.quality ?? 'low';
  const artwork = options.artwork !== undefined ? options.artwork : true;
  const transferMode = options.transferMode ? `transferMode = "${options.transferMode}"` : '';

  const content = `version = 1

quality = "${quality}"
artwork = ${artwork}
${transferMode}

[music.default]
path = "${options.musicPath}"

[devices.echomini]
type = "echo-mini"
path = "${options.devicePath}"

[defaults]
music = "default"
device = "echomini"
`;

  await writeFile(configPath, content);
}

// =============================================================================
// Tests
// =============================================================================

describe('mass-storage sync: echo-mini device', () => {
  let fixturesAvailable: boolean;
  let ffmpegAvailable: boolean;
  let ffprobeAvailable: boolean;
  let goldbergPath: string;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    ffmpegAvailable = isFfmpegAvailable();
    ffprobeAvailable = isFfprobeAvailable();
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

  // ---------------------------------------------------------------------------
  // Basic sync
  // ---------------------------------------------------------------------------

  it('syncs FLAC collection to echo-mini device with correct structure, tags, and artwork', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        transferMode: 'portable',
      });

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);

      if (result.exitCode !== 0) {
        console.log('STDERR:', result.stderr.slice(0, 2000));
        console.log('JSON:', JSON.stringify(json, null, 2));
      }
      expect(result.exitCode).toBe(0);
      expect(json?.success).toBe(true);
      expect(json?.result?.completed).toBe(3);

      // Echo-mini has musicDir="" so files go at the device root
      // under artist/album/track structure
      const audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      // All files should be .m4a (AAC) since echo-mini doesn't support opus
      // and quality=low means lossy transcoding
      const extensions = getExtensions(audioFiles);
      for (const ext of extensions) {
        expect(ext).toBe('.m4a');
      }

      // All files should have non-zero size
      for (const file of audioFiles) {
        const stats = await stat(file);
        expect(stats.size).toBeGreaterThan(0);
      }

      // Verify directory structure: files are organized as artist/album/track
      // The goldberg-selections fixtures have artist "Synthetic Classics"
      // and album "Goldberg Selections"
      const hasArtistDir = audioFiles.some(
        (f) => f.includes('Synthetic Classics') || f.includes('Test Composer')
      );
      expect(hasArtistDir).toBe(true);

      // Verify artwork is embedded (transferMode=portable preserves artwork)
      if (ffprobeAvailable) {
        for (const file of audioFiles) {
          expect(hasEmbeddedArtwork(file)).toBe(true);
        }

        // Verify artwork is resized to fit echo-mini's 127px max
        const dims = getArtworkDimensions(audioFiles[0]!);
        if (dims) {
          expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(127);
        }
      }
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Incremental sync — add
  // ---------------------------------------------------------------------------

  it('incrementally adds only new tracks on second sync', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Set up first album via symlinks
      const album1Tracks = await getAlbumTracks(Albums.GOLDBERG_SELECTIONS);
      const album1Dir = join(collectionDir, 'album1');
      await mkdir(album1Dir);
      for (const track of album1Tracks) {
        await symlink(track.path, join(album1Dir, track.filename));
      }

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      // First sync: 3 tracks
      const { result: r1, json: j1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(3);

      let audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      // Record file mtimes to verify they are not re-written
      const initialMtimes = new Map<string, number>();
      for (const file of audioFiles) {
        const s = await stat(file);
        initialMtimes.set(file, s.mtimeMs);
      }

      // Add second album
      const album2Tracks = await getAlbumTracks(Albums.SYNTHETIC_TESTS);
      const album2Dir = join(collectionDir, 'album2');
      await mkdir(album2Dir);
      for (const track of album2Tracks) {
        await symlink(track.path, join(album2Dir, track.filename));
      }

      // Second sync: should only add 3 new tracks
      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r2.exitCode).toBe(0);
      expect(j2?.result?.completed).toBe(3); // Only new tracks

      audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(6); // Total: 3 + 3

      // Verify original files were not re-written
      for (const [file, mtime] of initialMtimes) {
        if (existsSync(file)) {
          const s = await stat(file);
          expect(s.mtimeMs).toBe(mtime);
        }
      }

      // Third sync: no-op
      const { result: r3, json: j3 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r3.exitCode).toBe(0);
      expect(j3?.result?.completed).toBe(0);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Incremental sync — remove
  // ---------------------------------------------------------------------------

  it('removes deleted source tracks with --delete flag', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Set up both albums
      const album1Tracks = await getAlbumTracks(Albums.GOLDBERG_SELECTIONS);
      const album1Dir = join(collectionDir, 'album1');
      await mkdir(album1Dir);
      for (const track of album1Tracks) {
        await symlink(track.path, join(album1Dir, track.filename));
      }

      const album2Tracks = await getAlbumTracks(Albums.SYNTHETIC_TESTS);
      const album2Dir = join(collectionDir, 'album2');
      await mkdir(album2Dir);
      for (const track of album2Tracks) {
        await symlink(track.path, join(album2Dir, track.filename));
      }

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      // Sync both albums: 6 tracks
      const { result: r1, json: j1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(6);

      let audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(6);

      // Remove album2 from source
      await rm(album2Dir, { recursive: true, force: true });

      // Sync with --delete: should remove album2 tracks
      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--delete',
        '--json',
      ]);
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);

      // Check plan: should have removed 3 tracks
      // After sync only album1's tracks remain
      audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Pre-existing unmanaged music
  // ---------------------------------------------------------------------------

  it('preserves pre-existing unmanaged music without --delete', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Place an unmanaged file on the "device" before syncing.
      // Echo-mini musicDir="" means music is at the root. Place it in a
      // typical artist/album structure.
      const unmanagedDir = join(devicePath, 'Some Artist', 'Some Album');
      await mkdir(unmanagedDir, { recursive: true });
      const unmanagedFile = join(unmanagedDir, '01 - Existing Track.m4a');
      // Create a small dummy file
      await writeFile(unmanagedFile, Buffer.alloc(1024, 0xff));

      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      // Sync without --delete: should add 3 tracks and leave unmanaged alone
      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(result.exitCode).toBe(0);
      expect(json?.result?.completed).toBe(3);

      // The unmanaged file should still exist (no --delete flag)
      expect(existsSync(unmanagedFile)).toBe(true);
      const unmanagedStats = await stat(unmanagedFile);
      expect(unmanagedStats.size).toBe(1024);

      // Repeat sync — still no --delete, unmanaged file should persist
      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r2.exitCode).toBe(0);
      // No new tracks to sync
      expect(j2?.result?.completed).toBe(0);
      // Unmanaged file still present
      expect(existsSync(unmanagedFile)).toBe(true);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Quality preset change: max (FLAC copy) -> high (AAC transcode)
  // ---------------------------------------------------------------------------

  it('re-transcodes when quality changes from max (FLAC copy) to high (AAC)', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Step 1: Sync with quality=max — copies FLAC files directly
      // Echo-mini supports flac, so quality=max will use source format
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'max',
        artwork: false,
      });

      const { result: r1, json: j1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);

      if (r1.exitCode !== 0) {
        console.log('Step 1 STDERR:', r1.stderr.slice(0, 2000));
      }
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(3);

      // Verify files are FLAC (direct copy at max quality)
      let audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);
      let extensions = getExtensions(audioFiles);
      for (const ext of extensions) {
        expect(ext).toBe('.flac');
      }

      // Step 2: Change quality to high — should re-transcode to AAC
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'high',
        artwork: false,
      });

      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);

      if (r2.exitCode !== 0) {
        console.log('Step 2 STDERR:', r2.stderr.slice(0, 2000));
      }
      expect(r2.exitCode).toBe(0);
      expect(j2?.result?.completed).toBe(3);

      // Verify files are now M4A (AAC transcoded)
      audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);
      extensions = getExtensions(audioFiles);
      for (const ext of extensions) {
        expect(ext).toBe('.m4a');
      }

      // Step 3: Verify idempotent — second sync at same quality does nothing
      const { result: r3, json: j3 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--dry-run',
        '--json',
      ]);
      expect(r3.exitCode).toBe(0);
      expect(j3?.plan?.tracksToAdd).toBe(0);
      expect(j3?.plan?.tracksToUpdate).toBe(0);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Transfer mode change: fast -> portable
  // ---------------------------------------------------------------------------

  it('shows tip about --force-transfer-mode when transfer mode changes', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Sync with transferMode=fast (strips embedded artwork)
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        transferMode: 'fast',
        artwork: false,
      });

      const { result: r1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r1.exitCode).toBe(0);

      let audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      // Change to transferMode=portable and sync again
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        transferMode: 'portable',
        artwork: false,
      });

      // Use non-JSON mode to check for the tip in human-readable output
      const r2 = await runCli(['--config', configPath, 'sync', '--device', 'echomini']);
      expect(r2.exitCode).toBe(0);

      // Should show the force-transfer-mode tip because existing tracks
      // were synced with a different transfer mode
      expect(r2.stdout).toContain('--force-transfer-mode');

      // No unnecessary re-transfers should happen (transfer mode change alone
      // doesn't trigger re-sync unless --force-transfer-mode is used)
      audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Artwork chroma handling: yuvj444p -> yuvj420p
  // ---------------------------------------------------------------------------

  it('converts artwork from yuvj444p to yuvj420p during sync', async () => {
    if (skipIfUnavailable()) return;
    if (!ffprobeAvailable) {
      console.log('Skipping: ffprobe not available');
      return;
    }

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Verify source artwork is yuvj444p (the goldberg fixtures have this)
      const sourceArtwork = join(goldbergPath, 'cover.jpg');
      const sourcePixFmt = getArtworkPixFmt(sourceArtwork);
      expect(sourcePixFmt).toBe('yuvj444p');

      // Sync with artwork enabled and portable transfer mode (preserves artwork)
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        transferMode: 'portable',
        artwork: true,
      });

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);

      if (result.exitCode !== 0) {
        console.log('STDERR:', result.stderr.slice(0, 2000));
      }
      expect(result.exitCode).toBe(0);
      expect(json?.result?.completed).toBe(3);

      // Check that the embedded artwork in synced files is yuvj420p
      const audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      for (const file of audioFiles) {
        const pixFmt = getArtworkPixFmt(file);
        // Should be yuvj420p (4:2:0) — the FFmpeg pipeline forces this
        // for compatibility with echo-mini and similar devices
        expect(pixFmt).toBeTruthy();
        expect(pixFmt).toBe('yuvj420p');
      }
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Codec preference: echo-mini doesn't support opus -> falls back to aac
  // ---------------------------------------------------------------------------

  it('falls back to aac when opus is preferred but not supported by echo-mini', async () => {
    if (skipIfUnavailable()) return;

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Configure codec preference with opus first, but echo-mini does NOT
      // support opus (its codec list: aac, alac, mp3, flac, ogg, wav).
      // The resolver should fall back to aac.
      const content = `version = 1

quality = "low"
artwork = false

[codec]
lossy = ["opus", "aac"]

[music.default]
path = "${goldbergPath}"

[devices.echomini]
type = "echo-mini"
path = "${devicePath}"

[defaults]
music = "default"
device = "echomini"
`;
      await writeFile(configPath, content);

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);

      if (result.exitCode !== 0) {
        console.log('STDERR:', result.stderr.slice(0, 2000));
        console.log('JSON:', JSON.stringify(json, null, 2));
      }
      expect(result.exitCode).toBe(0);
      expect(json?.success).toBe(true);
      expect(json?.result?.completed).toBe(3);

      // Verify output codec is AAC (.m4a), not Opus
      const audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      const extensions = getExtensions(audioFiles);
      for (const ext of extensions) {
        expect(ext).toBe('.m4a');
      }

      // The resolved codec should be aac, not opus
      // The codec field may not be present in JSON output — verify via file format instead
      // All files should be .m4a (AAC), already asserted above
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);
});
