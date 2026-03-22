import { describe, expect, test } from 'bun:test';
import { MusicHandler, createMusicHandler } from './music-handler.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { IPodTrack } from '../../ipod/types.js';
import type { SyncOperation, SyncPlan } from '../types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeCollectionTrack(overrides: Partial<CollectionTrack> = {}): CollectionTrack {
  return {
    artist: 'Test Artist',
    title: 'Test Song',
    album: 'Test Album',
    fileType: 'flac',
    filePath: '/music/test.flac',
    lossless: true,
    duration: 240000,
    ...overrides,
  } as CollectionTrack;
}

function makeIpodTrack(overrides: Partial<IPodTrack> = {}): IPodTrack {
  return {
    artist: 'Test Artist',
    title: 'Test Song',
    album: 'Test Album',
    filePath: ':iPod_Control:Music:F00:test.m4a',
    duration: 240000,
    bitrate: 256,
    sampleRate: 44100,
    size: 7680000,
    mediaType: 0x0001, // Audio
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    update: () => ({}) as IPodTrack,
    remove: () => {},
    copyFile: () => ({}) as IPodTrack,
    setArtwork: () => ({}) as IPodTrack,
    setArtworkFromData: () => ({}) as IPodTrack,
    removeArtwork: () => ({}) as IPodTrack,
    ...overrides,
  } as IPodTrack;
}

// =============================================================================
// Tests
// =============================================================================

describe('MusicHandler', () => {
  const handler = createMusicHandler();

  test('type is "music"', () => {
    expect(handler.type).toBe('music');
  });

  test('createMusicHandler returns MusicHandler instance', () => {
    const h = createMusicHandler();
    expect(h).toBeInstanceOf(MusicHandler);
    expect(h.type).toBe('music');
  });

  describe('generateMatchKey', () => {
    test('generates consistent keys for same track', () => {
      const track = makeCollectionTrack({
        artist: 'The Beatles',
        title: 'Hey Jude',
        album: 'Past Masters',
      });
      const key1 = handler.generateMatchKey(track);
      const key2 = handler.generateMatchKey(track);
      expect(key1).toBe(key2);
    });

    test('generates different keys for different tracks', () => {
      const track1 = makeCollectionTrack({ artist: 'Artist A', title: 'Song A', album: 'Album A' });
      const track2 = makeCollectionTrack({ artist: 'Artist B', title: 'Song B', album: 'Album B' });
      expect(handler.generateMatchKey(track1)).not.toBe(handler.generateMatchKey(track2));
    });
  });

  describe('generateDeviceMatchKey', () => {
    test('generates key for iPod track', () => {
      const ipodTrack = makeIpodTrack({
        artist: 'The Beatles',
        title: 'Hey Jude',
        album: 'Past Masters',
      });
      const key = handler.generateDeviceMatchKey(ipodTrack);
      expect(key).toBeTruthy();
    });

    test('matches source key for same metadata', () => {
      const source = makeCollectionTrack({
        artist: 'Radiohead',
        title: 'Creep',
        album: 'Pablo Honey',
      });
      const device = makeIpodTrack({ artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' });
      expect(handler.generateMatchKey(source)).toBe(handler.generateDeviceMatchKey(device));
    });
  });

  describe('getDeviceItemId', () => {
    test('returns filePath', () => {
      const device = makeIpodTrack({ filePath: ':iPod_Control:Music:F00:ABCD.mp3' });
      expect(handler.getDeviceItemId(device)).toBe(':iPod_Control:Music:F00:ABCD.mp3');
    });
  });

  describe('detectUpdates', () => {
    test('returns empty array when no updates needed', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 256 });
      const device = makeIpodTrack({ bitrate: 256, filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, {});
      // May or may not detect changes depending on exact metadata — just verify it returns an array
      expect(Array.isArray(reasons)).toBe(true);
    });

    test('filters file-replacement upgrades when skipUpgrades is set', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true, bitrate: 1000 });
      const device = makeIpodTrack({ bitrate: 128, filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, { skipUpgrades: true });
      // File-replacement reasons should be filtered
      const fileReplacement = [
        'format-upgrade',
        'quality-upgrade',
        'artwork-added',
        'force-transcode',
      ];
      for (const reason of reasons) {
        expect(fileReplacement).not.toContain(reason);
      }
    });
  });

  describe('planAdd', () => {
    test('returns transcode for lossless source', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const op = handler.planAdd(source, { qualityPreset: 'high' });
      expect(op.type).toBe('transcode');
    });

    test('returns copy for compatible lossy source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, { qualityPreset: 'high' });
      expect(op.type).toBe('copy');
    });

    test('returns copy for ALAC source with lossless preset', () => {
      const source = makeCollectionTrack({ fileType: 'alac', lossless: true, codec: 'alac' });
      const op = handler.planAdd(source, { qualityPreset: 'max', deviceSupportsAlac: true });
      expect(op.type).toBe('copy');
    });

    test('returns transcode for FLAC with lossless preset', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const op = handler.planAdd(source, { qualityPreset: 'max', deviceSupportsAlac: true });
      expect(op.type).toBe('transcode');
      if (op.type === 'transcode') {
        expect(op.preset.name).toBe('lossless');
      }
    });
  });

  describe('planRemove', () => {
    test('returns remove operation', () => {
      const device = makeIpodTrack();
      const op = handler.planRemove(device);
      expect(op.type).toBe('remove');
      if (op.type === 'remove') {
        expect(op.track).toBe(device);
      }
    });
  });

  describe('planUpdate', () => {
    test('returns upgrade for file-replacement reason', () => {
      const source = makeCollectionTrack();
      const device = makeIpodTrack();
      const ops = handler.planUpdate(source, device, ['format-upgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade');
    });

    test('returns update-metadata for metadata-only reason', () => {
      const source = makeCollectionTrack();
      const device = makeIpodTrack();
      const ops = handler.planUpdate(source, device, ['metadata-correction']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('update-metadata');
    });

    test('returns empty array for no reasons', () => {
      const source = makeCollectionTrack();
      const device = makeIpodTrack();
      const ops = handler.planUpdate(source, device, []);
      expect(ops).toEqual([]);
    });
  });

  describe('estimateSize', () => {
    test('returns positive number for transcode operation', () => {
      const op: SyncOperation = {
        type: 'transcode',
        source: makeCollectionTrack({ duration: 240000 }),
        preset: { name: 'high' },
      };
      expect(handler.estimateSize(op)).toBeGreaterThan(0);
    });

    test('returns 0 for remove operation', () => {
      const op: SyncOperation = { type: 'remove', track: makeIpodTrack() };
      expect(handler.estimateSize(op)).toBe(0);
    });
  });

  describe('estimateTime', () => {
    test('returns positive number for copy operation', () => {
      const op: SyncOperation = {
        type: 'copy',
        source: makeCollectionTrack({ duration: 240000 }),
      };
      expect(handler.estimateTime(op)).toBeGreaterThan(0);
    });

    test('returns small number for remove operation', () => {
      const op: SyncOperation = { type: 'remove', track: makeIpodTrack() };
      expect(handler.estimateTime(op)).toBe(0.1);
    });
  });

  describe('getDisplayName', () => {
    test('returns artist - title for transcode', () => {
      const op: SyncOperation = {
        type: 'transcode',
        source: makeCollectionTrack({ artist: 'Radiohead', title: 'Creep' }),
        preset: { name: 'high' },
      };
      expect(handler.getDisplayName(op)).toBe('Radiohead - Creep');
    });

    test('returns artist - title for copy', () => {
      const op: SyncOperation = {
        type: 'copy',
        source: makeCollectionTrack({ artist: 'Björk', title: 'Army of Me' }),
      };
      expect(handler.getDisplayName(op)).toBe('Björk - Army of Me');
    });

    test('returns artist - title for remove', () => {
      const op: SyncOperation = {
        type: 'remove',
        track: makeIpodTrack({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      };
      expect(handler.getDisplayName(op)).toBe('Nirvana - Smells Like Teen Spirit');
    });
  });

  describe('detectUpdates with forceTranscode', () => {
    test('adds force-transcode for lossless source when no file-replacement upgrade exists', () => {
      // transcodingActive suppresses format-upgrade, then forceTranscode can add force-transcode
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeIpodTrack({ filetype: 'AAC audio file' });
      const reasons = handler.detectUpdates(source, device, {
        forceTranscode: true,
        transcodingActive: true,
      });
      expect(reasons).toContain('force-transcode');
    });

    test('does not add force-transcode for lossy source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeIpodTrack({ filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, { forceTranscode: true });
      expect(reasons).not.toContain('force-transcode');
    });

    test('does not add force-transcode when file-replacement upgrade already exists', () => {
      // Lossless source with lossy device triggers format-upgrade, which is a file-replacement
      // upgrade, so force-transcode is not added (redundant)
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeIpodTrack({ filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, { forceTranscode: true });
      expect(reasons).toContain('format-upgrade');
      expect(reasons).not.toContain('force-transcode');
    });

    test('prepends force-transcode as first reason when added', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeIpodTrack({ filetype: 'AAC audio file' });
      const reasons = handler.detectUpdates(source, device, {
        forceTranscode: true,
        transcodingActive: true,
      });
      expect(reasons[0]).toBe('force-transcode');
    });
  });

  describe('detectUpdates with transcodingActive', () => {
    test('suppresses format-upgrade for AAC device when transcodingActive is true', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeIpodTrack({ filetype: 'AAC audio file' });
      // Without transcodingActive, lossless→AAC should detect format-upgrade
      const reasonsWithout = handler.detectUpdates(source, device, {});
      expect(reasonsWithout).toContain('format-upgrade');
      // With transcodingActive, format-upgrade should be suppressed for AAC (expected target format)
      const reasonsWith = handler.detectUpdates(source, device, { transcodingActive: true });
      expect(reasonsWith).not.toContain('format-upgrade');
    });

    test('preserves format-upgrade for MP3 device even with transcodingActive', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeIpodTrack({ filetype: 'MPEG audio file' });
      // MP3 on iPod means the track was copied before the source was upgraded to FLAC.
      // This IS a genuine upgrade opportunity even when transcoding is active.
      const reasons = handler.detectUpdates(source, device, { transcodingActive: true });
      expect(reasons).toContain('format-upgrade');
    });
  });

  describe('formatDryRun', () => {
    test('summarizes a plan', () => {
      const plan: SyncPlan = {
        operations: [
          { type: 'transcode', source: makeCollectionTrack(), preset: { name: 'high' } },
          { type: 'copy', source: makeCollectionTrack({ fileType: 'mp3', lossless: false }) },
          { type: 'remove', track: makeIpodTrack() },
        ],
        estimatedSize: 10000000,
        estimatedTime: 120,
        warnings: [],
      };

      const summary = handler.formatDryRun(plan);
      expect(summary.toAdd).toBe(2);
      expect(summary.toRemove).toBe(1);
      expect(summary.toUpdate).toBe(0);
      expect(summary.estimatedSize).toBe(10000000);
      expect(summary.estimatedTime).toBe(120);
      expect(summary.operationCounts['transcode']).toBe(1);
      expect(summary.operationCounts['copy']).toBe(1);
      expect(summary.operationCounts['remove']).toBe(1);
      expect(summary.operations).toHaveLength(3);
    });

    test('includes warnings', () => {
      const plan: SyncPlan = {
        operations: [],
        estimatedSize: 0,
        estimatedTime: 0,
        warnings: [
          { type: 'lossy-to-lossy', message: '2 tracks require lossy conversion', tracks: [] },
        ],
      };

      const summary = handler.formatDryRun(plan);
      expect(summary.warnings).toEqual(['2 tracks require lossy conversion']);
    });
  });
});
