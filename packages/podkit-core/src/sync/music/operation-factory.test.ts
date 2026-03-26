import { describe, expect, test } from 'bun:test';
import { MusicOperationFactory } from './operation-factory.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceTrack } from '../../device/adapter.js';
import type { MusicAction } from './classifier.js';

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
    mediaType: 0x0001,
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

describe('MusicOperationFactory', () => {
  const factory = new MusicOperationFactory();

  describe('createAdd', () => {
    const source = makeCollectionTrack();

    test('direct-copy action produces add-direct-copy operation', () => {
      const action: MusicAction = { type: 'direct-copy' };
      const op = factory.createAdd(source, action);
      expect(op).toEqual({ type: 'add-direct-copy', source });
    });

    test('optimized-copy action produces add-optimized-copy operation', () => {
      const action: MusicAction = { type: 'optimized-copy' };
      const op = factory.createAdd(source, action);
      expect(op).toEqual({ type: 'add-optimized-copy', source });
    });

    test('transcode action produces add-transcode operation with preset', () => {
      const action: MusicAction = {
        type: 'transcode',
        preset: { name: 'high' },
      };
      const op = factory.createAdd(source, action);
      expect(op).toEqual({
        type: 'add-transcode',
        source,
        preset: { name: 'high' },
      });
    });

    test('transcode action preserves bitrate override in preset', () => {
      const action: MusicAction = {
        type: 'transcode',
        preset: { name: 'medium', bitrateOverride: 192 },
      };
      const op = factory.createAdd(source, action);
      expect(op).toEqual({
        type: 'add-transcode',
        source,
        preset: { name: 'medium', bitrateOverride: 192 },
      });
    });
  });

  describe('createUpgrade', () => {
    const source = makeCollectionTrack();
    const target = makeDeviceTrack();

    test('direct-copy action produces upgrade-direct-copy with source, target, reason', () => {
      const action: MusicAction = { type: 'direct-copy' };
      const op = factory.createUpgrade(source, target, 'format-upgrade', action);
      expect(op).toEqual({
        type: 'upgrade-direct-copy',
        source,
        target,
        reason: 'format-upgrade',
      });
    });

    test('optimized-copy action produces upgrade-optimized-copy', () => {
      const action: MusicAction = { type: 'optimized-copy' };
      const op = factory.createUpgrade(source, target, 'quality-upgrade', action);
      expect(op).toEqual({
        type: 'upgrade-optimized-copy',
        source,
        target,
        reason: 'quality-upgrade',
      });
    });

    test('transcode action produces upgrade-transcode with preset', () => {
      const action: MusicAction = {
        type: 'transcode',
        preset: { name: 'lossless' },
      };
      const op = factory.createUpgrade(source, target, 'preset-upgrade', action);
      expect(op).toEqual({
        type: 'upgrade-transcode',
        source,
        target,
        reason: 'preset-upgrade',
        preset: { name: 'lossless' },
      });
    });
  });

  describe('createArtworkUpgrade', () => {
    test('produces upgrade-artwork operation', () => {
      const source = makeCollectionTrack();
      const target = makeDeviceTrack();
      const op = factory.createArtworkUpgrade(source, target, 'artwork-updated');
      expect(op).toEqual({
        type: 'upgrade-artwork',
        source,
        target,
        reason: 'artwork-updated',
      });
    });
  });

  describe('createRemove', () => {
    test('produces remove operation', () => {
      const device = makeDeviceTrack();
      const op = factory.createRemove(device);
      expect(op).toEqual({ type: 'remove', track: device });
    });
  });

  describe('createMetadataUpdate', () => {
    test('produces update-metadata with converted metadata', () => {
      const device = makeDeviceTrack();
      const changes = [
        { field: 'artist' as const, from: 'Old Artist', to: 'New Artist' },
        { field: 'title' as const, from: 'Old Title', to: 'New Title' },
      ];
      const op = factory.createMetadataUpdate(device, changes);
      expect(op).toEqual({
        type: 'update-metadata',
        track: device,
        metadata: { artist: 'New Artist', title: 'New Title' },
      });
    });

    test('converts numeric fields correctly', () => {
      const device = makeDeviceTrack();
      const changes = [
        { field: 'year' as const, from: '2020', to: '2024' },
        { field: 'trackNumber' as const, from: '1', to: '5' },
      ];
      const op = factory.createMetadataUpdate(device, changes);
      expect(op).toEqual({
        type: 'update-metadata',
        track: device,
        metadata: { year: 2024, trackNumber: 5 },
      });
    });
  });

  describe('createSyncTagUpdate', () => {
    test('produces update-sync-tag operation', () => {
      const device = makeDeviceTrack();
      const syncTag = { quality: 'high', encoding: 'vbr' };
      const op = factory.createSyncTagUpdate(device, syncTag);
      expect(op).toEqual({
        type: 'update-sync-tag',
        track: device,
        syncTag: { quality: 'high', encoding: 'vbr' },
      });
    });
  });
});
