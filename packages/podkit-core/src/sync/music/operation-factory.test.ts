import { describe, expect, test } from 'bun:test';
import { MusicOperationFactory } from './operation-factory.js';
import type { MusicAction } from './classifier.js';
import { makeMockCollectionTrack, makeMockDeviceTrack } from '../../test-utils/tracks.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const makeCollectionTrack = makeMockCollectionTrack;
const makeDeviceTrack = makeMockDeviceTrack;

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
      const op = factory.createUpgrade(source, target, 'quality-change', action);
      expect(op).toEqual({
        type: 'upgrade-direct-copy',
        source,
        target,
        reason: 'quality-change',
      });
    });

    test('optimized-copy action produces upgrade-optimized-copy', () => {
      const action: MusicAction = { type: 'optimized-copy' };
      const op = factory.createUpgrade(source, target, 'quality-change', action);
      expect(op).toEqual({
        type: 'upgrade-optimized-copy',
        source,
        target,
        reason: 'quality-change',
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
