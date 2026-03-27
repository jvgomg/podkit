/**
 * Unit tests for the sync diff engine
 *
 * Tests the generic SyncDiffer that delegates to ContentTypeHandler.
 * Uses a minimal mock handler to verify the algorithm independent of
 * any specific content type.
 */

import { describe, expect, it } from 'bun:test';
import { SyncDiffer, createSyncDiffer } from './differ.js';
import type { ContentTypeHandler } from './content-type.js';
import type { UpdateReason } from './types.js';

// =============================================================================
// Test Types
// =============================================================================

interface TestSource {
  id: string;
  name: string;
  version: number;
  /** Optional transform name for testing applyTransformKey */
  transformName?: string;
}

interface TestDevice {
  deviceId: string;
  name: string;
  version: number;
}

// =============================================================================
// Mock Handler
// =============================================================================

function createMockHandler(
  overrides: Partial<ContentTypeHandler<TestSource, TestDevice>> = {}
): ContentTypeHandler<TestSource, TestDevice> {
  return {
    type: 'test',

    generateMatchKey: (source: TestSource) => source.name.toLowerCase(),
    generateDeviceMatchKey: (device: TestDevice) => device.name.toLowerCase(),
    getDeviceItemId: (device: TestDevice) => device.deviceId,

    detectUpdates: (source: TestSource, device: TestDevice): UpdateReason[] => {
      if (source.version !== device.version) {
        return ['metadata-correction'];
      }
      return [];
    },

    // Planning stubs (not used by differ)
    planAdd: () => ({ type: 'add-direct-copy', source: {} }) as any,
    planRemove: () => ({ type: 'remove', track: {} }) as any,
    planUpdate: () => [],
    estimateSize: () => 0,
    estimateTime: () => 0,
    getOperationPriority: () => 5,
    execute: async function* () {},
    getDeviceItems: () => [],
    getDisplayName: () => '',
    formatDryRun: () => ({
      toAdd: 0,
      toRemove: 0,
      existing: 0,
      toUpdate: 0,
      operationCounts: {},
      estimatedSize: 0,
      estimatedTime: 0,
      warnings: [],
      operations: [],
    }),

    ...overrides,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function src(name: string, version = 1, transformName?: string): TestSource {
  return { id: `src-${name}`, name, version, transformName };
}

function dev(name: string, version = 1, deviceId?: string): TestDevice {
  return { deviceId: deviceId ?? `dev-${name}`, name, version };
}

// =============================================================================
// Tests
// =============================================================================

describe('SyncDiffer', () => {
  describe('empty collections', () => {
    it('should return empty diff for empty source and device', () => {
      const differ = new SyncDiffer(createMockHandler());
      const result = differ.diff([], []);

      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual([]);
      expect(result.existing).toEqual([]);
      expect(result.toUpdate).toEqual([]);
    });

    it('should return all sources as toAdd when device is empty', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [src('Alpha'), src('Beta'), src('Gamma')];
      const result = differ.diff(sources, []);

      expect(result.toAdd).toEqual(sources);
      expect(result.toRemove).toEqual([]);
      expect(result.existing).toEqual([]);
      expect(result.toUpdate).toEqual([]);
    });

    it('should return all device items as toRemove when source is empty', () => {
      const differ = new SyncDiffer(createMockHandler());
      const devices = [dev('Alpha'), dev('Beta')];
      const result = differ.diff([], devices);

      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual(devices);
      expect(result.existing).toEqual([]);
      expect(result.toUpdate).toEqual([]);
    });
  });

  describe('perfect matches (existing)', () => {
    it('should identify matching items as existing', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [src('Alpha'), src('Beta')];
      const devices = [dev('Alpha'), dev('Beta')];
      const result = differ.diff(sources, devices);

      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual([]);
      expect(result.existing).toHaveLength(2);
      expect(result.existing[0]!.source.name).toBe('Alpha');
      expect(result.existing[0]!.device.name).toBe('Alpha');
      expect(result.existing[1]!.source.name).toBe('Beta');
      expect(result.existing[1]!.device.name).toBe('Beta');
      expect(result.toUpdate).toEqual([]);
    });
  });

  describe('updates (toUpdate)', () => {
    it('should detect items needing updates via handler.detectUpdates', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [src('Alpha', 2)]; // version 2
      const devices = [dev('Alpha', 1)]; // version 1 — mismatch
      const result = differ.diff(sources, devices);

      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual([]);
      expect(result.existing).toEqual([]);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0]!.source.name).toBe('Alpha');
      expect(result.toUpdate[0]!.device.name).toBe('Alpha');
      expect(result.toUpdate[0]!.reasons).toEqual(['metadata-correction']);
    });
  });

  describe('mixed scenarios', () => {
    it('should handle a mix of add, remove, existing, and update', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [
        src('Alpha', 1), // existing (matches)
        src('Beta', 2), // update (version mismatch)
        src('Gamma', 1), // add (not on device)
      ];
      const devices = [
        dev('Alpha', 1), // existing
        dev('Beta', 1), // update
        dev('Delta', 1), // remove (not in source)
      ];
      const result = differ.diff(sources, devices);

      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0]!.name).toBe('Gamma');

      expect(result.toRemove).toHaveLength(1);
      expect(result.toRemove[0]!.name).toBe('Delta');

      expect(result.existing).toHaveLength(1);
      expect(result.existing[0]!.source.name).toBe('Alpha');

      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0]!.source.name).toBe('Beta');
      expect(result.toUpdate[0]!.reasons).toEqual(['metadata-correction']);
    });
  });

  describe('transform key matching (applyTransformKey fallback)', () => {
    it('should match via applyTransformKey when primary key fails', () => {
      const handler = createMockHandler({
        applyTransformKey: (source: TestSource) => {
          // Transform "OldName" sources to match "NewName" device items
          if (source.transformName) {
            return source.transformName.toLowerCase();
          }
          return source.name.toLowerCase();
        },
      });

      const differ = new SyncDiffer(handler);
      const sources = [src('OldName', 1, 'NewName')];
      const devices = [dev('NewName', 1)];
      const result = differ.diff(sources, devices);

      // Should match via transform key, not end up in toAdd
      expect(result.toAdd).toEqual([]);
      expect(result.existing).toHaveLength(1);
      expect(result.existing[0]!.source.name).toBe('OldName');
      expect(result.existing[0]!.device.name).toBe('NewName');
    });

    it('should not try transform key if handler lacks applyTransformKey', () => {
      const handler = createMockHandler();
      // Explicitly remove applyTransformKey
      delete (handler as any).applyTransformKey;

      const differ = new SyncDiffer(handler);
      const sources = [src('OldName')];
      const devices = [dev('NewName')];
      const result = differ.diff(sources, devices);

      // No match — different names, no transform key
      expect(result.toAdd).toHaveLength(1);
      expect(result.toRemove).toHaveLength(1);
    });

    it('should not use transform key when it equals primary key', () => {
      let _transformCalls = 0;
      const handler = createMockHandler({
        applyTransformKey: (source: TestSource) => {
          _transformCalls++;
          // Transform returns same key — no actual transform
          return source.name.toLowerCase();
        },
        detectUpdates: () => {
          // Always report update so we can distinguish match vs no-match
          return ['metadata-correction'];
        },
      });

      const differ = new SyncDiffer(handler);
      const sources = [src('Alpha')];
      const devices = [dev('Alpha')];
      const result = differ.diff(sources, devices);

      // Should match on primary key; transform key was computed but not used for lookup
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toAdd).toEqual([]);
    });
  });

  describe('duplicate source handling', () => {
    it('should skip duplicate source items (same match key)', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [
        src('Alpha', 1),
        src('Alpha', 2), // Duplicate — should be skipped
      ];
      const devices = [dev('Alpha', 1)];
      const result = differ.diff(sources, devices);

      // Only first occurrence processed; version matches → existing
      expect(result.existing).toHaveLength(1);
      expect(result.existing[0]!.source.version).toBe(1); // First one wins
      expect(result.toAdd).toEqual([]);
      expect(result.toUpdate).toEqual([]);
    });

    it('should skip duplicate source items when no device match', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [
        src('Alpha', 1),
        src('Alpha', 2), // Duplicate — should be skipped
      ];
      const result = differ.diff(sources, []);

      // Only first occurrence goes to toAdd
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0]!.version).toBe(1);
    });
  });

  describe('duplicate device handling', () => {
    it('should handle duplicate device items gracefully (first wins in index)', () => {
      const differ = new SyncDiffer(createMockHandler());
      const sources = [src('Alpha', 1)];
      const devices = [
        dev('Alpha', 1, 'dev-alpha-1'),
        dev('Alpha', 2, 'dev-alpha-2'), // Duplicate key, different id
      ];
      const result = differ.diff(sources, devices);

      // First device item wins the index, second is unmatched → toRemove
      expect(result.existing).toHaveLength(1);
      expect(result.existing[0]!.device.deviceId).toBe('dev-alpha-1');
      expect(result.toRemove).toHaveLength(1);
      expect(result.toRemove[0]!.deviceId).toBe('dev-alpha-2');
    });
  });

  describe('transformsEnabled option', () => {
    it('should apply transformSourceForAdd when transformsEnabled is true', () => {
      let transformCalled = false;
      const handler = createMockHandler({
        transformSourceForAdd: (source: TestSource) => {
          transformCalled = true;
          return { ...source, name: `transformed-${source.name}` };
        },
      });

      const differ = new SyncDiffer(handler);
      const result = differ.diff([src('Alpha')], []);

      expect(transformCalled).toBe(true);
      expect(result.toAdd[0]!.name).toBe('transformed-Alpha');
    });

    it('should not transform when transformSourceForAdd returns source unchanged', () => {
      const handler = createMockHandler({
        transformSourceForAdd: (source: TestSource) => {
          // Handler returns source unchanged (transforms disabled internally)
          return source;
        },
      });

      const differ = new SyncDiffer(handler);
      const result = differ.diff([src('Alpha')], []);

      expect(result.toAdd[0]!.name).toBe('Alpha');
    });
  });

  describe('createSyncDiffer factory', () => {
    it('should create a working SyncDiffer instance', () => {
      const differ = createSyncDiffer(createMockHandler());
      const result = differ.diff([src('Alpha')], []);

      expect(result.toAdd).toHaveLength(1);
    });
  });
});
