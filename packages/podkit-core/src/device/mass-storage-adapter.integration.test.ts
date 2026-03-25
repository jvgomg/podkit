/**
 * Integration tests for MassStorageAdapter sync tag round-trips.
 *
 * Creates real audio files on a temp "device", writes sync tags via the
 * adapter, saves, re-opens, and verifies the tags are read back correctly
 * by the metadata reader + parseSyncTag.
 *
 * Requires FFmpeg (generates minimal audio files).
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { MassStorageAdapter, MassStorageTrack } from './mass-storage-adapter.js';
import type { DeviceCapabilities } from './capabilities.js';
import {
  parseSyncTag,
  writeSyncTag,
  buildAudioSyncTag,
  buildCopySyncTag,
} from '../sync/sync-tags.js';
import { MUSIC_DIR } from './mass-storage-utils.js';

// =============================================================================
// Helpers
// =============================================================================

const TEST_CAPABILITIES: DeviceCapabilities = {
  artworkSources: ['embedded'],
  artworkMaxResolution: 600,
  supportedAudioCodecs: ['flac', 'mp3', 'aac', 'ogg'],
  supportsVideo: false,
};

function createTempDevice(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'podkit-ms-integration-'));
}

function removeTempDevice(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function isFfmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Generate a minimal FLAC file in the device's Music/ directory */
function generateFlacOnDevice(
  mountPoint: string,
  relativePath: string,
  metadata?: { title?: string; artist?: string; album?: string }
): string {
  const absolutePath = path.join(mountPoint, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.5:sample_rate=44100',
    '-c:a',
    'flac',
    '-ar',
    '44100',
    '-metadata',
    `title=${metadata?.title ?? 'Test Song'}`,
    '-metadata',
    `artist=${metadata?.artist ?? 'Test Artist'}`,
    '-metadata',
    `album=${metadata?.album ?? 'Test Album'}`,
    absolutePath,
  ];
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  return absolutePath;
}

/** Generate a minimal M4A file in the device's Music/ directory */
function generateM4aOnDevice(
  mountPoint: string,
  relativePath: string,
  metadata?: { title?: string; artist?: string; album?: string }
): string {
  const absolutePath = path.join(mountPoint, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.5:sample_rate=44100',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-metadata',
    `title=${metadata?.title ?? 'Test Song'}`,
    '-metadata',
    `artist=${metadata?.artist ?? 'Test Artist'}`,
    '-metadata',
    `album=${metadata?.album ?? 'Test Album'}`,
    '-f',
    'ipod',
    absolutePath,
  ];
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  return absolutePath;
}

// =============================================================================
// Tests
// =============================================================================

describe('MassStorageAdapter sync tag round-trip', () => {
  let mountPoint: string;
  const ffmpegAvailable = isFfmpegAvailable();

  beforeEach(() => {
    mountPoint = createTempDevice();
  });

  afterEach(() => {
    removeTempDevice(mountPoint);
  });

  function skipIfNoFfmpeg() {
    if (!ffmpegAvailable) {
      console.log('Skipping: ffmpeg not available');
      return true;
    }
    return false;
  }

  test('FLAC: sync tag written by adapter is read back on re-open', async () => {
    if (skipIfNoFfmpeg()) return;

    const relPath = `${MUSIC_DIR}/Test Artist/Test Album/01 - Test Song.flac`;
    generateFlacOnDevice(mountPoint, relPath, {
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
    });

    // Session 1: open, write sync tag, save
    const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks1 = adapter1.getTracks();
    expect(tracks1).toHaveLength(1);

    const syncTag = buildAudioSyncTag('high', 'vbr', undefined, 'optimized');
    const comment = writeSyncTag(null, syncTag);
    adapter1.updateTrack(tracks1[0]!, { comment });
    await adapter1.save();
    adapter1.close();

    // Session 2: re-open and verify
    const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks2 = adapter2.getTracks();
    expect(tracks2).toHaveLength(1);

    const readComment = tracks2[0]!.comment;
    expect(readComment).toBeDefined();

    const parsed = parseSyncTag(readComment!);
    expect(parsed).not.toBeNull();
    expect(parsed!.quality).toBe('high');
    expect(parsed!.encoding).toBe('vbr');
    expect(parsed!.transferMode).toBe('optimized');
    adapter2.close();
  });

  test('FLAC: sync tag with artwork hash survives round-trip', async () => {
    if (skipIfNoFfmpeg()) return;

    const relPath = `${MUSIC_DIR}/Artist/Album/01 - Song.flac`;
    generateFlacOnDevice(mountPoint, relPath);

    // Session 1: write sync tag with artwork hash
    const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks1 = adapter1.getTracks();

    const syncTag = buildAudioSyncTag('high', 'vbr', undefined, 'optimized');
    syncTag.artworkHash = 'a1b2c3d4';
    const comment = writeSyncTag(null, syncTag);
    adapter1.updateTrack(tracks1[0]!, { comment });
    await adapter1.save();
    adapter1.close();

    // Session 2: verify artwork hash is preserved
    const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks2 = adapter2.getTracks();
    const parsed = parseSyncTag(tracks2[0]!.comment!);
    expect(parsed).not.toBeNull();
    expect(parsed!.artworkHash).toBe('a1b2c3d4');
    adapter2.close();
  });

  test('M4A: sync tag written by adapter is read back on re-open', async () => {
    if (skipIfNoFfmpeg()) return;

    const relPath = `${MUSIC_DIR}/Test Artist/Test Album/01 - Test Song.m4a`;
    generateM4aOnDevice(mountPoint, relPath, {
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
    });

    // Session 1: write sync tag
    const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks1 = adapter1.getTracks();
    expect(tracks1).toHaveLength(1);

    const syncTag = buildCopySyncTag('fast');
    const comment = writeSyncTag(null, syncTag);
    adapter1.updateTrack(tracks1[0]!, { comment });
    await adapter1.save();
    adapter1.close();

    // Session 2: verify
    const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks2 = adapter2.getTracks();
    const parsed = parseSyncTag(tracks2[0]!.comment!);
    expect(parsed).not.toBeNull();
    expect(parsed!.quality).toBe('copy');
    expect(parsed!.transferMode).toBe('fast');
    adapter2.close();
  });

  test('sync tag update overwrites previous tag on re-open', async () => {
    if (skipIfNoFfmpeg()) return;

    const relPath = `${MUSIC_DIR}/Artist/Album/01 - Song.flac`;
    generateFlacOnDevice(mountPoint, relPath);

    // Session 1: write initial sync tag
    const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tag1 = buildAudioSyncTag('high', 'vbr', undefined, 'optimized');
    adapter1.updateTrack(adapter1.getTracks()[0]!, { comment: writeSyncTag(null, tag1) });
    await adapter1.save();
    adapter1.close();

    // Session 2: update sync tag to different quality
    const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const tracks2 = adapter2.getTracks();
    const tag2 = buildAudioSyncTag('medium', 'cbr', undefined, 'fast');
    adapter2.updateTrack(tracks2[0]!, { comment: writeSyncTag(tracks2[0]!.comment, tag2) });
    await adapter2.save();
    adapter2.close();

    // Session 3: verify final value
    const adapter3 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
    const parsed = parseSyncTag(adapter3.getTracks()[0]!.comment!);
    expect(parsed).not.toBeNull();
    expect(parsed!.quality).toBe('medium');
    expect(parsed!.encoding).toBe('cbr');
    expect(parsed!.transferMode).toBe('fast');
    adapter3.close();
  });

  test('addTrack with comment persists sync tag to new file', async () => {
    if (skipIfNoFfmpeg()) return;

    // Generate a source file outside the device
    const sourceDir = createTempDevice();
    const sourcePath = path.join(sourceDir, 'source.flac');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.5:sample_rate=44100',
        '-c:a',
        'flac',
        '-ar',
        '44100',
        '-metadata',
        'title=New Song',
        '-metadata',
        'artist=New Artist',
        '-metadata',
        'album=New Album',
        sourcePath,
      ],
      { stdio: 'pipe' }
    );

    try {
      // Session 1: add track with sync tag, copy file, save
      const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
      const syncTag = buildAudioSyncTag('high', 'vbr');
      syncTag.artworkHash = 'deadbeef';
      const comment = writeSyncTag(null, syncTag);

      const track = adapter1.addTrack({
        title: 'New Song',
        artist: 'New Artist',
        album: 'New Album',
        trackNumber: 1,
        filetype: 'flac',
        comment,
      });

      adapter1.copyTrackFile(track, sourcePath);
      await adapter1.save();
      adapter1.close();

      // Session 2: re-open and verify the sync tag was written to the file
      const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
      const tracks2 = adapter2.getTracks();
      expect(tracks2).toHaveLength(1);

      const parsed = parseSyncTag(tracks2[0]!.comment!);
      expect(parsed).not.toBeNull();
      expect(parsed!.quality).toBe('high');
      expect(parsed!.encoding).toBe('vbr');
      expect(parsed!.artworkHash).toBe('deadbeef');
      adapter2.close();
    } finally {
      removeTempDevice(sourceDir);
    }
  });

  test('managed file status survives round-trip with sync tags', async () => {
    if (skipIfNoFfmpeg()) return;

    const sourceDir = createTempDevice();
    const sourcePath = path.join(sourceDir, 'source.flac');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.5:sample_rate=44100',
        '-c:a',
        'flac',
        '-ar',
        '44100',
        '-metadata',
        'title=Song',
        '-metadata',
        'artist=Artist',
        '-metadata',
        'album=Album',
        sourcePath,
      ],
      { stdio: 'pipe' }
    );

    try {
      // Session 1: add, copy, tag, save
      const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
      const track = adapter1.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        filetype: 'flac',
        comment: writeSyncTag(null, buildAudioSyncTag('high', 'vbr')),
      });
      adapter1.copyTrackFile(track, sourcePath);
      await adapter1.save();
      adapter1.close();

      // Session 2: verify managed status
      const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES);
      const tracks2 = adapter2.getTracks();
      expect(tracks2).toHaveLength(1);
      expect((tracks2[0] as MassStorageTrack).managed).toBe(true);

      // Differ would see this as matching (same sync tag)
      const parsed = parseSyncTag(tracks2[0]!.comment!);
      expect(parsed!.quality).toBe('high');
      adapter2.close();
    } finally {
      removeTempDevice(sourceDir);
    }
  });
});
