/**
 * Unit tests for the sync executor
 *
 * Tests the generic SyncExecutor that delegates to ContentTypeHandler.
 * Uses minimal mock handlers to verify both per-operation and batch
 * execution paths.
 */

import { describe, expect, it } from 'bun:test';
import { SyncExecutor, createSyncExecutor } from './executor.js';
import { AbortError } from './errors.js';
import type { ContentTypeHandler, ExecutionContext, OperationProgress } from './content-type.js';
import type {
  SyncOperation,
  SyncPlan,
  UpdateReason,
  ExecutorProgress,
  ExecuteResult,
} from './types.js';

// =============================================================================
// Test Types
// =============================================================================

interface TestSource {
  id: string;
  name: string;
}

interface TestDevice {
  deviceId: string;
  name: string;
}

// =============================================================================
// Helpers
// =============================================================================

function makePlan(operations: SyncOperation[], estimatedSize = 1000): SyncPlan {
  return {
    operations,
    estimatedTime: operations.length * 10,
    estimatedSize,
    warnings: [],
  };
}

function makeCopyOp(name: string): SyncOperation {
  return { type: 'add-direct-copy', source: { filePath: name, fileType: 'mp3' } as any };
}

function makeTranscodeOp(name: string): SyncOperation {
  return {
    type: 'add-transcode',
    source: { filePath: name, fileType: 'flac' } as any,
    preset: { name: 'high' },
  };
}

function makeRemoveOp(name: string): SyncOperation {
  return { type: 'remove', track: { filePath: name } as any };
}

/**
 * Consume an async generator, collecting yielded values and returning the return value
 */
async function consumeExecutor(
  gen: AsyncGenerator<ExecutorProgress, ExecuteResult>
): Promise<{ events: ExecutorProgress[]; result: ExecuteResult }> {
  const events: ExecutorProgress[] = [];
  let done = false;
  let result!: ExecuteResult;

  while (!done) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      done = true;
    } else {
      events.push(next.value);
    }
  }

  return { events, result };
}

/**
 * A minimal no-op device stub. Tests pass this where the executor needs a
 * `device` but does not care about save coordination; the final-save in
 * `executor.ts` (mirrors `music/pipeline.ts:1349`) requires `save()` to
 * exist, so a plain `{}` cast crashes at the end of execute.
 */
const mockDevice = () => ({ save: async () => {} }) as any;

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

    planAdd: (source: TestSource): SyncOperation => ({
      type: 'add-direct-copy',
      source: { filePath: source.name, fileType: 'mp3' } as any,
    }),

    planRemove: (device: TestDevice): SyncOperation => ({
      type: 'remove',
      track: { filePath: device.name } as any,
    }),

    planUpdate: (): SyncOperation[] => [],
    estimateSize: () => 1000,
    estimateTime: () => 1,

    getOperationPriority: (op: SyncOperation): number => {
      switch (op.type) {
        case 'remove':
        case 'video-remove':
          return 0;
        case 'update-metadata':
        case 'update-sync-tag':
        case 'video-update-metadata':
          return 1;
        case 'add-direct-copy':
        case 'add-optimized-copy':
        case 'video-copy':
          return 2;
        case 'upgrade-transcode':
        case 'upgrade-direct-copy':
        case 'upgrade-optimized-copy':
        case 'upgrade-artwork':
        case 'video-upgrade':
          return 3;
        case 'add-transcode':
        case 'video-transcode':
          return 4;
        default:
          return 5;
      }
    },

    async *execute(op: SyncOperation, _ctx: ExecutionContext): AsyncGenerator<OperationProgress> {
      yield { operation: op, phase: 'starting' };
      yield { operation: op, phase: 'complete' };
    },

    getDeviceItems: () => [],
    getDisplayName: (op: SyncOperation) => {
      if ('source' in op && op.source && 'filePath' in op.source) return op.source.filePath;
      if ('track' in op && op.track && 'filePath' in op.track) return op.track.filePath;
      return 'unknown';
    },
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
// Tests
// =============================================================================

describe('SyncExecutor', () => {
  describe('per-operation execution', () => {
    it('executes operations in order and yields progress', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3'), makeRemoveOp('c.mp3')]);

      const { events, result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice() })
      );

      // Each operation yields starting + complete = 2 events per op
      expect(events.length).toBe(6);
      expect(result.completed).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('sets correct index and total on progress events', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      // First operation events: index=0, total=2
      expect(events[0]!.index).toBe(0);
      expect(events[0]!.total).toBe(2);

      // Second operation events: index=1, total=2
      expect(events[2]!.index).toBe(1);
      expect(events[2]!.total).toBe(2);
    });

    it('maps operation types to correct phases', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([
        makeCopyOp('a.mp3'),
        makeTranscodeOp('b.flac'),
        makeRemoveOp('c.mp3'),
      ]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('copying');
      expect(events[2]!.phase).toBe('transcoding');
      expect(events[4]!.phase).toBe('removing');
    });
  });

  describe('batch execution', () => {
    it('uses executeBatch when handler provides it', async () => {
      let batchCalled = false;

      const handler = createMockHandler({
        async *executeBatch(
          operations: SyncOperation[],
          _ctx: ExecutionContext
        ): AsyncGenerator<OperationProgress> {
          batchCalled = true;
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { result } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(batchCalled).toBe(true);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('propagates continueOnError into the ExecutionContext for executeBatch handlers', async () => {
      let seenContinueOnError: boolean | undefined;

      const handler = createMockHandler({
        async *executeBatch(
          operations: SyncOperation[],
          ctx: ExecutionContext
        ): AsyncGenerator<OperationProgress> {
          seenContinueOnError = ctx.continueOnError;
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), continueOnError: true })
      );

      expect(seenContinueOnError).toBe(true);
    });

    it('does not use executeBatch in dry-run mode', async () => {
      let batchCalled = false;

      const handler = createMockHandler({
        async *executeBatch(): AsyncGenerator<OperationProgress> {
          batchCalled = true;
          return;
          yield undefined as unknown as OperationProgress; // satisfy require-yield
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      const { result } = await consumeExecutor(executor.execute(plan, { dryRun: true }));

      expect(batchCalled).toBe(false);
      expect(result.skipped).toBe(1);
    });
  });

  describe('error handling', () => {
    it('categorizes errors and tracks failed count', async () => {
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          yield { operation: op, phase: 'starting' };
          throw new Error('FFmpeg transcode failed');
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeTranscodeOp('a.flac')]);

      const { events, result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice() })
      );

      expect(result.failed).toBe(1);
      expect(result.completed).toBe(0);
      expect(result.categorizedErrors.length).toBe(1);
      expect(result.categorizedErrors[0]!.category).toBe('transcode');

      // Error progress event should have categorizedError
      const errorEvent = events.find((e) => e.categorizedError);
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toBe('FFmpeg transcode failed');
    });

    it('stops on error when continueOnError is false', async () => {
      let executeCount = 0;
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          executeCount++;
          if (executeCount === 1) {
            throw new Error('first op failed');
          }
          yield { operation: op, phase: 'complete' };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), continueOnError: false })
      );

      expect(executeCount).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.completed).toBe(0);
    });

    it('continues on error when continueOnError is true', async () => {
      let executeCount = 0;
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          executeCount++;
          if (executeCount === 1) {
            throw new Error('first op failed');
          }
          yield { operation: op, phase: 'starting' };
          yield { operation: op, phase: 'complete' };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), continueOnError: true })
      );

      expect(executeCount).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.completed).toBe(1);
    });

    it('handles errors in batch execution path', async () => {
      const handler = createMockHandler({
        async *executeBatch(operations: SyncOperation[]): AsyncGenerator<OperationProgress> {
          yield { operation: operations[0]!, phase: 'starting' };
          yield { operation: operations[0]!, phase: 'failed', error: new Error('batch error') };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      const { result } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(result.failed).toBe(1);
      expect(result.categorizedErrors.length).toBe(1);
    });

    it('handles batch generator throwing', async () => {
      const handler = createMockHandler({
        async *executeBatch(): AsyncGenerator<OperationProgress> {
          throw new Error('batch generator exploded');
          yield undefined as unknown as OperationProgress; // satisfy require-yield
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      const { result } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(result.failed).toBe(1);
      expect(result.categorizedErrors[0]!.error.message).toBe('batch generator exploded');
    });
  });

  describe('abort signal', () => {
    it('stops execution when signal is aborted', async () => {
      let executeCount = 0;
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          executeCount++;
          yield { operation: op, phase: 'starting' };
          yield { operation: op, phase: 'complete' };
        },
      });

      const controller = new AbortController();
      // Abort before execution begins
      controller.abort();

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), signal: controller.signal })
      );

      expect(executeCount).toBe(0);
      expect(result.aborted).toBe(true);
      expect(result.completed).toBe(0);
    });

    it('stops between operations when signal is aborted mid-execution', async () => {
      let executeCount = 0;
      const controller = new AbortController();

      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          executeCount++;
          yield { operation: op, phase: 'starting' };
          yield { operation: op, phase: 'complete' };
          // Abort after first operation completes
          if (executeCount === 1) controller.abort();
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3'), makeCopyOp('c.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), signal: controller.signal })
      );

      expect(executeCount).toBe(1);
      expect(result.completed).toBe(1);
      expect(result.aborted).toBe(true);
    });
  });

  describe('dry-run mode', () => {
    it('yields skipped progress for each operation without executing', async () => {
      let executeCalled = false;
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          executeCalled = true;
          yield { operation: op, phase: 'complete' };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeTranscodeOp('b.flac')]);

      const { events, result } = await consumeExecutor(executor.execute(plan, { dryRun: true }));

      expect(executeCalled).toBe(false);
      expect(result.skipped).toBe(2);
      expect(result.completed).toBe(0);
      expect(events.length).toBe(2);
      expect(events[0]!.skipped).toBe(true);
      expect(events[1]!.skipped).toBe(true);
    });

    it('sets correct phases in dry-run mode', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeRemoveOp('b.mp3')]);

      const { events } = await consumeExecutor(executor.execute(plan, { dryRun: true }));

      expect(events[0]!.phase).toBe('copying');
      expect(events[1]!.phase).toBe('removing');
    });
  });

  describe('checkpoint saves', () => {
    it('calls ipod.save() at saveInterval', async () => {
      let saveCount = 0;
      const mockIpod = {
        save: async () => {
          saveCount++;
        },
      } as any;

      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([
        makeCopyOp('a.mp3'),
        makeCopyOp('b.mp3'),
        makeCopyOp('c.mp3'),
        makeCopyOp('d.mp3'),
        makeCopyOp('e.mp3'),
      ]);

      await consumeExecutor(executor.execute(plan, { device: mockIpod, saveInterval: 2 }));

      // 5 completed, saveInterval=2 -> 2 checkpoint saves (at completed=2,
      // completed=4) + 1 final save when execute() returns = 3 total.
      expect(saveCount).toBe(3);
    });

    it('disabling saveInterval still triggers the final save', async () => {
      // Final save is independent of saveInterval: it fires whenever the
      // run completed (or failed) any operations, mirroring the music
      // pipeline's post-loop save.
      let saveCount = 0;
      const mockIpod = {
        save: async () => {
          saveCount++;
        },
      } as any;

      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      await consumeExecutor(executor.execute(plan, { device: mockIpod, saveInterval: 0 }));

      // 0 checkpoints + 1 final = 1.
      expect(saveCount).toBe(1);
    });

    it('calls ipod.save() in batch path at saveInterval', async () => {
      let saveCount = 0;
      const mockIpod = {
        save: async () => {
          saveCount++;
        },
      } as any;

      const handler = createMockHandler({
        async *executeBatch(operations: SyncOperation[]): AsyncGenerator<OperationProgress> {
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3'), makeCopyOp('c.mp3')]);

      await consumeExecutor(executor.execute(plan, { device: mockIpod, saveInterval: 2 }));

      // 3 completed, saveInterval=2 -> 1 checkpoint at completed=2 + 1 final
      // save when batch path returns = 2 total.
      expect(saveCount).toBe(2);
    });

    it('skips final save when nothing executed (empty plan)', async () => {
      let saveCount = 0;
      const mockIpod = {
        save: async () => {
          saveCount++;
        },
      } as any;

      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([]);

      await consumeExecutor(executor.execute(plan, { device: mockIpod }));

      expect(saveCount).toBe(0);
    });

    it('skips final save when aborted mid-run', async () => {
      let saveCount = 0;
      const mockIpod = {
        save: async () => {
          saveCount++;
        },
      } as any;

      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const controller = new AbortController();
      controller.abort();

      await consumeExecutor(
        executor.execute(plan, { device: mockIpod, signal: controller.signal })
      );

      // Aborted before any operation completed → no checkpoint AND no final
      // save. Saves on the abort path are the orchestrator's job (see
      // `runCollectionPhase`'s interrupt-flow save).
      expect(saveCount).toBe(0);
    });
  });

  describe('transcodeProgress forwarding', () => {
    it('forwards transcodeProgress from handler to executor progress', async () => {
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          yield {
            operation: op,
            phase: 'in-progress',
            transcodeProgress: { percent: 50, speed: 2.0 },
          };
          yield { operation: op, phase: 'complete' };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeTranscodeOp('a.flac')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      const progressEvent = events.find((e) => e.transcodeProgress);
      expect(progressEvent).toBeDefined();
      expect(progressEvent!.transcodeProgress!.percent).toBe(50);
    });

    it('forwards transcodeProgress through batch execution path', async () => {
      const handler = createMockHandler({
        async *executeBatch(operations: SyncOperation[]): AsyncGenerator<OperationProgress> {
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield {
              operation: op,
              phase: 'in-progress',
              transcodeProgress: { percent: 75, speed: 1.5 },
            };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeTranscodeOp('a.flac')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      const progressEvent = events.find((e) => e.transcodeProgress);
      expect(progressEvent).toBeDefined();
      expect(progressEvent!.transcodeProgress!.percent).toBe(75);
      expect(progressEvent!.transcodeProgress!.speed).toBe(1.5);
    });
  });

  describe('result aggregation', () => {
    it('returns correct totals for mixed success/failure', async () => {
      let callCount = 0;
      const handler = createMockHandler({
        async *execute(op: SyncOperation): AsyncGenerator<OperationProgress> {
          callCount++;
          if (callCount === 2) {
            throw new Error('failed');
          }
          yield { operation: op, phase: 'starting' };
          yield { operation: op, phase: 'complete' };
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3'), makeCopyOp('c.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), continueOnError: true })
      );

      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.categorizedErrors.length).toBe(1);
    });

    it('returns empty result for empty plan', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([]);

      const { events, result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice() })
      );

      expect(events.length).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('batch abort signal', () => {
    it('stops batch execution when signal is aborted after first operation', async () => {
      const controller = new AbortController();
      let yieldCount = 0;

      const handler = createMockHandler({
        async *executeBatch(operations: SyncOperation[]): AsyncGenerator<OperationProgress> {
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
            yieldCount++;
            // Abort after first operation completes
            if (yieldCount === 1) controller.abort();
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3'), makeCopyOp('c.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), signal: controller.signal })
      );

      expect(result.aborted).toBe(true);
      expect(result.completed).toBe(1);
    });

    it('treats AbortError thrown by handler as abort, not failure', async () => {
      // Pins the ADR-019 Phase 4b contract: the music pipeline throws
      // AbortError after draining queues post-signal-abort. The engine must
      // recognise it and set result.aborted=true rather than recording a
      // synthetic per-operation failure (which would lie about result.aborted
      // and pollute result.errors / result.failed).
      const controller = new AbortController();

      const handler = createMockHandler({
        async *executeBatch(operations: SyncOperation[]): AsyncGenerator<OperationProgress> {
          // Yield one complete then throw AbortError (pipeline's post-drain
          // pattern: stages have already finished cleanly).
          yield { operation: operations[0]!, phase: 'starting' };
          yield { operation: operations[0]!, phase: 'complete' };
          controller.abort();
          throw new AbortError();
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3'), makeCopyOp('b.mp3')]);

      const { result } = await consumeExecutor(
        executor.execute(plan, { device: mockDevice(), signal: controller.signal })
      );

      expect(result.aborted).toBe(true);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('operation phase mapping (convention-based)', () => {
    function makeVideoTranscodeOp(name: string): SyncOperation {
      return {
        type: 'video-transcode',
        source: { filePath: name } as any,
        settings: {} as any,
      };
    }

    function makeVideoCopyOp(name: string): SyncOperation {
      return { type: 'video-copy', source: { filePath: name } as any };
    }

    function makeVideoRemoveOp(name: string): SyncOperation {
      return { type: 'video-remove', video: { filePath: name } as any };
    }

    function makeVideoUpdateMetadataOp(name: string): SyncOperation {
      return {
        type: 'video-update-metadata',
        source: { filePath: name } as any,
        video: { filePath: name } as any,
      };
    }

    function makeVideoUpgradeOp(name: string): SyncOperation {
      return {
        type: 'video-upgrade',
        source: { filePath: name } as any,
        target: { filePath: name } as any,
        reason: 'format-upgrade' as any,
      };
    }

    it('maps video-transcode to transcoding phase', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeVideoTranscodeOp('video.mkv')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('transcoding');
    });

    it('maps video-copy to copying phase', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeVideoCopyOp('video.m4v')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('copying');
    });

    it('maps video-remove to removing phase', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeVideoRemoveOp('old-video.m4v')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('removing');
    });

    it('maps video-update-metadata to updating-metadata phase', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeVideoUpdateMetadataOp('video.m4v')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('updating-metadata');
    });

    it('maps video-upgrade to upgrading phase', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeVideoUpgradeOp('video.m4v')]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(events[0]!.phase).toBe('upgrading');
    });

    it('maps all video types correctly in a single plan', async () => {
      const handler = createMockHandler();
      const executor = new SyncExecutor(handler);
      const plan = makePlan([
        makeVideoTranscodeOp('a.mkv'),
        makeVideoCopyOp('b.m4v'),
        makeVideoRemoveOp('c.m4v'),
        makeVideoUpdateMetadataOp('d.m4v'),
        makeVideoUpgradeOp('e.m4v'),
      ]);

      const { events } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      // Each op yields 2 events (starting + complete), first event of each has the phase
      expect(events[0]!.phase).toBe('transcoding');
      expect(events[2]!.phase).toBe('copying');
      expect(events[4]!.phase).toBe('removing');
      expect(events[6]!.phase).toBe('updating-metadata');
      expect(events[8]!.phase).toBe('upgrading');
    });
  });

  describe('createSyncExecutor factory', () => {
    it('creates an executor instance', async () => {
      const handler = createMockHandler();
      const executor = createSyncExecutor(handler);

      expect(executor).toBeInstanceOf(SyncExecutor);

      const plan = makePlan([makeCopyOp('a.mp3')]);
      const { result } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));
      expect(result.completed).toBe(1);
    });
  });

  describe('warning sink', () => {
    // Pins the wiring contract: handlers emit via ctx.warningSink, the
    // executor accumulates into both ExecuteResult.warnings and the typed
    // getWarnings() surface that presenters consume. Presenters iterate the
    // progress stream and discard the generator return value, so
    // getWarnings() is what they actually read.
    it('provides ctx.warningSink to executeBatch handlers and accumulates emissions', async () => {
      const handler = createMockHandler({
        async *executeBatch(
          operations: SyncOperation[],
          ctx: ExecutionContext
        ): AsyncGenerator<OperationProgress> {
          ctx.warningSink?.emit({
            phase: 'execute',
            type: 'tag-write',
            message: 'synthetic portable tag-write miss',
            tracks: [{ artist: 'Test Artist', title: 'Test Song' }],
          });
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);
      const { result } = await consumeExecutor(executor.execute(plan, { device: mockDevice() }));

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.type).toBe('tag-write');
      expect(result.warnings[0]!.tracks[0]!.title).toBe('Test Song');
      expect(executor.getWarnings()).toEqual(result.warnings);
    });

    it('exposes accumulated warnings via the typed getWarnings() method', async () => {
      // Presenters iterate the progress stream and discard the generator
      // return value, so the result.warnings array is invisible to them.
      // getWarnings() is the surface they read instead.
      const handler = createMockHandler({
        async *executeBatch(
          operations: SyncOperation[],
          ctx: ExecutionContext
        ): AsyncGenerator<OperationProgress> {
          ctx.warningSink?.emit({
            phase: 'execute',
            type: 'artwork',
            message: 'artwork extraction failed',
            tracks: [{ artist: 'A', title: 'B' }],
          });
          ctx.warningSink?.emit({
            phase: 'execute',
            type: 'tag-write',
            message: 'tag write failed',
            tracks: [{ artist: 'C', title: 'D' }],
          });
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      // Mimic the presenter: drain the progress stream without consuming the
      // generator return value.
      for await (const _ of executor.execute(plan, { device: mockDevice() })) {
        void _;
      }

      const warnings = executor.getWarnings();
      expect(warnings).toHaveLength(2);
      expect(warnings.map((w) => w.type).sort()).toEqual(['artwork', 'tag-write']);
    });

    it('clears warnings between sequential execute() calls on the same instance', async () => {
      let runIndex = 0;
      const handler = createMockHandler({
        async *executeBatch(
          operations: SyncOperation[],
          ctx: ExecutionContext
        ): AsyncGenerator<OperationProgress> {
          runIndex++;
          ctx.warningSink?.emit({
            phase: 'execute',
            type: 'tag-write',
            message: `run ${runIndex}`,
            tracks: [{ artist: 'A', title: 'B' }],
          });
          for (const op of operations) {
            yield { operation: op, phase: 'starting' };
            yield { operation: op, phase: 'complete' };
          }
        },
      });

      const executor = new SyncExecutor(handler);
      const plan = makePlan([makeCopyOp('a.mp3')]);

      await consumeExecutor(executor.execute(plan, { device: mockDevice() }));
      expect(executor.getWarnings()).toHaveLength(1);
      expect(executor.getWarnings()[0]!.message).toBe('run 1');

      await consumeExecutor(executor.execute(plan, { device: mockDevice() }));
      // Second run must not include the first run's warning.
      expect(executor.getWarnings()).toHaveLength(1);
      expect(executor.getWarnings()[0]!.message).toBe('run 2');
    });
  });
});
