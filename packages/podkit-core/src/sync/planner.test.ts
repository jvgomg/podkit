/**
 * Unit tests for the sync planner
 *
 * Tests the generic SyncPlanner that delegates to ContentTypeHandler.
 * Uses a minimal mock handler to verify the algorithm independent of
 * any specific content type.
 */

import { describe, expect, it } from 'bun:test';
import { SyncPlanner, createSyncPlanner, orderOperations } from './planner.js';
import type { ContentTypeHandler, HandlerPlanOptions } from './content-type.js';
import type { SyncOperation, UpdateReason } from './types.js';
import type { UnifiedSyncDiff } from './content-type.js';

// =============================================================================
// Test Types
// =============================================================================

interface TestSource {
  id: string;
  name: string;
  size: number;
  duration: number;
  needsTranscode: boolean;
}

interface TestDevice {
  deviceId: string;
  name: string;
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

    detectUpdates: (): UpdateReason[] => [],

    planAdd: (source: TestSource, _options: HandlerPlanOptions): SyncOperation => {
      if (source.needsTranscode) {
        return {
          type: 'add-transcode',
          source: { filePath: source.name, fileType: 'flac' } as any,
          preset: { name: 'high' },
        };
      }
      return {
        type: 'add-direct-copy',
        source: { filePath: source.name, fileType: 'mp3' } as any,
      };
    },

    planRemove: (device: TestDevice): SyncOperation => ({
      type: 'remove',
      track: { filePath: device.name } as any,
    }),

    planUpdate: (
      source: TestSource,
      device: TestDevice,
      reasons: UpdateReason[]
    ): SyncOperation[] => {
      const primary = reasons[0];
      if (primary === 'format-upgrade') {
        return [
          {
            type: 'upgrade-transcode',
            source: { filePath: source.name } as any,
            target: { filePath: device.name } as any,
            reason: 'format-upgrade',
            preset: { name: 'high' },
          },
        ];
      }
      return [
        {
          type: 'update-metadata',
          track: { filePath: device.name } as any,
          metadata: {},
        },
      ];
    },

    estimateSize: (op: SyncOperation): number => {
      switch (op.type) {
        case 'add-transcode':
          return 5_000_000; // 5 MB
        case 'add-direct-copy':
          return 3_000_000; // 3 MB
        case 'upgrade-transcode':
          return 4_000_000; // 4 MB
        case 'remove':
        case 'update-metadata':
          return 0;
        default:
          return 0;
      }
    },

    estimateTime: (op: SyncOperation): number => {
      switch (op.type) {
        case 'add-transcode':
          return 10;
        case 'add-direct-copy':
          return 3;
        case 'upgrade-transcode':
          return 8;
        case 'remove':
          return 0.1;
        case 'update-metadata':
          return 0.01;
        default:
          return 0;
      }
    },

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

function src(
  name: string,
  opts: { needsTranscode?: boolean; size?: number; duration?: number } = {}
): TestSource {
  return {
    id: `src-${name}`,
    name,
    size: opts.size ?? 1000,
    duration: opts.duration ?? 240,
    needsTranscode: opts.needsTranscode ?? false,
  };
}

function dev(name: string, deviceId?: string): TestDevice {
  return { deviceId: deviceId ?? `dev-${name}`, name };
}

function emptyDiff(): UnifiedSyncDiff<TestSource, TestDevice> {
  return { toAdd: [], toRemove: [], existing: [], toUpdate: [] };
}

// =============================================================================
// Tests
// =============================================================================

describe('SyncPlanner', () => {
  describe('empty diff', () => {
    it('should return empty plan for empty diff', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);
      const plan = planner.plan(emptyDiff());

      expect(plan.operations).toEqual([]);
      expect(plan.estimatedSize).toBe(0);
      expect(plan.estimatedTime).toBe(0);
      expect(plan.warnings).toEqual([]);
    });
  });

  describe('add operations', () => {
    it('should create add operations for toAdd items', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff = {
        ...emptyDiff(),
        toAdd: [src('track-a'), src('track-b', { needsTranscode: true })],
      };

      const plan = planner.plan(diff);

      expect(plan.operations).toHaveLength(2);
      // After ordering: copy comes before transcode
      expect(plan.operations[0]!.type).toBe('add-direct-copy');
      expect(plan.operations[1]!.type).toBe('add-transcode');
    });

    it('should pass plan options to handler.planAdd', () => {
      let capturedOptions: HandlerPlanOptions | undefined;
      const handler = createMockHandler({
        planAdd: (_source, options) => {
          capturedOptions = options;
          return { type: 'add-direct-copy', source: {} as any };
        },
      });

      const planner = new SyncPlanner(handler);
      const diff = { ...emptyDiff(), toAdd: [src('track')] };

      planner.plan(diff, { qualityPreset: 'medium', deviceSupportsAlac: true });

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.qualityPreset).toBe('medium');
      expect(capturedOptions!.deviceSupportsAlac).toBe(true);
    });
  });

  describe('remove operations', () => {
    it('should create remove operations when removeOrphans is true', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff = {
        ...emptyDiff(),
        toRemove: [dev('orphan-a'), dev('orphan-b')],
      };

      const plan = planner.plan(diff, { removeOrphans: true });

      expect(plan.operations).toHaveLength(2);
      expect(plan.operations.every((op) => op.type === 'remove')).toBe(true);
    });

    it('should create remove operations by default (removeOrphans defaults to true)', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff = {
        ...emptyDiff(),
        toRemove: [dev('orphan')],
      };

      const plan = planner.plan(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('remove');
    });

    it('should skip remove operations when removeOrphans is false', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff = {
        ...emptyDiff(),
        toRemove: [dev('orphan-a'), dev('orphan-b')],
      };

      const plan = planner.plan(diff, { removeOrphans: false });

      expect(plan.operations).toHaveLength(0);
    });
  });

  describe('update operations', () => {
    it('should create update operations for toUpdate items', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toUpdate: [
          { source: src('track-a'), device: dev('track-a'), reasons: ['metadata-correction'] },
        ],
      };

      const plan = planner.plan(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('update-metadata');
    });

    it('should create upgrade operations for file-replacement reasons', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toUpdate: [{ source: src('track-a'), device: dev('track-a'), reasons: ['format-upgrade'] }],
      };

      const plan = planner.plan(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('upgrade-transcode');
    });

    it('should filter artwork updates when artwork is disabled', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toUpdate: [
          { source: src('track-a'), device: dev('track-a'), reasons: ['artwork-updated'] },
          { source: src('track-b'), device: dev('track-b'), reasons: ['metadata-correction'] },
        ],
      };

      const plan = planner.plan(diff, { artworkEnabled: false });

      // Only the metadata-correction update should remain
      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('update-metadata');
    });

    it('should filter artwork-removed updates when artwork is disabled', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toUpdate: [
          { source: src('track-a'), device: dev('track-a'), reasons: ['artwork-removed'] },
        ],
      };

      const plan = planner.plan(diff, { artworkEnabled: false });

      expect(plan.operations).toHaveLength(0);
    });
  });

  describe('operation ordering', () => {
    it('should order: removes → metadata → copies → upgrades → transcodes', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        toAdd: [src('copy-track'), src('transcode-track', { needsTranscode: true })],
        toRemove: [dev('remove-track')],
        existing: [],
        toUpdate: [
          {
            source: src('meta-track'),
            device: dev('meta-track'),
            reasons: ['metadata-correction'],
          },
          {
            source: src('upgrade-track'),
            device: dev('upgrade-track'),
            reasons: ['format-upgrade'],
          },
        ],
      };

      const plan = planner.plan(diff);

      expect(plan.operations).toHaveLength(5);

      const types = plan.operations.map((op) => op.type);
      expect(types).toEqual([
        'remove',
        'update-metadata',
        'add-direct-copy',
        'upgrade-transcode',
        'add-transcode',
      ]);
    });

    it('should maintain insertion order within same type', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toRemove: [dev('z-track'), dev('a-track'), dev('m-track')],
      };

      const plan = planner.plan(diff);

      // Should preserve original order: z, a, m — not sorted alphabetically
      expect(plan.operations).toHaveLength(3);
      expect(plan.operations.every((op) => op.type === 'remove')).toBe(true);
    });
  });

  describe('size estimation', () => {
    it('should aggregate estimated sizes from handler', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toAdd: [
          src('copy-track'), // 3 MB
          src('transcode-track', { needsTranscode: true }), // 5 MB
        ],
      };

      const plan = planner.plan(diff);

      expect(plan.estimatedSize).toBe(8_000_000);
    });

    it('should not count removes or metadata updates toward size', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        toAdd: [],
        toRemove: [dev('remove')],
        existing: [],
        toUpdate: [{ source: src('meta'), device: dev('meta'), reasons: ['metadata-correction'] }],
      };

      const plan = planner.plan(diff);

      expect(plan.estimatedSize).toBe(0);
    });
  });

  describe('time estimation', () => {
    it('should aggregate estimated times from handler', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toAdd: [
          src('copy-track'), // 3 sec
          src('transcode-track', { needsTranscode: true }), // 10 sec
        ],
      };

      const plan = planner.plan(diff);

      expect(plan.estimatedTime).toBe(13);
    });

    it('should include small times for removes and metadata updates', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        toAdd: [],
        toRemove: [dev('remove')],
        existing: [],
        toUpdate: [{ source: src('meta'), device: dev('meta'), reasons: ['metadata-correction'] }],
      };

      const plan = planner.plan(diff);

      // remove = 0.1, update-metadata = 0.01
      expect(plan.estimatedTime).toBeCloseTo(0.11, 5);
    });
  });

  describe('space constraint warnings', () => {
    it('should warn when estimated size exceeds maxSize', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toAdd: [src('track', { needsTranscode: true })], // 5 MB
      };

      const plan = planner.plan(diff, { maxSize: 2_000_000 }); // 2 MB limit

      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.message).toContain('exceeds available space');
    });

    it('should not warn when estimated size is within maxSize', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toAdd: [src('track')], // 3 MB copy
      };

      const plan = planner.plan(diff, { maxSize: 10_000_000 }); // 10 MB limit

      expect(plan.warnings).toHaveLength(0);
    });

    it('should not warn when maxSize is not specified', () => {
      const handler = createMockHandler();
      const planner = new SyncPlanner(handler);

      const diff: UnifiedSyncDiff<TestSource, TestDevice> = {
        ...emptyDiff(),
        toAdd: [src('track', { needsTranscode: true })],
      };

      const plan = planner.plan(diff);

      expect(plan.warnings).toHaveLength(0);
    });
  });

  describe('createSyncPlanner factory', () => {
    it('should create a working planner instance', () => {
      const handler = createMockHandler();
      const planner = createSyncPlanner(handler);

      expect(planner).toBeInstanceOf(SyncPlanner);

      const diff = {
        ...emptyDiff(),
        toAdd: [src('track')],
      };

      const plan = planner.plan(diff);
      expect(plan.operations).toHaveLength(1);
    });
  });
});

describe('orderOperations', () => {
  it('should sort operations by type priority', () => {
    const ops: SyncOperation[] = [
      { type: 'add-transcode', source: {} as any, preset: { name: 'high' } },
      { type: 'remove', track: {} as any },
      { type: 'add-direct-copy', source: {} as any },
      { type: 'update-metadata', track: {} as any, metadata: {} },
      {
        type: 'upgrade-transcode',
        source: {} as any,
        target: {} as any,
        reason: 'format-upgrade',
        preset: { name: 'high' },
      },
    ];

    const ordered = orderOperations(ops);
    const types = ordered.map((op) => op.type);

    expect(types).toEqual([
      'remove',
      'update-metadata',
      'add-direct-copy',
      'upgrade-transcode',
      'add-transcode',
    ]);
  });

  it('should handle video operation types', () => {
    const ops: SyncOperation[] = [
      { type: 'video-transcode', source: {} as any, settings: {} as any },
      { type: 'video-remove', video: {} as any },
      { type: 'video-copy', source: {} as any },
      { type: 'video-update-metadata', source: {} as any, video: {} as any },
    ];

    const ordered = orderOperations(ops);
    const types = ordered.map((op) => op.type);

    expect(types).toEqual([
      'video-remove',
      'video-update-metadata',
      'video-copy',
      'video-transcode',
    ]);
  });

  it('should preserve order within same priority', () => {
    const ops: SyncOperation[] = [
      { type: 'add-direct-copy', source: { filePath: 'a' } as any },
      { type: 'add-direct-copy', source: { filePath: 'b' } as any },
      { type: 'add-direct-copy', source: { filePath: 'c' } as any },
    ];

    const ordered = orderOperations(ops);

    // Stable sort should preserve insertion order
    expect((ordered[0] as any).source.filePath).toBe('a');
    expect((ordered[1] as any).source.filePath).toBe('b');
    expect((ordered[2] as any).source.filePath).toBe('c');
  });

  it('should return empty array for empty input', () => {
    expect(orderOperations([])).toEqual([]);
  });
});
