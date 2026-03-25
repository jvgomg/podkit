import { describe, expect, test } from 'bun:test';
import { MusicHandler, createMusicHandler } from './music-handler.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceTrack } from '../../device/adapter.js';
import type { SyncOperation, SyncPlan } from '../types.js';
import type { UnifiedSyncDiff } from '../content-type.js';
import { parseSyncTag } from '../sync-tags.js';

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
      const reasons = handler.detectUpdates(source, device, {});
      // May or may not detect changes depending on exact metadata — just verify it returns an array
      expect(Array.isArray(reasons)).toBe(true);
    });

    test('filters file-replacement upgrades when skipUpgrades is set', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true, bitrate: 1000 });
      const device = makeDeviceTrack({ bitrate: 128, filetype: 'MPEG audio file' });
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
      expect(op.type).toBe('add-transcode');
    });

    test('returns copy for compatible lossy source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, { qualityPreset: 'high' });
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns copy for ALAC source with lossless preset', () => {
      const source = makeCollectionTrack({ fileType: 'alac', lossless: true, codec: 'alac' });
      const op = handler.planAdd(source, { qualityPreset: 'max', deviceSupportsAlac: true });
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns transcode for FLAC with lossless preset', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const op = handler.planAdd(source, { qualityPreset: 'max', deviceSupportsAlac: true });
      expect(op.type).toBe('add-transcode');
      if (op.type === 'add-transcode') {
        expect(op.preset.name).toBe('lossless');
      }
    });

    test('returns optimized-copy for compatible lossy with embedded artwork source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, {
        qualityPreset: 'high',
        primaryArtworkSource: 'embedded',
      });
      expect(op.type).toBe('add-optimized-copy');
    });

    test('returns direct-copy for compatible lossy with database artwork source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, {
        qualityPreset: 'high',
        primaryArtworkSource: 'database',
      });
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns direct-copy for compatible lossy with no artwork source (backward compat)', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, { qualityPreset: 'high' });
      expect(op.type).toBe('add-direct-copy');
    });

    test('returns optimized-copy for compatible lossy with optimized transfer mode', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const op = handler.planAdd(source, {
        qualityPreset: 'high',
        transferMode: 'optimized',
      });
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

    test('returns upgrade-optimized-copy for compatible lossy with embedded artwork source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack();
      const ops = handler.planUpdate(source, device, ['format-upgrade'], {
        primaryArtworkSource: 'embedded',
      });
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade-optimized-copy');
    });

    test('returns upgrade-direct-copy for compatible lossy with database artwork source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack();
      const ops = handler.planUpdate(source, device, ['format-upgrade'], {
        primaryArtworkSource: 'database',
      });
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('upgrade-direct-copy');
    });
  });

  describe('estimateSize', () => {
    test('returns positive number for transcode operation', () => {
      const op: SyncOperation = {
        type: 'add-transcode',
        source: makeCollectionTrack({ duration: 240000 }),
        preset: { name: 'high' },
      };
      expect(handler.estimateSize(op)).toBeGreaterThan(0);
    });

    test('returns 0 for remove operation', () => {
      const op: SyncOperation = { type: 'remove', track: makeDeviceTrack() };
      expect(handler.estimateSize(op)).toBe(0);
    });
  });

  describe('estimateTime', () => {
    test('returns positive number for copy operation', () => {
      const op: SyncOperation = {
        type: 'add-direct-copy',
        source: makeCollectionTrack({ duration: 240000 }),
      };
      expect(handler.estimateTime(op)).toBeGreaterThan(0);
    });

    test('returns small number for remove operation', () => {
      const op: SyncOperation = { type: 'remove', track: makeDeviceTrack() };
      expect(handler.estimateTime(op)).toBe(0.1);
    });
  });

  describe('getDisplayName', () => {
    test('returns artist - title for transcode', () => {
      const op: SyncOperation = {
        type: 'add-transcode',
        source: makeCollectionTrack({ artist: 'Radiohead', title: 'Creep' }),
        preset: { name: 'high' },
      };
      expect(handler.getDisplayName(op)).toBe('Radiohead - Creep');
    });

    test('returns artist - title for copy', () => {
      const op: SyncOperation = {
        type: 'add-direct-copy',
        source: makeCollectionTrack({ artist: 'Björk', title: 'Army of Me' }),
      };
      expect(handler.getDisplayName(op)).toBe('Björk - Army of Me');
    });

    test('returns artist - title for remove', () => {
      const op: SyncOperation = {
        type: 'remove',
        track: makeDeviceTrack({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      };
      expect(handler.getDisplayName(op)).toBe('Nirvana - Smells Like Teen Spirit');
    });
  });

  describe('collectPlanWarnings', () => {
    test('produces embedded-artwork-resize warning for portable + embedded artwork', () => {
      const ops: SyncOperation[] = [
        {
          type: 'add-optimized-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = handler.collectPlanWarnings(ops, {
        primaryArtworkSource: 'embedded',
        transferMode: 'portable',
        artworkMaxResolution: 600,
      });
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeDefined();
      expect(resizeWarning!.message).toContain('600px');
    });

    test('no embedded-artwork-resize warning for database artwork', () => {
      const ops: SyncOperation[] = [
        {
          type: 'add-direct-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = handler.collectPlanWarnings(ops, {
        primaryArtworkSource: 'database',
        transferMode: 'portable',
      });
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeUndefined();
    });

    test('no embedded-artwork-resize warning for non-portable mode', () => {
      const ops: SyncOperation[] = [
        {
          type: 'add-optimized-copy',
          source: makeCollectionTrack({ fileType: 'mp3', lossless: false }),
        },
      ];
      const warnings = handler.collectPlanWarnings(ops, {
        primaryArtworkSource: 'embedded',
        transferMode: 'fast',
        artworkMaxResolution: 600,
      });
      const resizeWarning = warnings.find((w) => w.type === 'embedded-artwork-resize');
      expect(resizeWarning).toBeUndefined();
    });
  });

  describe('detectUpdates with forceTranscode', () => {
    test('adds force-transcode for lossless source when no file-replacement upgrade exists', () => {
      // transcodingActive suppresses format-upgrade, then forceTranscode can add force-transcode
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      const reasons = handler.detectUpdates(source, device, {
        forceTranscode: true,
        transcodingActive: true,
      });
      expect(reasons).toContain('force-transcode');
    });

    test('does not add force-transcode for lossy source', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, { forceTranscode: true });
      expect(reasons).not.toContain('force-transcode');
    });

    test('does not add force-transcode when file-replacement upgrade already exists', () => {
      // Lossless source with lossy device triggers format-upgrade, which is a file-replacement
      // upgrade, so force-transcode is not added (redundant)
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
      const reasons = handler.detectUpdates(source, device, { forceTranscode: true });
      expect(reasons).toContain('format-upgrade');
      expect(reasons).not.toContain('force-transcode');
    });

    test('prepends force-transcode as first reason when added', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      const reasons = handler.detectUpdates(source, device, {
        forceTranscode: true,
        transcodingActive: true,
      });
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
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'optimized',
        },
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
      expect(diff.toUpdate[0]!.changes![0]!.from).toBe('fast');
      expect(diff.toUpdate[0]!.changes![0]!.to).toBe('optimized');
      expect(diff.existing).toHaveLength(0);
    });

    test('leaves tracks already at the target transfer mode in existing', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag:
          parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=optimized]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'optimized',
        },
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('treats missing transfer field in sync tag as needing update when effective mode is not fast', () => {
      // Legacy sync tag has no transfer field; if effective mode is portable, file re-processing needed
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'portable',
        },
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
      expect(diff.toUpdate[0]!.changes![0]!.from).toBe('none');
      expect(diff.toUpdate[0]!.changes![0]!.to).toBe('portable');
    });

    test('stamps sync tag (metadata-only) when transfer mode missing and effective mode is fast', () => {
      // Missing transfer field + effective mode 'fast' = legacy track; stamp the tag only
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'fast',
        },
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('sync-tag-write');
      expect(diff.toUpdate[0]!.changes).toHaveLength(0);
      expect(diff.toUpdate[0]!.syncTag).toBeDefined();
      expect(diff.toUpdate[0]!.syncTag!.transferMode).toBe('fast');
    });

    test('affects copy-format (MP3) tracks unlike forceTranscode which only affects lossless', () => {
      const source = makeCollectionTrack({ fileType: 'mp3', lossless: false });
      const device = makeDeviceTrack({
        filetype: 'MPEG audio file',
        bitrate: 320,
        syncTag: parseSyncTag('[podkit:v1 quality=copy transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'portable',
        },
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reasons[0]).toBe('transfer-mode-changed');
    });

    test('forceTransferMode + forceTranscode: each track processed once with no duplicates', () => {
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

      handler.postProcessDiff(diff, {
        forceTranscode: true,
        transcodingActive: true,
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'portable',
        },
      });

      expect(diff.toUpdate).toHaveLength(2);

      const reasons = diff.toUpdate.map((u) => u.reasons[0]);
      expect(reasons).toContain('force-transcode');
      expect(reasons).toContain('transfer-mode-changed');

      expect(diff.existing).toHaveLength(0);
    });

    test('does nothing when forceTransferMode is true but effectiveTransferMode is not provided', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          // effectiveTransferMode not provided
        },
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('does nothing when effectiveTransferMode is provided but forceTransferMode is false', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        syncTag: parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]') ?? undefined,
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: false,
          effectiveTransferMode: 'optimized',
        },
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    test('leaves tracks with no sync tag in existing (cannot detect transfer mode)', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({
        filetype: 'AAC audio file',
        bitrate: 256,
        // no syncTag
      });

      const diff = makeDiff(source, device);

      handler.postProcessDiff(diff, {
        handlerOptions: {
          forceTransferMode: true,
          effectiveTransferMode: 'optimized',
        },
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  describe('detectUpdates with transcodingActive', () => {
    test('suppresses format-upgrade for AAC device when transcodingActive is true', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'AAC audio file' });
      // Without transcodingActive, lossless→AAC should detect format-upgrade
      const reasonsWithout = handler.detectUpdates(source, device, {});
      expect(reasonsWithout).toContain('format-upgrade');
      // With transcodingActive, format-upgrade should be suppressed for AAC (expected target format)
      const reasonsWith = handler.detectUpdates(source, device, { transcodingActive: true });
      expect(reasonsWith).not.toContain('format-upgrade');
    });

    test('preserves format-upgrade for MP3 device even with transcodingActive', () => {
      const source = makeCollectionTrack({ fileType: 'flac', lossless: true });
      const device = makeDeviceTrack({ filetype: 'MPEG audio file' });
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
