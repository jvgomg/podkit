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
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { IpodDatabase } from '../ipod/database.js';
import { IpodDeviceAdapter } from './ipod-adapter.js';
import { getDeviceCapabilities } from '../ipod/capabilities.js';
import { buildAudioSyncTag, buildCopySyncTag, buildVideoSyncTag } from '../metadata/sync-tags.js';
import { replayGainToSoundcheck } from '../metadata/normalization.js';
import type { AudioNormalization } from '../metadata/normalization.js';
import { requireGpodTool, requireLibgpod, requireFFmpeg } from '../__tests__/helpers/test-setup.js';

// Fail early if dependencies are not available
requireGpodTool();
requireLibgpod();
requireFFmpeg();

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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter3 = new IpodDeviceAdapter(db3, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter3 = new IpodDeviceAdapter(db3, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
        const adapter3 = new IpodDeviceAdapter(db3, getDeviceCapabilities('classic_3'));
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
        const adapter = new IpodDeviceAdapter(db1, getDeviceCapabilities('classic_3'));
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
        const adapter2 = new IpodDeviceAdapter(db2, getDeviceCapabilities('classic_3'));
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
});
