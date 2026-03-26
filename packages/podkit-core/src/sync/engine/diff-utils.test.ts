import { describe, test, expect } from 'bun:test';
import { partitionExisting, sweepAllExisting, formatDryRunFromPlan } from './diff-utils.js';
import type { UnifiedSyncDiff } from './content-type.js';
import type { SyncPlan } from './types.js';

// =============================================================================
// Test helpers
// =============================================================================

type TestSource = { id: string; name: string };
type TestDevice = { id: string; name: string };

function makeDiff(
  existing: Array<{ source: TestSource; device: TestDevice }>
): UnifiedSyncDiff<TestSource, TestDevice> {
  return {
    toAdd: [],
    toRemove: [],
    existing,
    toUpdate: [],
  };
}

// =============================================================================
// partitionExisting
// =============================================================================

describe('partitionExisting', () => {
  test('moves matching items to toUpdate', () => {
    const diff = makeDiff([
      { source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } },
      { source: { id: '2', name: 'b' }, device: { id: '2', name: 'b' } },
      { source: { id: '3', name: 'c' }, device: { id: '3', name: 'c' } },
    ]);

    partitionExisting(diff, (match) => {
      if (match.source.id === '2') {
        return { reasons: ['force-transcode'], changes: [] };
      }
      return null;
    });

    expect(diff.existing).toHaveLength(2);
    expect(diff.existing.map((m) => m.source.id)).toEqual(['1', '3']);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.source.id).toBe('2');
    expect(diff.toUpdate[0]!.reasons).toEqual(['force-transcode']);
  });

  test('preserves all items when predicate returns null for all', () => {
    const diff = makeDiff([
      { source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } },
      { source: { id: '2', name: 'b' }, device: { id: '2', name: 'b' } },
    ]);

    partitionExisting(diff, () => null);

    expect(diff.existing).toHaveLength(2);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('moves all items when predicate matches all', () => {
    const diff = makeDiff([
      { source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } },
      { source: { id: '2', name: 'b' }, device: { id: '2', name: 'b' } },
    ]);

    partitionExisting(diff, () => ({ reasons: ['force-metadata'] }));

    expect(diff.existing).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(2);
  });

  test('appends to existing toUpdate entries', () => {
    const diff = makeDiff([{ source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } }]);
    diff.toUpdate.push({
      source: { id: '0', name: 'pre' },
      device: { id: '0', name: 'pre' },
      reasons: ['metadata-correction'],
    });

    partitionExisting(diff, () => ({ reasons: ['force-transcode'] }));

    expect(diff.toUpdate).toHaveLength(2);
    expect(diff.toUpdate[0]!.source.id).toBe('0');
    expect(diff.toUpdate[1]!.source.id).toBe('1');
  });

  test('passes syncTag through to toUpdate entry', () => {
    const diff = makeDiff([{ source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } }]);

    const tag = { quality: 'high' };
    partitionExisting(diff, () => ({ reasons: ['sync-tag-write'], changes: [], syncTag: tag }));

    expect(diff.toUpdate[0]!.syncTag).toBe(tag);
  });

  test('handles empty existing array', () => {
    const diff = makeDiff([]);

    partitionExisting(diff, () => ({ reasons: ['force-metadata'] }));

    expect(diff.existing).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// sweepAllExisting
// =============================================================================

describe('sweepAllExisting', () => {
  test('moves all existing to toUpdate with given reason', () => {
    const diff = makeDiff([
      { source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } },
      { source: { id: '2', name: 'b' }, device: { id: '2', name: 'b' } },
    ]);

    sweepAllExisting(diff, 'force-metadata');

    expect(diff.existing).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(2);
    expect(diff.toUpdate[0]!.reasons).toEqual(['force-metadata']);
    expect(diff.toUpdate[1]!.reasons).toEqual(['force-metadata']);
  });

  test('calls buildEntry callback for each item', () => {
    const diff = makeDiff([{ source: { id: '1', name: 'a' }, device: { id: '1', name: 'x' } }]);

    sweepAllExisting(diff, 'force-metadata', (match) => ({
      changes: [{ field: 'title', from: match.device.name, to: match.source.name }],
    }));

    expect(diff.toUpdate[0]!.changes).toEqual([{ field: 'title', from: 'x', to: 'a' }]);
  });

  test('works without buildEntry callback', () => {
    const diff = makeDiff([{ source: { id: '1', name: 'a' }, device: { id: '1', name: 'a' } }]);

    sweepAllExisting(diff, 'force-metadata');

    expect(diff.toUpdate[0]!.changes).toBeUndefined();
  });

  test('handles empty existing array', () => {
    const diff = makeDiff([]);

    sweepAllExisting(diff, 'force-metadata');

    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// formatDryRunFromPlan
// =============================================================================

describe('formatDryRunFromPlan', () => {
  const mockPlan: SyncPlan = {
    operations: [
      { type: 'add-transcode', source: {} } as any,
      { type: 'add-direct-copy', source: {} } as any,
      { type: 'remove', track: {} } as any,
      { type: 'update-metadata', track: {}, metadata: {} } as any,
    ],
    estimatedSize: 1000,
    estimatedTime: 60,
    warnings: [{ type: 'lossy-to-lossy', message: 'warn1', tracks: [] }],
  };

  const classify = (type: string) => {
    if (type.startsWith('add-')) return 'add' as const;
    if (type === 'remove') return 'remove' as const;
    if (type.startsWith('update-')) return 'update' as const;
    return null;
  };

  test('counts operations by category', () => {
    const result = formatDryRunFromPlan(
      mockPlan,
      classify,
      (op) => op.type,
      () => 100
    );

    expect(result.toAdd).toBe(2);
    expect(result.toRemove).toBe(1);
    expect(result.toUpdate).toBe(1);
  });

  test('counts operations by type', () => {
    const result = formatDryRunFromPlan(
      mockPlan,
      classify,
      (op) => op.type,
      () => 100
    );

    expect(result.operationCounts).toEqual({
      'add-transcode': 1,
      'add-direct-copy': 1,
      remove: 1,
      'update-metadata': 1,
    });
  });

  test('preserves plan-level fields', () => {
    const result = formatDryRunFromPlan(
      mockPlan,
      classify,
      (op) => op.type,
      () => 100
    );

    expect(result.estimatedSize).toBe(1000);
    expect(result.estimatedTime).toBe(60);
    expect(result.warnings).toEqual(['warn1']);
    expect(result.existing).toBe(0);
  });

  test('builds operations array with display names and sizes', () => {
    const result = formatDryRunFromPlan(
      mockPlan,
      classify,
      () => 'display',
      () => 42
    );

    expect(result.operations).toHaveLength(4);
    expect(result.operations[0]).toEqual({
      type: 'add-transcode',
      displayName: 'display',
      size: 42,
    });
  });

  test('handles empty plan', () => {
    const emptyPlan: SyncPlan = {
      operations: [],
      estimatedSize: 0,
      estimatedTime: 0,
      warnings: [],
    };

    const result = formatDryRunFromPlan(
      emptyPlan,
      classify,
      (op) => op.type,
      () => 0
    );

    expect(result.toAdd).toBe(0);
    expect(result.toRemove).toBe(0);
    expect(result.toUpdate).toBe(0);
    expect(result.operations).toHaveLength(0);
  });

  test('ignores operations with null classification', () => {
    const plan: SyncPlan = {
      operations: [{ type: 'unknown-op' } as any],
      estimatedSize: 0,
      estimatedTime: 0,
      warnings: [],
    };

    const result = formatDryRunFromPlan(
      plan,
      () => null,
      (op) => op.type,
      () => 0
    );

    expect(result.toAdd).toBe(0);
    expect(result.toRemove).toBe(0);
    expect(result.toUpdate).toBe(0);
    expect(result.operationCounts).toEqual({ 'unknown-op': 1 });
    expect(result.operations).toHaveLength(1);
  });
});
