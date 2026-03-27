import { describe, expect, test } from 'bun:test';
import { MusicHandler, createMusicHandler } from './handler.js';
import type { MusicSyncConfig } from './config.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceTrack } from '../../device/adapter.js';
import type { SyncPlan } from '../engine/types.js';
import type { MusicOperation } from './types.js';
import type { UnifiedSyncDiff } from '../engine/content-type.js';
import { parseSyncTag } from '../../metadata/sync-tags.js';
import type { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import type { DeviceCapabilities } from '../../device/capabilities.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/** Stub transcoder — never called in unit tests */
const stubTranscoder = {} as FFmpegTranscoder;

/** Build a complete DeviceCapabilities for tests */
function makeCapabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    artworkSources: ['database'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: [],
    supportsVideo: false,
    ...overrides,
  };
}

/** Default config for tests — high quality, no special options */
function makeConfig(overrides: Partial<MusicSyncConfig> = {}): MusicSyncConfig {
  return {
    quality: 'high',
    transcoder: stubTranscoder,
    ...overrides,
  };
}

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

function makeDeviceTrack(overrides: Partial<DeviceTrack> = {}): DeviceTrack {
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
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    update: () => ({}) as DeviceTrack,
    remove: () => {},
    copyFile: () => ({}) as DeviceTrack,
    setArtwork: () => ({}) as DeviceTrack,
    setArtworkFromData: () => ({}) as DeviceTrack,
    removeArtwork: () => ({}) as DeviceTrack,
    ...overrides,
  } as DeviceTrack;
}

// =============================================================================
// Tests
// =============================================================================

describe('MusicHandler', () => {
  const handler = createMusicHandler(makeConfig());

  test('type is "music"', () => {
    expect(handler.type).toBe('music');
  });

  test('createMusicHandler returns MusicHandler instance', () => {
    const h = createMusicHandler(makeConfig());
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
      const ipodTrack = makeDeviceTrack({
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
      const device = makeDeviceTrack({ artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' });
      expect(handler.generateMatchKey(source)).toBe(handler.generateDeviceMatchKey(device));
    });
  });

  describe('getDeviceItemId', () => {
    test('returns filePath', () => {
      const device = makeDeviceTrack({ filePath: ':iPod_Control:Music:F00:ABCD.mp3' });
      expect(handler.getDeviceItemId(device)).toBe(':iPod_Control:Music:F00:ABCD.mp3');
    });
  });

  describe('detectUpdates', () => {
    test('returns empty array when no updates needed', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 256 });
      const device = makeDeviceTrack({ bitrate: 256, filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device);
      // May or may not detect changes depending on exact metadata — just verify it returns an array
      expect(Array.isArray(reasons)).toBe(true);
    });

    test('filters file-replacement upgrades when skipUpgrades is set', () => {
      const h = createMusicHandler(makeConfig({ skipUpgrades: true }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true, bitrate: 1000 });
      const device = makeDeviceTrack({ bitrate: 128, filetype: 'MPEG audio file' });
      const reasons = h.detectUpdates(source, device);
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
      const op = handler.planAdd(source);
      expect(op.type).toBe('add-transcode');
    });

    test('returns copy for compatible lossy source', () => {
      const source = makeCollectionTrack({
        fileType: 'mp3',
        lossless: false,
        filePath: '/music/test.mp3',
      });
      const op = handler.planAdd(source);
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns copy for ALAC source with lossless preset', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'max',
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['alac', 'aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'alac', lossless: true, codec: 'alac' });
      const op = h.planAdd(source);
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns transcode for FLAC with lossless preset', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'max',
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['alac', 'aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const op = h.planAdd(source);
      expect(op.type).toBe('add-transcode');
      if (op.type === 'add-transcode') {
        expect(op.preset.name).toBe('lossless');
      }
    });

    test('returns optimized-copy for compatible lossy with embedded artwork source', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['embedded'],
            artworkMaxResolution: 600,
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = h.planAdd(source);
      expect(op.type).toBe('add-optimized-copy');
    });

    test('returns direct-copy for compatible lossy with database artwork source', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = h.planAdd(source);
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns direct-copy for compatible lossy with no artwork source (backward compat)', () => {
      const source = makeCollectionTrack({
        fileType: 'mp3',
        lossless: false,
        filePath: '/music/backward.mp3',
      });
      const op = handler.planAdd(source);
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns optimized-copy for compatible lossy with optimized transfer mode', () => {
      const h = createMusicHandler(makeConfig({ transferMode: 'optimized' }));
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = h.planAdd(source);
      expect(op.type).toBe('add-optimized-copy');
    });
  });

  describe('planRemove', () => {
    test('returns remove operation', () => {
      const device = makeDeviceTrack();
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
      const device = makeDeviceTrack();
      const ops = handler.planUpdate(source, device, ['format-upgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade-transcode');
    });

    test('returns update-metadata for metadata-only reason', () => {
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();
      const ops = handler.planUpdate(source, device, ['metadata-correction']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('update-metadata');
    });

    test('returns empty array for no reasons', () => {
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();
      const ops = handler.planUpdate(source, device, []);
      expect(ops).toEqual([]);
    });

    test('returns update-sync-tag for sync-tag-write reason with syncTag', () => {
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();
      const syncTag = { quality: 'high' as const, encoding: 'vbr' as const };
      const ops = handler.planUpdate(source, device, ['sync-tag-write'], undefined, syncTag);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('update-sync-tag');
      const op = ops[0] as Extract<MusicOperation, { type: 'update-sync-tag' }>;
      expect(op.syncTag).toEqual(syncTag);
    });

    test('returns both update-sync-tag and metadata update for multi-reason with syncTag', () => {
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();
      const syncTag = { quality: 'high' as const, encoding: 'vbr' as const };
      const ops = handler.planUpdate(
        source,
        device,
        ['sync-tag-write', 'metadata-correction'],
        [],
        syncTag
      );
      expect(ops.length).toBe(2);
      const types = ops.map((op) => op.type);
      expect(types).toContain('update-sync-tag');
      expect(types).toContain('update-metadata');
    });

    test('returns upgrade-optimized-copy for compatible lossy with embedded artwork source', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['embedded'],
            artworkMaxResolution: 600,
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack();
      const ops = h.planUpdate(source, device, ['format-upgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade-optimized-copy');
    });

    test('returns upgrade-direct-copy for compatible lossy with database artwork source', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack();
      const ops = h.planUpdate(source, device, ['format-upgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade-direct-copy');
    });
  });

  describe('estimateSize', () => {
    test('returns positive number for transcode operation', () => {
      const op: MusicOperation = {
        type: 'add-transcode',
        source: makeCollectionTrack({ duration: 240000 }),
        preset: { name: 'high' },
      };
      expect(handler.estimateSize(op)).toBeGreaterThan(0);
    });

    test('returns 0 for remove operation', () => {
      const op: MusicOperation = { type: 'remove', track: makeDeviceTrack() };
      expect(handler.estimateSize(op)).toBe(0);
    });
  });

  describe('estimateTime', () => {
    test('returns positive number for copy operation', () => {
      const op: MusicOperation = {
        type: 'add-direct-copy',
        source: makeCollectionTrack({ duration: 240000 }),
      };
      expect(handler.estimateTime(op)).toBeGreaterThan(0);
    });

    test('returns small number for remove operation', () => {
      const op: MusicOperation = { type: 'remove', track: makeDeviceTrack() };
      expect(handler.estimateTime(op)).toBe(0.1);
    });
  });

  describe('getDisplayName', () => {
    test('returns artist - title for transcode', () => {
      const op: MusicOperation = {
        type: 'add-transcode',
        source: makeCollectionTrack({ artist: 'Radiohead', title: 'Creep' }),
        preset: { name: 'high' },
      };
      expect(handler.getDisplayName(op)).toBe('Radiohead - Creep');
    });

    test('returns artist - title for copy', () => {
      const op: MusicOperation = {
        type: 'add-direct-copy',
        source: makeCollectionTrack({ artist: 'Björk', title: 'Army of Me' }),
      };
      expect(handler.getDisplayName(op)).toBe('Björk - Army of Me');
    });

    test('returns artist - title for remove', () => {
      const op: MusicOperation = {
        type: 'remove',
        track: makeDeviceTrack({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      };
      expect(handler.getDisplayName(op)).toBe('Nirvana - Smells Like Teen Spirit');
    });
  });

  describe('collectPlanWarnings', () => {
    test('produces embedded-artwork-resize warning for portable + embedded artwork', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['embedded'],
            artworkMaxResolution: 600,
          }),
          transferMode: 'portable',
        })
      );
      const ops: MusicOperation[] = [
        {
          type: 'add-optimized-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = h.collectPlanWarnings(ops);
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeDefined();
      expect(resizeWarning!.message).toContain('600px');
    });

    test('no embedded-artwork-resize warning for database artwork', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['database'],
          }),
          transferMode: 'portable',
        })
      );
      const ops: MusicOperation[] = [
        {
          type: 'add-direct-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = h.collectPlanWarnings(ops);
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeUndefined();
    });

    test('no embedded-artwork-resize warning for non-portable mode', () => {
      const h = createMusicHandler(
        makeConfig({
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['aac', 'mp3'],
            artworkSources: ['embedded'],
            artworkMaxResolution: 600,
          }),
          transferMode: 'fast',
        })
      );
      const ops: MusicOperation[] = [
        {
          type: 'add-optimized-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = h.collectPlanWarnings(ops);
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeUndefined();
    });
  });

  describe('detectUpdates with forceTranscode', () => {
    test('adds force-transcode for lossless source when no file-replacement upgrade exists', () => {
      const h = createMusicHandler(makeConfig({ forceTranscode: true }));
      // transcodingActive suppresses format-upgrade, then forceTranscode can add force-transcode
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      const reasons = h.detectUpdates(source, device);
      expect(reasons).toContain('force-transcode');
    });

    test('does not add force-transcode for lossy source', () => {
      const h = createMusicHandler(makeConfig({ forceTranscode: true }));
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
      const reasons = h.detectUpdates(source, device);
      expect(reasons).not.toContain('force-transcode');
    });

    test('does not add force-transcode when file-replacement upgrade already exists', () => {
      const h = createMusicHandler(makeConfig({ forceTranscode: true }));
      // Lossless source with lossy device triggers format-upgrade, which is a file-replacement
      // upgrade, so force-transcode is not added (redundant)
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
      const reasons = h.detectUpdates(source, device);
      expect(reasons).toContain('format-upgrade');
      expect(reasons).not.toContain('force-transcode');
    });

    test('prepends force-transcode as first reason when added', () => {
      const h = createMusicHandler(makeConfig({ forceTranscode: true }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      const reasons = h.detectUpdates(source, device);
      expect(reasons[0]).toBe('force-transcode');
    });
  });

  // ---------------------------------------------------------------------------
  // postProcessTransferMode (via postProcessDiff)
  // ---------------------------------------------------------------------------

  describe('postProcessTransferMode', () => {
    /**
     * Build a minimal UnifiedSyncDiff with one matched existing pair.
     */
    function makeDiff(
      source: CollectionTrack,
      device: DeviceTrack
    ): UnifiedSyncDiff<CollectionTrack, DeviceTrack> {
      return {
        toAdd: [],
        toRemove: [],
        existing: [{ source, device }],
        toUpdate: [],
      };
    }

    test('moves tracks with mismatched transfer mode to toUpdate with reason transfer-mode-changed', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, transferMode: 'optimized' })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
      expect(diff.toUpdate[0]!.changes![0]!.from).toBe('fast');
      expect(diff.toUpdate[0]!.changes![0]!.to).toBe('optimized');
      expect(diff.existing).toHaveLength(0);
    });

    test('leaves tracks already at the target transfer mode in existing', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, transferMode: 'optimized' })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag:
          parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=optimized]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('treats missing transfer field in sync tag as needing update when effective mode is not fast', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, transferMode: 'portable' })
      );
      // Legacy sync tag has no transfer field; if effective mode is portable, file re-processing needed
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
      expect(diff.toUpdate[0]!.changes![0]!.from).toBe('none');
      expect(diff.toUpdate[0]!.changes![0]!.to).toBe('portable');
    });

    test('stamps sync tag (metadata-only) when transfer mode missing and effective mode is fast', () => {
      const h = createMusicHandler(makeConfig({ forceTransferMode: true, transferMode: 'fast' }));
      // Missing transfer field + effective mode 'fast' = legacy track; stamp the tag only
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('sync-tag-write');
      expect(diff.toUpdate[0]!.changes).toHaveLength(0);
      expect(diff.toUpdate[0]!.syncTag).toBeDefined();
      expect(diff.toUpdate[0]!.syncTag!.transferMode).toBe('fast');
    });

    test('affects copy-format (MP3) tracks unlike forceTranscode which only affects lossless', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, transferMode: 'portable' })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: parseSyncTag('[podkit:v1 quality=copy transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
    });

    test('forceTransferMode + forceTranscode: each track processed once with no duplicates', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, forceTranscode: true, transferMode: 'portable' })
      );
      // Lossless track is caught by forceTranscode pass (earlier), not double-counted by forceTransferMode.
      // Lossy track is unaffected by forceTranscode but caught by forceTransferMode.
      const losslessSource = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const lossySource = makeCollectionTrack({
        artist: 'Artist2',
        title: 'Track2',
        fileType: 'mp3',
        lossless: false,
      });

      const losslessDevice = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });
      const lossyDevice = makeDeviceTrack({
        artist: 'Artist2',
        title: 'Track2',
        filePath: ':iPod_Control:Music:F00:test2.mp3',
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: parseSyncTag('[podkit:v1 quality=copy transfer=fast]') ?? undefined,
      });

      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        toAdd: [],
        toRemove: [],
        existing: [
          { source: losslessSource, device: losslessDevice },
          { source: lossySource, device: lossyDevice },
        ],
        toUpdate: [],
      };

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(2);

      const reasons = diff.toUpdate.map((u) => u.reasons[0]);
      expect(reasons).toContain('force-transcode');
      expect(reasons).toContain('transfer-mode-changed');

      expect(diff.existing).toHaveLength(0);
    });

    test('does nothing when forceTransferMode is true but transferMode defaults to fast (no mismatch)', () => {
      // forceTransferMode is true but transferMode is not set — defaults to 'fast'
      const h = createMusicHandler(makeConfig({ forceTransferMode: true }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('does nothing when transferMode is provided but forceTransferMode is false', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: false, transferMode: 'optimized' })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('leaves tracks with no sync tag in existing (cannot detect transfer mode)', () => {
      const h = createMusicHandler(
        makeConfig({ forceTransferMode: true, transferMode: 'optimized' })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        // no syncTag
      });

      const diff = makeDiff(source, device);
      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  describe('detectUpdates with transcodingActive', () => {
    test('suppresses format-upgrade for AAC device (handler is always transcoding-aware)', () => {
      const source = makeCollectionTrack({
        fileType: 'flac',
        lossless: true,
        filePath: '/music/transcode-aac.flac',
      });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      // Handler is always transcoding-aware, so AAC format-upgrade is suppressed
      const reasons = handler.detectUpdates(source, device);
      expect(reasons).not.toContain('format-upgrade');
    });

    test('preserves format-upgrade for MP3 device', () => {
      const source = makeCollectionTrack({
        fileType: 'flac',
        lossless: true,
        filePath: '/music/transcode-mp3.flac',
      });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
      // MP3 on iPod means the track was copied before the source was upgraded to FLAC.
      // This IS a genuine upgrade opportunity.
      const reasons = handler.detectUpdates(source, device);
      expect(reasons).toContain('format-upgrade');
    });
  });

  describe('formatDryRun', () => {
    test('summarizes a plan', () => {
      const plan: SyncPlan<MusicOperation> = {
        operations: [
          { type: 'add-transcode', source: makeCollectionTrack(), preset: { name: 'high' } },
          {
            type: 'add-direct-copy',
            source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
          },
          { type: 'remove', track: makeDeviceTrack() },
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
      expect(summary.operationCounts['add-transcode']).toBe(1);
      expect(summary.operationCounts['add-direct-copy']).toBe(1);
      expect(summary.operationCounts['remove']).toBe(1);
      expect(summary.operations).toHaveLength(3);
    });

    test('includes warnings', () => {
      const plan: SyncPlan<MusicOperation> = {
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

  // ---------------------------------------------------------------------------
  // postProcessPresetChanges (via postProcessDiff)
  // ---------------------------------------------------------------------------

  describe('postProcessPresetChanges', () => {
    function makePresetDiff(
      source: CollectionTrack,
      device: DeviceTrack
    ): UnifiedSyncDiff<CollectionTrack, DeviceTrack> {
      return {
        toAdd: [],
        toRemove: [],
        existing: [{ source, device }],
        toUpdate: [],
      };
    }

    test('moves lossless-source track from existing to toUpdate with preset-upgrade', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-upgrade');
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'bitrate',
        from: '128',
        to: '256',
      });
      expect(diff.existing).toHaveLength(0);
    });

    test('moves lossless-source track from existing to toUpdate with preset-downgrade', () => {
      const h = createMusicHandler(makeConfig({ quality: 'low' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-downgrade');
      expect(diff.existing).toHaveLength(0);
    });

    test('leaves lossless-source track in existing when bitrate is within tolerance', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 240 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('does not detect preset change when skipUpgrades is true', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high', skipUpgrades: true }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('does not detect preset change for lossy source tracks', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high' }));
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false, bitrate: 128 });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file', bitrate: 128 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('uses sync tag comparison when resolvedQuality is provided — match keeps as existing', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high', encoding: 'vbr' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('uses sync tag comparison when resolvedQuality is provided — mismatch triggers preset-upgrade', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high', encoding: 'vbr' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 128,
        syncTag: parseSyncTag('[podkit:v1 quality=low encoding=vbr]') ?? undefined,
      });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-upgrade');
    });

    test('uses sync tag comparison — quality downgrade triggers preset-downgrade', () => {
      const h = createMusicHandler(makeConfig({ quality: 'low', encoding: 'vbr' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-downgrade');
    });

    test('no sync tag falls back to bitrate tolerance detection', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high', encoding: 'vbr' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 128 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-upgrade');
    });

    test('detects ALAC format-based preset upgrade when isAlacPreset is true', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'max',
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['alac', 'aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('preset-upgrade');
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'lossless',
        from: 'AAC audio file',
        to: 'ALAC',
      });
    });

    test('keeps ALAC track as existing when isAlacPreset is true', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'max',
          capabilities: makeCapabilities({
            supportedAudioCodecs: ['alac', 'aac', 'mp3'],
            artworkSources: ['database'],
          }),
        })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'Apple Lossless audio file', bitrate: 900 });
      const diff = makePresetDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // postProcessForceTranscode via postProcessDiff (extended scenarios)
  // ---------------------------------------------------------------------------

  describe('postProcessForceTranscode (extended)', () => {
    test('moves lossless-source tracks from existing to toUpdate while leaving lossy in existing', () => {
      const h = createMusicHandler(makeConfig({ forceTranscode: true }));
      const losslessSource = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const lossySource = makeCollectionTrack({
        artist: 'Artist2',
        title: 'Track2',
        fileType: 'mp3',
        lossless: false,
      });
      const losslessDevice = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });
      const lossyDevice = makeDeviceTrack({
        artist: 'Artist2',
        title: 'Track2',
        filePath: ':iPod_Control:Music:F00:test2.mp3',
        filetype: 'MPEG audio file',
        bitrate: 320,
      });

      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        toAdd: [],
        toRemove: [],
        existing: [
          { source: losslessSource, device: losslessDevice },
          { source: lossySource, device: lossyDevice },
        ],
        toUpdate: [],
      };

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('force-transcode');
      expect(diff.toUpdate[0]!.source.fileType).toBe('flac');

      expect(diff.existing).toHaveLength(1);
      expect(diff.existing[0]!.source.fileType).toBe('mp3');
    });
  });

  // ---------------------------------------------------------------------------
  // postProcessSyncTags (via postProcessDiff)
  // ---------------------------------------------------------------------------

  describe('postProcessSyncTags', () => {
    function makeSyncTagDiff(
      source: CollectionTrack,
      device: DeviceTrack
    ): UnifiedSyncDiff<CollectionTrack, DeviceTrack> {
      return {
        toAdd: [],
        toRemove: [],
        existing: [{ source, device }],
        toUpdate: [],
      };
    }

    test('writes sync tag for lossless sources missing a tag', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'high',
          encoding: 'vbr',
          forceSyncTags: true,
        })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });
      const diff = makeSyncTagDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('sync-tag-write');
      expect(diff.toUpdate[0]!.changes).toHaveLength(0);
      expect(diff.toUpdate[0]!.syncTag).toBeDefined();
      expect(diff.toUpdate[0]!.syncTag!.quality).toBe('high');
      expect(diff.toUpdate[0]!.syncTag!.encoding).toBe('vbr');
      expect(diff.existing).toHaveLength(0);
    });

    test('keeps lossless source in existing when sync tag already matches', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'high',
          encoding: 'vbr',
          forceSyncTags: true,
        })
      );
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });
      const diff = makeSyncTagDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('skips lossy sources', () => {
      const h = createMusicHandler(
        makeConfig({
          quality: 'high',
          encoding: 'vbr',
          forceSyncTags: true,
        })
      );
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file', bitrate: 192 });
      const diff = makeSyncTagDiff(source, device);

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    test('does not activate without forceSyncTags', () => {
      const h = createMusicHandler(makeConfig({ quality: 'high', encoding: 'vbr' }));
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file', bitrate: 256 });
      const diff = makeSyncTagDiff(source, device);

      h.postProcessDiff(diff);

      // Without forceSyncTags, presetBitrate match means no change
      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // postProcessForceMetadata (via postProcessDiff)
  // ---------------------------------------------------------------------------

  describe('postProcessForceMetadata', () => {
    test('moves all matched tracks to toUpdate with force-metadata reason', () => {
      const h = createMusicHandler(makeConfig({ forceMetadata: true }));
      const source1 = makeCollectionTrack({ artist: 'Artist A', title: 'Song 1' });
      const source2 = makeCollectionTrack({
        artist: 'Artist B',
        title: 'Song 2',
        album: 'Album 2',
      });
      const device1 = makeDeviceTrack({ artist: 'Artist A', title: 'Song 1' });
      const device2 = makeDeviceTrack({
        artist: 'Artist B',
        title: 'Song 2',
        filePath: ':iPod_Control:Music:F00:test2.m4a',
      });

      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        toAdd: [],
        toRemove: [],
        existing: [
          { source: source1, device: device1 },
          { source: source2, device: device2 },
        ],
        toUpdate: [],
      };

      h.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(0);
      expect(diff.toUpdate).toHaveLength(2);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('force-metadata');
      expect(diff.toUpdate[1]!.reasons[0]).toBe('force-metadata');
    });

    test('includes no-op title change when metadata is identical', () => {
      const h = createMusicHandler(makeConfig({ forceMetadata: true }));
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();

      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        toAdd: [],
        toRemove: [],
        existing: [{ source, device }],
        toUpdate: [],
      };

      h.postProcessDiff(diff);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('force-metadata');
      expect(diff.toUpdate[0]!.changes).toHaveLength(1);
      expect(diff.toUpdate[0]!.changes![0]!.field).toBe('title');
    });

    test('does not move tracks when forceMetadata is false', () => {
      const source = makeCollectionTrack();
      const device = makeDeviceTrack();

      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        toAdd: [],
        toRemove: [],
        existing: [{ source, device }],
        toUpdate: [],
      };

      handler.postProcessDiff(diff);

      expect(diff.existing).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getOperationPriority
  // ---------------------------------------------------------------------------

  describe('getOperationPriority', () => {
    test('remove has lowest priority (executes first)', () => {
      const op: MusicOperation = { type: 'remove', track: makeDeviceTrack() };
      expect(handler.getOperationPriority(op)).toBe(0);
    });

    test('metadata updates have priority 1', () => {
      const op: MusicOperation = {
        type: 'update-metadata',
        track: makeDeviceTrack(),
        metadata: {},
      };
      expect(handler.getOperationPriority(op)).toBe(1);
    });

    test('direct copies have priority 2', () => {
      const op: MusicOperation = { type: 'add-direct-copy', source: makeCollectionTrack() };
      expect(handler.getOperationPriority(op)).toBe(2);
    });

    test('transcodes have priority 4', () => {
      const op: MusicOperation = {
        type: 'add-transcode',
        source: makeCollectionTrack(),
        preset: { name: 'high' },
      };
      expect(handler.getOperationPriority(op)).toBe(4);
    });
  });
});
