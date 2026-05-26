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
import { existsSync, statSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFixturesExist, requireBinary } from '@podkit/e2e-shared';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { getAlbumDir, Albums, getAlbumTracks } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

requireBinary('ffmpeg', 'brew install ffmpeg (macOS) or apt install ffmpeg (Linux)', ['-version']);
requireBinary('ffprobe', 'ships with ffmpeg', ['-version']);
requireBinary('metaflac', 'brew install flac (macOS) or apt install flac (Linux)');
ensureFixturesExist('goldberg-selections');

// =============================================================================
// Helpers
// =============================================================================

interface FlacMetadata {
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  trackNumber: number;
}

/**
 * Generate a 1-second FLAC file with the given Vorbis-comment metadata.
 * No artwork — keeps these tests focused on path-template behaviour.
 */
function writeFlacWithMetadata(filePath: string, meta: FlacMetadata): void {
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1:sample_rate=44100',
    '-c:a',
    'flac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-metadata',
    `title=${meta.title}`,
    '-metadata',
    `artist=${meta.artist}`,
    '-metadata',
    `album=${meta.album}`,
    '-metadata',
    `track=${meta.trackNumber}`,
  ];
  if (meta.albumArtist !== undefined) {
    args.push('-metadata', `ALBUMARTIST=${meta.albumArtist}`);
  }
  args.push(filePath);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
}

/**
 * Rewrite a single Vorbis-comment tag on an existing FLAC file (in place).
 * Audio data is untouched.
 */
function retagFlac(filePath: string, key: string, value: string): void {
  execFileSync('metaflac', [`--remove-tag=${key}`, filePath], { stdio: 'pipe' });
  execFileSync('metaflac', [`--set-tag=${key}=${value}`, filePath], { stdio: 'pipe' });
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
    pathTemplate?: string;
  }
): Promise<void> {
  const quality = options.quality ?? 'low';
  const artwork = options.artwork !== undefined ? options.artwork : true;
  const transferMode = options.transferMode ? `transferMode = "${options.transferMode}"` : '';
  const pathTemplate = options.pathTemplate
    ? `pathTemplate = ${JSON.stringify(options.pathTemplate)}`
    : '';

  const content = `version = 2

quality = "${quality}"
artwork = ${artwork}
${transferMode}

[music.default]
path = "${options.musicPath}"

[devices.echomini]
type = "echo-mini"
path = "${options.devicePath}"
${pathTemplate}

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
  let goldbergPath: string;

  beforeAll(() => {
    goldbergPath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
  });

  // ---------------------------------------------------------------------------
  // Basic sync
  // ---------------------------------------------------------------------------

  it('syncs FLAC collection to echo-mini device with correct structure, tags, and artwork', async () => {
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
      for (const file of audioFiles) {
        expect(hasEmbeddedArtwork(file)).toBe(true);
      }

      // Verify artwork is resized to fit echo-mini's 127px max
      const dims = getArtworkDimensions(audioFiles[0]!);
      if (dims) {
        expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(127);
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
  // --delete scoping: managed vs unmanaged files (TASK-261)
  // ---------------------------------------------------------------------------

  it('--delete removes managed tracks no longer in source but preserves unmanaged files', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Place an unmanaged file on the device BEFORE syncing.
      // This file was NOT placed by podkit — it simulates a user-added file.
      const unmanagedDir = join(devicePath, 'Some Artist', 'Some Album');
      await mkdir(unmanagedDir, { recursive: true });
      const unmanagedFile = join(unmanagedDir, '01 - Existing Track.m4a');
      await writeFile(unmanagedFile, Buffer.alloc(1024, 0xff));

      // Set up two albums in the collection via symlinks
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
      // 6 managed + 1 unmanaged = 7
      expect(audioFiles.length).toBe(7);

      // Remove album2 from source
      await rm(album2Dir, { recursive: true, force: true });

      // Sync with --delete: removes album2 tracks (no longer in source).
      // Unmanaged files are invisible to the sync engine and not removed.
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

      // Only 3 removals: album2's managed tracks. Unmanaged file is untouched.
      expect(j2?.result?.completed).toBe(3);

      audioFiles = await findDeviceAudioFiles(devicePath, '');

      // album1's 3 managed tracks + 1 unmanaged file = 4
      expect(audioFiles.length).toBe(4);

      // Verify album1 tracks still exist (Synthetic Classics)
      const album1Files = audioFiles.filter((f) => f.includes('Synthetic Classics'));
      expect(album1Files.length).toBe(3);

      // Verify album2 tracks are GONE (Test Tones)
      const album2Files = audioFiles.filter((f) => f.includes('Test Tones'));
      expect(album2Files.length).toBe(0);

      // Unmanaged file is preserved — --delete only targets managed files
      expect(existsSync(unmanagedFile)).toBe(true);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Collision detection with unmanaged file (dry-run)
  // ---------------------------------------------------------------------------

  it('detects collision with unmanaged file at target path during dry-run', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Place an unmanaged file at the EXACT path podkit would generate for
      // the first Goldberg Selections track.
      //
      // Track metadata: artist="Podkit Test Generator", album="Synthetic Classics",
      // title="Harmony", trackNumber=1. With quality=low (AAC), extension=.m4a.
      // echo-mini musicDir="" so path is: Podkit Test Generator/Synthetic Classics/01 - Harmony.m4a
      const collisionDir = join(devicePath, 'Podkit Test Generator', 'Synthetic Classics');
      await mkdir(collisionDir, { recursive: true });
      const collisionFile = join(collisionDir, '01 - Harmony.m4a');
      await writeFile(collisionFile, Buffer.alloc(1024, 0xff));

      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      // Run sync --dry-run --json — should detect the collision
      const { json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--dry-run',
        '--json',
      ]);

      // The CLI should report failure due to collision
      expect(json?.success).toBe(false);
      expect(json?.error).toBeDefined();
      expect(json!.error).toContain('unmanaged');
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Pre-existing unmanaged music
  // ---------------------------------------------------------------------------

  it('preserves pre-existing unmanaged music without --delete', async () => {
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
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Configure codec preference with opus first, but echo-mini does NOT
      // support opus (its codec list: aac, alac, mp3, flac, ogg, wav).
      // The resolver should fall back to aac.
      const content = `version = 2

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

  // ---------------------------------------------------------------------------
  // Doctor: orphan detection and cleanup for mass-storage devices
  // ---------------------------------------------------------------------------

  it('detects and repairs orphan files on mass-storage device via doctor', async () => {
    interface DoctorCheckOutput {
      id: string;
      name: string;
      status: 'pass' | 'fail' | 'warn' | 'skip';
      summary: string;
      repairable: boolean;
      details?: Record<string, unknown>;
    }

    interface DoctorOutput {
      healthy: boolean;
      mountPoint: string;
      deviceModel: string;
      checks: DoctorCheckOutput[];
    }

    interface RepairOutput {
      success: boolean;
      summary: string;
      checkId: string;
      dryRun: boolean;
      details?: Record<string, unknown>;
    }

    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');

    try {
      // Step 1: Sync 3 tracks to the device
      await writeEchoMiniConfig(configPath, {
        musicPath: goldbergPath,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(syncResult.exitCode).toBe(0);
      expect(syncJson?.result?.completed).toBe(3);

      // Record managed files for later verification
      const managedFiles = await findDeviceAudioFiles(devicePath, '');
      expect(managedFiles.length).toBe(3);

      // Step 2: Place an unmanaged (orphan) file on the device
      const orphanDir = join(devicePath, 'Orphan Artist', 'Orphan Album');
      await mkdir(orphanDir, { recursive: true });
      const orphanFile = join(orphanDir, '01 - Orphan.m4a');
      await writeFile(orphanFile, Buffer.alloc(2048, 0xaa));
      expect(existsSync(orphanFile)).toBe(true);

      // Step 3: Run podkit doctor — should detect the orphan.
      // --no-system: keep the test focused on device-scope behaviour; see
      // test-packages/e2e-host-tests/src/commands/doctor.e2e.test.ts for rationale.
      const { result: doctorResult1, json: doctorJson1 } = await runCliJson<DoctorOutput>([
        '--config',
        configPath,
        'doctor',
        '--device',
        'echomini',
        '--no-system',
        '--json',
      ]);

      if (doctorResult1.exitCode !== 0) {
        console.log('Doctor STDERR:', doctorResult1.stderr.slice(0, 2000));
      }

      expect(doctorJson1).not.toBeNull();

      const orphanCheck1 = doctorJson1!.checks.find((c) => c.id === 'orphan-files-mass-storage');
      expect(orphanCheck1).toBeDefined();
      expect(orphanCheck1!.status).toBe('warn');
      expect(orphanCheck1!.repairable).toBe(true);

      // Verify details contain orphan count and wasted bytes
      const details1 = orphanCheck1!.details as Record<string, unknown>;
      expect(details1.orphanCount).toBe(1);
      expect(details1.wastedBytes as number).toBeGreaterThan(0);

      // Step 4: Run podkit doctor --repair to clean up the orphan
      const { result: repairResult, json: repairJson } = await runCliJson<RepairOutput>([
        '--config',
        configPath,
        'doctor',
        '--repair',
        'orphan-files-mass-storage',
        '--device',
        'echomini',
        '--json',
      ]);

      if (repairResult.exitCode !== 0) {
        console.log('Repair STDERR:', repairResult.stderr.slice(0, 2000));
        console.log('Repair JSON:', JSON.stringify(repairJson, null, 2));
      }
      expect(repairResult.exitCode).toBe(0);
      expect(repairJson).not.toBeNull();
      expect(repairJson!.success).toBe(true);

      // Step 5: Verify the orphan file was deleted
      expect(existsSync(orphanFile)).toBe(false);

      // Step 6: Verify managed tracks still exist
      for (const file of managedFiles) {
        expect(existsSync(file)).toBe(true);
      }

      // Step 7: Run doctor again — should pass now
      const { result: doctorResult2, json: doctorJson2 } = await runCliJson<DoctorOutput>([
        '--config',
        configPath,
        'doctor',
        '--device',
        'echomini',
        '--no-system',
        '--json',
      ]);

      expect(doctorResult2.exitCode).toBe(0);
      expect(doctorJson2).not.toBeNull();

      const orphanCheck2 = doctorJson2!.checks.find((c) => c.id === 'orphan-files-mass-storage');
      expect(orphanCheck2).toBeDefined();
      expect(orphanCheck2!.status).toBe('pass');
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Album-artist paths: compilation grouping (TASK-263)
  // ---------------------------------------------------------------------------

  it('groups compilation tracks under albumArtist directory', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Compilation: three tracks with different per-track artist values but a
      // shared "Various Artists" albumArtist. They should land in one directory.
      writeFlacWithMetadata(join(collectionDir, '01-track-a.flac'), {
        title: 'Track A',
        artist: 'Artist One',
        albumArtist: 'Various Artists',
        album: 'Best of 2026',
        trackNumber: 1,
      });
      writeFlacWithMetadata(join(collectionDir, '02-track-b.flac'), {
        title: 'Track B',
        artist: 'Artist Two',
        albumArtist: 'Various Artists',
        album: 'Best of 2026',
        trackNumber: 2,
      });
      writeFlacWithMetadata(join(collectionDir, '03-track-c.flac'), {
        title: 'Track C',
        artist: 'Artist Three',
        albumArtist: 'Various Artists',
        album: 'Best of 2026',
        trackNumber: 3,
      });

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
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

      const audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(3);

      // All three tracks should live under "Various Artists/Best of 2026/"
      // — not scattered across per-artist directories.
      const inVariousArtists = audioFiles.filter((f) =>
        f.includes('/Various Artists/Best of 2026/')
      );
      expect(inVariousArtists.length).toBe(3);

      // Per-artist directories must NOT exist
      expect(existsSync(join(devicePath, 'Artist One'))).toBe(false);
      expect(existsSync(join(devicePath, 'Artist Two'))).toBe(false);
      expect(existsSync(join(devicePath, 'Artist Three'))).toBe(false);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 120000);

  // ---------------------------------------------------------------------------
  // Self-healing relocate: albumArtist metadata change (TASK-263)
  // ---------------------------------------------------------------------------

  it('relocates files on device when source albumArtist changes', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      const sourceFile = join(collectionDir, '01-only-track.flac');
      writeFlacWithMetadata(sourceFile, {
        title: 'Only Track',
        artist: 'Performer',
        albumArtist: 'Origin Artist',
        album: 'The Album',
        trackNumber: 1,
      });

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
      });

      // First sync
      const { result: r1, json: j1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(1);

      const originDir = join(devicePath, 'Origin Artist', 'The Album');
      const filesBefore = await findDeviceAudioFiles(devicePath, '');
      expect(filesBefore.length).toBe(1);
      expect(filesBefore[0]!.startsWith(originDir + '/')).toBe(true);
      const sizeBefore = statSync(filesBefore[0]!).size;

      // Mutate albumArtist on source — should trigger a relocate on next sync.
      retagFlac(sourceFile, 'ALBUMARTIST', 'Renamed Artist');

      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);

      const filesAfter = await findDeviceAudioFiles(devicePath, '');
      expect(filesAfter.length).toBe(1);

      const newDir = join(devicePath, 'Renamed Artist', 'The Album');
      expect(filesAfter[0]!.startsWith(newDir + '/')).toBe(true);
      // File extension preserved (still .m4a from initial transcode)
      expect(filesAfter[0]!.endsWith('.m4a')).toBe(true);

      // Old origin directory must be empty (file was moved, not re-transcoded).
      // The adapter may also remove the now-empty dir tree; tolerate either.
      if (existsSync(originDir)) {
        const remaining = await readdir(originDir);
        expect(remaining.length).toBe(0);
      }

      // No bytes transferred — the file was relocated via fs.rename and had
      // its tags rewritten in place, not re-transcoded. The on-disk size
      // may shift slightly when taglib rewrites tags, so check the transfer
      // counter rather than file size.
      expect(j2?.result?.bytesTransferred).toBe(0);
      // The file should still be smaller than 2× the original (sanity check
      // against accidental duplication / re-transcode).
      const sizeAfter = statSync(filesAfter[0]!).size;
      expect(sizeAfter).toBeLessThan(sizeBefore * 2);

      // Convergence: the relocate also rewrote the on-disk albumArtist tag,
      // so a third sync sees no diff at all and produces an empty plan.
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
      expect(j3?.result?.bytesTransferred).toBe(0);

      const filesAfterThird = await findDeviceAudioFiles(devicePath, '');
      expect(filesAfterThird.length).toBe(1);
      expect(filesAfterThird[0]!.startsWith(newDir + '/')).toBe(true);
      expect(statSync(filesAfterThird[0]!).size).toBe(sizeAfter);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Custom pathTemplate via config (TASK-263)
  // ---------------------------------------------------------------------------

  it('relocates files when device pathTemplate changes between syncs', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      writeFlacWithMetadata(join(collectionDir, '01-song-one.flac'), {
        title: 'Song One',
        artist: 'Solo Artist',
        albumArtist: 'Solo Artist',
        album: 'Debut',
        trackNumber: 1,
      });

      // First sync with default template (albumArtist/album/track - title)
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
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
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(1);

      const defaultDir = join(devicePath, 'Solo Artist', 'Debut');
      const filesBefore = await findDeviceAudioFiles(devicePath, '');
      expect(filesBefore.length).toBe(1);
      expect(filesBefore[0]!.startsWith(defaultDir + '/')).toBe(true);

      // Re-write config with a custom pathTemplate that nests under a top-level
      // "Music" directory. Re-sync should relocate the existing file rather
      // than re-transcoding it.
      const customTemplate = 'Library/{albumArtist}/{album}/{title}{ext}';
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
        pathTemplate: customTemplate,
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
        console.log('STDERR:', r2.stderr.slice(0, 2000));
      }
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);

      const filesAfter = await findDeviceAudioFiles(devicePath, '');
      expect(filesAfter.length).toBe(1);
      const newDir = join(devicePath, 'Library', 'Solo Artist', 'Debut');
      expect(filesAfter[0]!.startsWith(newDir + '/')).toBe(true);

      // Filename no longer carries the "01 - " trackNumber prefix under the
      // new template — verifies the full template was honoured, not just the
      // directory portion.
      const newFilename = filesAfter[0]!.slice(newDir.length + 1);
      expect(newFilename.startsWith('01 ')).toBe(false);
      expect(newFilename.endsWith('.m4a')).toBe(true);

      // Re-sync was a relocate, not a re-transcode: no bytes transferred.
      expect(j2?.result?.bytesTransferred).toBe(0);

      // The old "Solo Artist/Debut/" dir tree must not still hold the file.
      // The adapter may leave the empty directory or prune it — tolerate either,
      // but it must NOT contain the original file.
      if (existsSync(defaultDir)) {
        const remaining = await readdir(defaultDir);
        expect(remaining.length).toBe(0);
      }

      // Third sync with same template: no-op.
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
  // pathTemplate change combined with adding new music in the same op (TASK-263)
  // ---------------------------------------------------------------------------

  it('relocates existing files and adds new files in the same sync when pathTemplate changes', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Initial source: one track.
      writeFlacWithMetadata(join(collectionDir, '01-existing-track.flac'), {
        title: 'Existing Track',
        artist: 'Alpha Artist',
        albumArtist: 'Alpha Artist',
        album: 'Alpha Album',
        trackNumber: 1,
      });

      // First sync with default template.
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
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
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(1);

      const oldDir = join(devicePath, 'Alpha Artist', 'Alpha Album');
      const filesBefore = await findDeviceAudioFiles(devicePath, '');
      expect(filesBefore.length).toBe(1);
      expect(filesBefore[0]!.startsWith(oldDir + '/')).toBe(true);
      const existingSizeBefore = statSync(filesBefore[0]!).size;

      // Add a brand-new source track AND switch to a custom template — in the
      // same re-sync op the adapter must (a) relocate the existing track to
      // the new template and (b) transfer the new one straight to the new
      // template, with no path collisions between the two passes.
      writeFlacWithMetadata(join(collectionDir, '02-new-track.flac'), {
        title: 'New Track',
        artist: 'Beta Artist',
        albumArtist: 'Beta Artist',
        album: 'Beta Album',
        trackNumber: 2,
      });

      const customTemplate = 'Library/{albumArtist}/{album}/{title}{ext}';
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
        pathTemplate: customTemplate,
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
        console.log('STDERR:', r2.stderr.slice(0, 2000));
      }
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);

      const filesAfter = await findDeviceAudioFiles(devicePath, '');
      expect(filesAfter.length).toBe(2);

      const relocatedDir = join(devicePath, 'Library', 'Alpha Artist', 'Alpha Album');
      const newDir = join(devicePath, 'Library', 'Beta Artist', 'Beta Album');

      const relocated = filesAfter.filter((f) => f.startsWith(relocatedDir + '/'));
      const added = filesAfter.filter((f) => f.startsWith(newDir + '/'));
      expect(relocated.length).toBe(1);
      expect(added.length).toBe(1);

      // Relocated track is the same file: byte-equal to the pre-sync version.
      expect(statSync(relocated[0]!).size).toBe(existingSizeBefore);

      // Old top-level "Alpha Artist" dir must not still hold a file.
      if (existsSync(oldDir)) {
        const remaining = await readdir(oldDir);
        expect(remaining.length).toBe(0);
      }

      // Third sync: no transfers — everything is in place.
      const { result: r3, json: j3 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r3.exitCode).toBe(0);
      expect(j3?.result?.bytesTransferred).toBe(0);

      // File set is identical after the no-op third sync.
      const filesFinal = await findDeviceAudioFiles(devicePath, '');
      expect(filesFinal.length).toBe(2);
      expect(filesFinal.filter((f) => f.startsWith(relocatedDir + '/')).length).toBe(1);
      expect(filesFinal.filter((f) => f.startsWith(newDir + '/')).length).toBe(1);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // pathTemplate change combined with --delete and an add in the same op
  // (TASK-263)
  // ---------------------------------------------------------------------------

  it('relocates, adds, and deletes in one sync when pathTemplate changes with --delete', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Initial source: two tracks (one will be kept-and-relocated, the other
      // will be removed from source before the second sync).
      writeFlacWithMetadata(join(collectionDir, '01-keeper.flac'), {
        title: 'Keeper',
        artist: 'Stay Artist',
        albumArtist: 'Stay Artist',
        album: 'Stay Album',
        trackNumber: 1,
      });
      const doomedSource = join(collectionDir, '02-doomed.flac');
      writeFlacWithMetadata(doomedSource, {
        title: 'Doomed',
        artist: 'Gone Artist',
        albumArtist: 'Gone Artist',
        album: 'Gone Album',
        trackNumber: 1,
      });

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
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
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(2);

      const keeperOldDir = join(devicePath, 'Stay Artist', 'Stay Album');
      const doomedOldDir = join(devicePath, 'Gone Artist', 'Gone Album');
      const before = await findDeviceAudioFiles(devicePath, '');
      expect(before.length).toBe(2);
      const keeperBefore = before.find((f) => f.startsWith(keeperOldDir + '/'));
      const doomedBefore = before.find((f) => f.startsWith(doomedOldDir + '/'));
      expect(keeperBefore).toBeDefined();
      expect(doomedBefore).toBeDefined();
      const keeperSizeBefore = statSync(keeperBefore!).size;

      // Remove the doomed source, add a third (new) source, switch template.
      await rm(doomedSource);
      writeFlacWithMetadata(join(collectionDir, '03-fresh.flac'), {
        title: 'Fresh',
        artist: 'Fresh Artist',
        albumArtist: 'Fresh Artist',
        album: 'Fresh Album',
        trackNumber: 1,
      });

      const customTemplate = 'Library/{albumArtist}/{album}/{title}{ext}';
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
        pathTemplate: customTemplate,
      });

      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
        '--delete',
      ]);
      if (r2.exitCode !== 0) {
        console.log('STDERR:', r2.stderr.slice(0, 2000));
      }
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);

      const after = await findDeviceAudioFiles(devicePath, '');
      // Final state: keeper relocated, fresh added, doomed deleted = 2 files.
      expect(after.length).toBe(2);

      const keeperNewDir = join(devicePath, 'Library', 'Stay Artist', 'Stay Album');
      const freshNewDir = join(devicePath, 'Library', 'Fresh Artist', 'Fresh Album');

      const keeperAfter = after.find((f) => f.startsWith(keeperNewDir + '/'));
      const freshAfter = after.find((f) => f.startsWith(freshNewDir + '/'));
      expect(keeperAfter).toBeDefined();
      expect(freshAfter).toBeDefined();

      // Keeper was relocated, not re-transcoded.
      expect(statSync(keeperAfter!).size).toBe(keeperSizeBefore);

      // Doomed track must be gone from BOTH the old and the new template paths.
      const doomedNewDir = join(devicePath, 'Library', 'Gone Artist', 'Gone Album');
      expect(after.some((f) => f.startsWith(doomedOldDir + '/'))).toBe(false);
      expect(after.some((f) => f.startsWith(doomedNewDir + '/'))).toBe(false);

      // Old directories should be empty (or pruned).
      for (const dir of [keeperOldDir, doomedOldDir]) {
        if (existsSync(dir)) {
          const remaining = await readdir(dir);
          expect(remaining.length).toBe(0);
        }
      }

      // Follow-up sync is a no-op for transfers.
      const { result: r3, json: j3 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
        '--delete',
      ]);
      expect(r3.exitCode).toBe(0);
      expect(j3?.result?.bytesTransferred).toBe(0);
      const final = await findDeviceAudioFiles(devicePath, '');
      expect(final.length).toBe(2);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // Headline convergence invariant (TASK-327)
  //
  // For every metadata field the differ tracks, mutating the source tag and
  // running two consecutive syncs must converge: the second sync produces an
  // empty plan. Failure mode this guards against: pre-fix mass-storage
  // updated metadata in memory only, so the same diff resurfaced forever.
  // ---------------------------------------------------------------------------

  it('mass-storage converges after metadata changes in at most one re-sync', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      // Use a static path template so albumArtist/album/year edits do NOT
      // perturb the on-device filename — this isolates the convergence test
      // to the tag-rewrite path, separate from the relocate path covered
      // above.
      const sourceFile = join(collectionDir, '01-converge.flac');
      writeFlacWithMetadata(sourceFile, {
        title: 'Converge',
        artist: 'Performer',
        albumArtist: 'Original AA',
        album: 'Original Album',
        trackNumber: 1,
      });
      // Seed extra fields not handled by writeFlacWithMetadata so the
      // differ has more axes to flag if any field fails to converge.
      retagFlac(sourceFile, 'GENRE', 'Original Genre');
      retagFlac(sourceFile, 'DATE', '2010');

      // Stable path template — keeps the file at a fixed location regardless
      // of which metadata field changes.
      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
        pathTemplate: 'Library/{title}{ext}',
      });

      // First sync — populate the device.
      const { result: r1, json: j1 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r1.exitCode).toBe(0);
      expect(j1?.result?.completed).toBe(1);

      // Mutate every metadata-correction field the differ tracks.
      retagFlac(sourceFile, 'ALBUMARTIST', 'New AA');
      retagFlac(sourceFile, 'ALBUM', 'New Album');
      retagFlac(sourceFile, 'GENRE', 'New Genre');
      retagFlac(sourceFile, 'DATE', '2030');

      // Second sync: applies metadata + tag-rewrite. After this, the source
      // tags and the device-file tags must agree.
      const { result: r2, json: j2 } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        'echomini',
        '--json',
      ]);
      expect(r2.exitCode).toBe(0);
      expect(j2?.success).toBe(true);
      expect(j2?.result?.bytesTransferred).toBe(0); // metadata-only, no re-transcode

      // Third sync MUST be a no-op. This is the convergence invariant —
      // pre-fix mass-storage would still see the metadata diff here.
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
      expect(j3?.result?.bytesTransferred).toBe(0);
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 180000);

  // ---------------------------------------------------------------------------
  // transferMode plumbing through the CLI (TASK-327 follow-up)
  //
  // Proves the chain: TOML transferMode="portable" → config loader →
  // music-presenter → pipeline → adapter → on-disk tag write. The integration
  // tests cover each link in isolation with mocks; this test wires them all
  // together via the real CLI binary against a temp-directory device.
  // ---------------------------------------------------------------------------

  it('transferMode = "portable" in config produces files whose embedded tags match source', async () => {
    const devicePath = await createTempDevice();
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-ms-config-'));
    const configPath = join(configDir, 'config.toml');
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-ms-collection-'));

    try {
      const sourceFile = join(collectionDir, '01-portable.flac');
      writeFlacWithMetadata(sourceFile, {
        title: 'Portable Track',
        artist: 'Portable Artist',
        albumArtist: 'Portable AA',
        album: 'Portable Album',
        trackNumber: 5,
      });

      await writeEchoMiniConfig(configPath, {
        musicPath: collectionDir,
        devicePath,
        quality: 'low',
        artwork: false,
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
      }
      expect(result.exitCode).toBe(0);
      expect(json?.result?.completed).toBe(1);

      const audioFiles = await findDeviceAudioFiles(devicePath, '');
      expect(audioFiles.length).toBe(1);

      // Read the on-disk M4A's tags via ffprobe. Mass-storage always writes
      // tags regardless of mode, so passing through portable here proves the
      // CLI config plumbing accepted, validated, and propagated the field
      // (no exception, no value drop) — not a mode-specific behaviour
      // difference. Mode-specific differences (e.g. iPod fast vs portable)
      // live in `ipod-adapter.integration.test.ts`.
      const ffprobeOut = execSync(
        `ffprobe -v error -show_entries format_tags -of json "${audioFiles[0]!}"`,
        { encoding: 'utf-8' }
      );
      const tags = (JSON.parse(ffprobeOut).format?.tags ?? {}) as Record<string, string>;
      // M4A tag names are not standardised across ffprobe versions — check a
      // few common casings.
      const tag = (...keys: string[]): string | undefined => {
        for (const k of keys) {
          const v = tags[k] ?? tags[k.toLowerCase()] ?? tags[k.toUpperCase()];
          if (v !== undefined) return v;
        }
        return undefined;
      };
      expect(tag('title')).toBe('Portable Track');
      expect(tag('artist')).toBe('Portable Artist');
      expect(tag('album_artist', 'albumartist', 'aART')).toBe('Portable AA');
      expect(tag('album')).toBe('Portable Album');
      expect(tag('track')?.replace(/\/.*/, '')).toBe('5');
    } finally {
      await rm(devicePath, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
      await rm(collectionDir, { recursive: true, force: true });
    }
  }, 120000);
});
