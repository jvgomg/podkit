/**
 * Integration tests for IpodDeviceAdapter
 *
 * Tests verify that sync tags and normalization data survive a full
 * write → save → reopen → read cycle through the iPod database.
 * They complement the unit tests in sync-tags.test.ts and normalization.test.ts.
 *
 * ## Requirements
 * - gpod-tool (for creating test iPod environments)
 * - libgpod-node native bindings (for iPod database operations)
 * - FFmpeg (for generating test audio files)
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as mm from 'music-metadata';
import { requireFFmpeg, requireGpodTool } from '@podkit/test-fixtures';
import { requireLibgpodNode } from '@podkit/libgpod-node';
import { IpodDatabase } from '../ipod/database.js';
import { IpodDeviceAdapter } from './ipod-adapter.js';
import { buildAudioSyncTag, buildCopySyncTag, buildVideoSyncTag } from '../metadata/sync-tags.js';
import { GENERATIONS, type IpodGenerationId } from '@podkit/devices-ipod';
import { identifyCapabilities } from './resolve-capabilities.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import { replayGainToSoundcheck } from '../metadata/normalization.js';
import type { AudioNormalization } from '../metadata/normalization.js';

requireFFmpeg();
requireGpodTool();
requireLibgpodNode();

/** Test-local helper: build DeviceCapabilities from an IpodGenerationId. */
function capsForGeneration(id: IpodGenerationId): DeviceCapabilities {
  const gen = GENERATIONS[id];
  return identifyCapabilities({
    displayName: gen.displayName,
    generationId: id,
    checksumType: gen.checksumType,
    source: 'usb',
  });
}

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;

/**
 * Generate a minimal MP3 test file using FFmpeg's lavfi source.
 */
async function generateTestMP3(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-metadata',
      'title=Test Track',
      '-metadata',
      'artist=Test Artist',
      '-metadata',
      'album=Test Album',
      '-y',
      path,
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('IpodDeviceAdapter sync tag round-trip', () => {
  let createTestIpod: typeof import('@podkit/gpod-testing').createTestIpod;
  let mp3Path: string;

  beforeAll(async () => {
    const gpodTesting = await import('@podkit/gpod-testing');
    createTestIpod = gpodTesting.createTestIpod;

    testDir = await mkdtemp(join(tmpdir(), 'podkit-ipod-adapter-test-'));
    mp3Path = join(testDir, 'test.mp3');
    await generateTestMP3(mp3Path);
  });

  afterAll(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('audio sync tag survives save/reopen round-trip', async () => {
    const testIpod = await createTestIpod();

    try {
      const syncTag = buildAudioSyncTag('high', 'vbr');

      // Write phase: add track with sync tag and save
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Audio Tag Test',
          artist: 'Test Artist',
          album: 'Test Album',
          syncTag,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase: reopen database and verify sync tag
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('high');
        expect(readBack.syncTag!.encoding).toBe('vbr');
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('copy sync tag survives save/reopen round-trip', async () => {
    const testIpod = await createTestIpod();

    try {
      const syncTag = buildCopySyncTag('fast');

      // Write phase
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Copy Tag Test',
          artist: 'Test Artist',
          album: 'Test Album',
          syncTag,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('copy');
        expect(readBack.syncTag!.transferMode).toBe('fast');
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('writeSyncTag on existing track survives save/reopen round-trip', async () => {
    const testIpod = await createTestIpod();

    try {
      // Add track WITHOUT a sync tag
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Write Tag Later',
          artist: 'Test Artist',
          album: 'Test Album',
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Reopen, call writeSyncTag, and save again
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        // Track should have no sync tag yet
        expect(tracks[0]!.syncTag).toBeNull();

        adapter2.writeSyncTag(tracks[0]!, { quality: 'medium', encoding: 'cbr' });
        await adapter2.save();
      } finally {
        db2.close();
      }

      // Reopen and verify tag is present
      const db3 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter3 = new IpodDeviceAdapter(db3, capsForGeneration('classic_7g'));
        const tracks = adapter3.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('medium');
        expect(readBack.syncTag!.encoding).toBe('cbr');
      } finally {
        db3.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('clearSyncTag removes sync tag after save/reopen', async () => {
    const testIpod = await createTestIpod();

    try {
      const syncTag = buildAudioSyncTag('low', 'vbr');

      // Add track WITH a sync tag
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Clear Tag Test',
          artist: 'Test Artist',
          album: 'Test Album',
          syncTag,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Reopen, verify tag exists, then clear it and save
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0]!.syncTag).not.toBeNull();

        adapter2.clearSyncTag(tracks[0]!);
        await adapter2.save();
      } finally {
        db2.close();
      }

      // Reopen and verify tag is gone
      const db3 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter3 = new IpodDeviceAdapter(db3, capsForGeneration('classic_7g'));
        const tracks = adapter3.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0]!.syncTag).toBeNull();
      } finally {
        db3.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('sync tag with artworkHash survives save/reopen round-trip', async () => {
    const testIpod = await createTestIpod();

    try {
      const artworkHash = 'a1b2c3d4';
      const syncTag = buildCopySyncTag('optimized', artworkHash);

      // Write phase
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Artwork Hash Test',
          artist: 'Test Artist',
          album: 'Test Album',
          syncTag,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('copy');
        expect(readBack.syncTag!.transferMode).toBe('optimized');
        expect(readBack.syncTag!.artworkHash).toBe(artworkHash);
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('sync tag coexists with pre-existing comment text', async () => {
    const testIpod = await createTestIpod();

    try {
      const existingComment = 'Original comment text';
      const syncTag = buildAudioSyncTag('high', 'vbr');

      // Write phase: add track with a comment, then write a sync tag on top
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Comment Coexist Test',
          artist: 'Test Artist',
          album: 'Test Album',
          comment: existingComment,
        });
        track.copyFile(mp3Path);
        // Write sync tag after track was created with a plain comment
        adapter.writeSyncTag(track, syncTag);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase: verify both comment text and sync tag survive
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        // Sync tag should be present
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('high');
        expect(readBack.syncTag!.encoding).toBe('vbr');
        // Original comment text should still be present in the raw comment field
        expect(readBack.comment).toContain(existingComment);
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('video sync tag survives save/reopen round-trip', async () => {
    const testIpod = await createTestIpod();

    try {
      const syncTag = buildVideoSyncTag('high');

      // Write phase
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Video Tag Test',
          artist: 'Test Artist',
          album: 'Test Album',
          syncTag,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.syncTag).not.toBeNull();
        expect(readBack.syncTag!.quality).toBe('high');
        // Video tags have no encoding field
        expect(readBack.syncTag!.encoding).toBeUndefined();
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });
});

// =============================================================================
// Normalization → Soundcheck Round-Trip Tests
// =============================================================================

describe('IpodDeviceAdapter normalization round-trip', () => {
  let createTestIpod: typeof import('@podkit/gpod-testing').createTestIpod;
  let mp3Path: string;

  beforeAll(async () => {
    const gpodTesting = await import('@podkit/gpod-testing');
    createTestIpod = gpodTesting.createTestIpod;

    testDir = await mkdtemp(join(tmpdir(), 'podkit-ipod-adapter-norm-test-'));
    mp3Path = join(testDir, 'test.mp3');
    await generateTestMP3(mp3Path);
  });

  afterAll(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('addTrack converts normalization to soundcheck', async () => {
    const testIpod = await createTestIpod();

    try {
      const normalization: AudioNormalization = {
        source: 'replaygain-track',
        trackGain: -7.5,
        soundcheckValue: replayGainToSoundcheck(-7.5),
      };

      // Write phase: add track with normalization data
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Normalization Add Test',
          artist: 'Test Artist',
          album: 'Test Album',
          normalization,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Read phase: verify soundcheck was written
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.soundcheck).toBe(normalization.soundcheckValue);
        // Back-converted dB should be within rounding tolerance
        expect(readBack.normalization).toBeDefined();
        const readBackDb = readBack.normalization!.trackGain!;
        expect(Math.abs(readBackDb - -7.5)).toBeLessThan(0.1);
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('updateTrack converts normalization to soundcheck', async () => {
    const testIpod = await createTestIpod();

    try {
      // Write phase: add track WITHOUT normalization
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Normalization Update Test',
          artist: 'Test Artist',
          album: 'Test Album',
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Update phase: set normalization via updateTrack
      const normalization: AudioNormalization = {
        source: 'replaygain-track',
        trackGain: -3.2,
        soundcheckValue: replayGainToSoundcheck(-3.2),
      };

      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);
        // Should have no normalization initially (soundcheck defaults to 0)
        expect(tracks[0]!.normalization).toBeUndefined();

        adapter2.updateTrack(tracks[0]!, { normalization });
        await adapter2.save();
      } finally {
        db2.close();
      }

      // Read phase: verify soundcheck was written
      const db3 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter3 = new IpodDeviceAdapter(db3, capsForGeneration('classic_7g'));
        const tracks = adapter3.getTracks();
        expect(tracks).toHaveLength(1);

        const readBack = tracks[0]!;
        expect(readBack.soundcheck).toBe(normalization.soundcheckValue);
        expect(readBack.normalization).toBeDefined();
        const readBackDb = readBack.normalization!.trackGain!;
        expect(Math.abs(readBackDb - -3.2)).toBeLessThan(0.1);
      } finally {
        db3.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('normalization with only trackGain (no soundcheckValue) is converted', async () => {
    const testIpod = await createTestIpod();

    try {
      // Normalization with only trackGain — adapter must compute soundcheck
      const normalization: AudioNormalization = {
        source: 'replaygain-track',
        trackGain: -5.0,
      };
      const expectedSoundcheck = replayGainToSoundcheck(-5.0);

      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'TrackGain Only Test',
          artist: 'Test Artist',
          album: 'Test Album',
          normalization,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter2 = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const tracks = adapter2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0]!.soundcheck).toBe(expectedSoundcheck);
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // Transfer-mode-aware on-disk tag writes (TASK-327)
  // ---------------------------------------------------------------------------

  /**
   * Mock TagWriter that records all writeTags calls. Used by the
   * transfer-mode tests below to assert WHEN the iPod adapter touches the
   * on-disk file, without depending on a real taglib roundtrip (covered
   * separately in mass-storage-tag-writer.integration.test.ts).
   */
  function createMockTagWriter() {
    type TagFields = import('./mass-storage-tag-writer.js').TagFields;
    type TagWriter = import('./mass-storage-tag-writer.js').TagWriter;
    const calls: Array<{ filePath: string; fields: TagFields }> = [];
    const writer: TagWriter & { calls: typeof calls } = {
      calls,
      async writeTags(filePath, fields) {
        calls.push({ filePath, fields });
      },
      async writePicture() {},
    };
    return writer;
  }

  for (const mode of ['fast', 'optimized'] as const) {
    it(`iPod ${mode}: addTrack does NOT write file tags`, async () => {
      const testIpod = await createTestIpod();
      try {
        const db = await IpodDatabase.open(testIpod.path);
        try {
          const tagWriter = createMockTagWriter();
          const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'), {
            tagWriter,
          });

          const track = adapter.addTrack({
            title: 'No File Tags',
            artist: 'Artist',
            album: 'Album',
            albumArtist: 'Album Artist',
            transferMode: mode,
          });
          track.copyFile(mp3Path);

          await adapter.save();

          // iTunesDB write happened (track is in DB)
          expect(adapter.getTracks()).toHaveLength(1);
          // But the audio file's embedded tags are untouched.
          expect(tagWriter.calls).toHaveLength(0);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });

    it(`iPod ${mode}: updateTrack does NOT write file tags`, async () => {
      const testIpod = await createTestIpod();
      try {
        const db1 = await IpodDatabase.open(testIpod.path);
        try {
          const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
          const track = adapter.addTrack({
            title: 'Original',
            artist: 'Artist',
            album: 'Album',
            albumArtist: 'Original AA',
          });
          track.copyFile(mp3Path);
          await adapter.save();
        } finally {
          db1.close();
        }

        const db2 = await IpodDatabase.open(testIpod.path);
        try {
          const tagWriter = createMockTagWriter();
          const adapter = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'), {
            tagWriter,
          });
          const track = adapter.getTracks()[0]!;
          adapter.updateTrack(track, { albumArtist: 'Renamed AA', transferMode: mode });
          await adapter.save();

          expect(tagWriter.calls).toHaveLength(0);
        } finally {
          db2.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  }

  it('iPod portable: addTrack mirrors metadata into on-disk file tags', async () => {
    const testIpod = await createTestIpod();
    try {
      const db = await IpodDatabase.open(testIpod.path);
      try {
        const tagWriter = createMockTagWriter();
        const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'), {
          tagWriter,
        });

        const track = adapter.addTrack({
          title: 'Portable Add',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Album Artist',
          year: 2027,
          trackNumber: 3,
          transferMode: 'portable',
        });
        track.copyFile(mp3Path);

        await adapter.save();

        expect(tagWriter.calls).toHaveLength(1);
        const call = tagWriter.calls[0]!;
        // File path resolves to {mountPoint}/iPod_Control/Music/F00/... or similar.
        expect(call.filePath.startsWith(testIpod.path)).toBe(true);
        expect(call.fields.title).toBe('Portable Add');
        expect(call.fields.artist).toBe('Artist');
        expect(call.fields.albumArtist).toBe('Album Artist');
        expect(call.fields.album).toBe('Album');
        expect(call.fields.year).toBe(2027);
        expect(call.fields.trackNumber).toBe(3);
      } finally {
        db.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('iPod portable: updateTrack writes ONLY the diffed fields to disk', async () => {
    const testIpod = await createTestIpod();
    try {
      // Seed: add track with no transfer mode, save.
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Mutable',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Original AA',
          year: 2010,
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Update under portable: only albumArtist changes.
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const tagWriter = createMockTagWriter();
        const adapter = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'), {
          tagWriter,
        });
        const track = adapter.getTracks()[0]!;
        adapter.updateTrack(track, {
          // Same value — must NOT be queued.
          title: 'Mutable',
          // Changed — must be queued.
          albumArtist: 'Renamed AA',
          transferMode: 'portable',
        });
        await adapter.save();

        expect(tagWriter.calls).toHaveLength(1);
        expect(tagWriter.calls[0]!.fields).toEqual({ albumArtist: 'Renamed AA' });
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('iPod portable: multiple updates to one track coalesce into a single writeTags call', async () => {
    const testIpod = await createTestIpod();
    try {
      const db1 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Coalesce',
          artist: 'Original',
          album: 'Album',
          albumArtist: 'Original AA',
        });
        track.copyFile(mp3Path);
        await adapter.save();
      } finally {
        db1.close();
      }

      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const tagWriter = createMockTagWriter();
        const adapter = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'), {
          tagWriter,
        });
        const track = adapter.getTracks()[0]!;
        const t1 = adapter.updateTrack(track, {
          artist: 'New Artist',
          transferMode: 'portable',
        });
        adapter.updateTrack(t1, { albumArtist: 'New AA', transferMode: 'portable' });
        await adapter.save();

        expect(tagWriter.calls).toHaveLength(1);
        expect(tagWriter.calls[0]!.fields).toEqual({
          artist: 'New Artist',
          albumArtist: 'New AA',
        });
      } finally {
        db2.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  it('iPod portable: tag-write failure surfaces via WarningSink, not a save() rejection or stderr', async () => {
    const testIpod = await createTestIpod();

    // Capture any accidental stderr writes — the adapter must NOT touch
    // console.warn for this; warnings flow through the injected sink.
    const originalWarn = console.warn;
    const stderrCalls: string[] = [];
    console.warn = (msg: string) => {
      stderrCalls.push(msg);
    };

    try {
      const db = await IpodDatabase.open(testIpod.path);
      try {
        const failingWriter: import('./mass-storage-tag-writer.js').TagWriter = {
          async writeTags() {
            throw new Error('synthetic taglib failure');
          },
          async writePicture() {},
        };

        const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'), {
          tagWriter: failingWriter,
        });

        // Inject sink — this is what the pipeline does at execute start.
        const emitted: import('../sync/engine/types.js').Warning[] = [];
        adapter.setWarningSink({
          emit: (w) => {
            emitted.push(w);
          },
        });

        const track = adapter.addTrack({
          title: 'Best Effort',
          artist: 'Artist',
          album: 'Album',
          transferMode: 'portable',
        });
        track.copyFile(mp3Path);

        // save() must complete — the iTunesDB write is authoritative; file
        // tag writes are best-effort on iPod portable.
        await adapter.save();

        // The iPod's view is consistent.
        expect(adapter.getTracks()).toHaveLength(1);

        // Warning landed in the sink as a structured Warning, not stderr.
        expect(emitted).toHaveLength(1);
        const w = emitted[0]!;
        expect(w.phase).toBe('execute');
        expect(w.type).toBe('tag-write');
        expect(w.message).toContain('synthetic taglib failure');
        expect(w.tracks).toHaveLength(1);
        expect(w.tracks[0]!.title).toBe('Best Effort');
        expect(w.tracks[0]!.artist).toBe('Artist');
        expect(w.tracks[0]!.album).toBe('Album');

        // No stderr writes.
        expect(stderrCalls).toHaveLength(0);
      } finally {
        db.close();
      }
    } finally {
      console.warn = originalWarn;
      await testIpod.cleanup();
    }
  });

  it('iPod portable: default no-op sink — adapter is usable without setWarningSink', async () => {
    // The pipeline injects a sink at execute start; doctor/manual callers
    // outside execute() may not. The default no-op sink must not crash and
    // must not regress save() success.
    const testIpod = await createTestIpod();
    try {
      const db = await IpodDatabase.open(testIpod.path);
      try {
        const failingWriter: import('./mass-storage-tag-writer.js').TagWriter = {
          async writeTags() {
            throw new Error('synthetic taglib failure');
          },
          async writePicture() {},
        };
        const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'), {
          tagWriter: failingWriter,
        });
        const track = adapter.addTrack({
          title: 'Best Effort',
          artist: 'Artist',
          album: 'Album',
          transferMode: 'portable',
        });
        track.copyFile(mp3Path);
        await expect(adapter.save()).resolves.toBeUndefined();
      } finally {
        db.close();
      }
    } finally {
      await testIpod.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // Real on-disk taglib round-trips (TASK-327 follow-up)
  //
  // The tests above use a mock TagWriter — they verify the adapter contract
  // (when to queue, when to flush, when to coalesce). These tests use the
  // default TagLibTagWriter against the actual MP3 file that libgpod copies
  // to iPod_Control/Music/F00/…, then read the tags back via music-metadata.
  // They prove the wiring end-to-end so we have hard evidence that file
  // tag writes WORK under portable and DO NOT happen under fast/optimized.
  //
  // The source MP3 has title="Test Track", artist="Test Artist", album="Test
  // Album" (see generateTestMP3). When the adapter writes tags they overwrite
  // those values; when it doesn't, the source values survive on disk.
  // ---------------------------------------------------------------------------

  /** Resolve an iPod colon-separated path to an absolute on-disk path. */
  function absoluteIpodPath(mountPoint: string, ipodPath: string): string {
    return path.join(mountPoint, ipodPath.replace(/^:/, '').replace(/:/g, '/'));
  }

  async function readOnDiskTags(absolutePath: string): Promise<{
    title?: string;
    artist?: string;
    albumArtist?: string;
    album?: string;
  }> {
    const md = await mm.parseFile(absolutePath, { skipCovers: true });
    return {
      title: md.common.title,
      artist: md.common.artist,
      albumArtist: md.common.albumartist,
      album: md.common.album,
    };
  }

  for (const mode of ['fast', 'optimized'] as const) {
    it(`iPod ${mode}: addTrack does NOT rewrite source file tags on disk`, async () => {
      const testIpod = await createTestIpod();
      try {
        const db = await IpodDatabase.open(testIpod.path);
        let trackPath: string;
        try {
          const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'));

          // iTunesDB carries the new values, but with mode=fast/optimized the
          // adapter should not touch the file's embedded tags. The source
          // MP3's "Test Track" / "Test Artist" / "Test Album" must survive.
          const track = adapter.addTrack({
            title: 'Different Title',
            artist: 'Different Artist',
            albumArtist: 'Different AA',
            album: 'Different Album',
            transferMode: mode,
          });
          const copied = track.copyFile(mp3Path);
          trackPath = absoluteIpodPath(testIpod.path, copied.filePath);
          await adapter.save();
        } finally {
          db.close();
        }

        const tagsOnDisk = await readOnDiskTags(trackPath);
        expect(tagsOnDisk.title).toBe('Test Track');
        expect(tagsOnDisk.artist).toBe('Test Artist');
        expect(tagsOnDisk.album).toBe('Test Album');
        // The source MP3 has no albumArtist tag; FFmpeg won't add one.
        expect(tagsOnDisk.albumArtist).toBeUndefined();
      } finally {
        await testIpod.cleanup();
      }
    });

    it(`iPod ${mode}: updateTrack does NOT rewrite file tags on disk`, async () => {
      const testIpod = await createTestIpod();
      try {
        // Seed: add a track with no mode (defaults to source-original tags).
        const db1 = await IpodDatabase.open(testIpod.path);
        let trackPath: string;
        try {
          const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
          const track = adapter.addTrack({
            title: 'Test Track',
            artist: 'Test Artist',
            album: 'Test Album',
            albumArtist: 'Stored AA',
          });
          const copied = track.copyFile(mp3Path);
          trackPath = absoluteIpodPath(testIpod.path, copied.filePath);
          await adapter.save();
        } finally {
          db1.close();
        }

        // Update under fast/optimized: iTunesDB changes, file tags must not.
        const db2 = await IpodDatabase.open(testIpod.path);
        try {
          const adapter = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
          const track = adapter.getTracks()[0]!;
          adapter.updateTrack(track, {
            albumArtist: 'New AA After Update',
            transferMode: mode,
          });
          await adapter.save();
        } finally {
          db2.close();
        }

        const tagsOnDisk = await readOnDiskTags(trackPath);
        expect(tagsOnDisk.title).toBe('Test Track');
        expect(tagsOnDisk.artist).toBe('Test Artist');
        expect(tagsOnDisk.album).toBe('Test Album');
        // File's albumArtist tag was never written — the source MP3 didn't
        // have one and the adapter declined to add one under this mode.
        expect(tagsOnDisk.albumArtist).toBeUndefined();
      } finally {
        await testIpod.cleanup();
      }
    });
  }

  it('iPod portable: addTrack rewrites source file tags to match input metadata', async () => {
    const testIpod = await createTestIpod();
    try {
      const db = await IpodDatabase.open(testIpod.path);
      let trackPath: string;
      try {
        const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Portable Title',
          artist: 'Portable Artist',
          albumArtist: 'Portable AA',
          album: 'Portable Album',
          transferMode: 'portable',
        });
        const copied = track.copyFile(mp3Path);
        trackPath = absoluteIpodPath(testIpod.path, copied.filePath);
        await adapter.save();
      } finally {
        db.close();
      }

      const tagsOnDisk = await readOnDiskTags(trackPath);
      expect(tagsOnDisk.title).toBe('Portable Title');
      expect(tagsOnDisk.artist).toBe('Portable Artist');
      expect(tagsOnDisk.album).toBe('Portable Album');
      expect(tagsOnDisk.albumArtist).toBe('Portable AA');
    } finally {
      await testIpod.cleanup();
    }
  });

  it('iPod portable: updateTrack rewrites the changed field on disk', async () => {
    const testIpod = await createTestIpod();
    try {
      // Seed (no transfer mode — leaves source tags alone).
      const db1 = await IpodDatabase.open(testIpod.path);
      let trackPath: string;
      try {
        const adapter = new IpodDeviceAdapter(db1, capsForGeneration('classic_7g'));
        const track = adapter.addTrack({
          title: 'Test Track',
          artist: 'Test Artist',
          album: 'Test Album',
        });
        const copied = track.copyFile(mp3Path);
        trackPath = absoluteIpodPath(testIpod.path, copied.filePath);
        await adapter.save();
      } finally {
        db1.close();
      }

      // Sanity: source-original tags are on disk before the update.
      const tagsBefore = await readOnDiskTags(trackPath);
      expect(tagsBefore.albumArtist).toBeUndefined();

      // Update under portable — taglib should write the new albumArtist.
      const db2 = await IpodDatabase.open(testIpod.path);
      try {
        const adapter = new IpodDeviceAdapter(db2, capsForGeneration('classic_7g'));
        const track = adapter.getTracks()[0]!;
        adapter.updateTrack(track, {
          albumArtist: 'Portable Update AA',
          transferMode: 'portable',
        });
        await adapter.save();
      } finally {
        db2.close();
      }

      const tagsAfter = await readOnDiskTags(trackPath);
      // The changed field landed on disk.
      expect(tagsAfter.albumArtist).toBe('Portable Update AA');
      // Other fields were left alone — only the diffed field is queued.
      expect(tagsAfter.title).toBe('Test Track');
      expect(tagsAfter.artist).toBe('Test Artist');
      expect(tagsAfter.album).toBe('Test Album');
    } finally {
      await testIpod.cleanup();
    }
  });
});
