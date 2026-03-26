/**
 * Generic sync executor that delegates to ContentTypeHandler
 *
 * Supports two execution paths:
 * 1. Batch execution: when handler has `executeBatch`, delegates the full operation list
 * 2. Per-operation execution: fallback that iterates operations one at a time
 *
 * Both paths track completed/failed/skipped counts, collect categorized errors,
 * and return a unified ExecuteResult.
 *
 * @module
 */

import type { DeviceAdapter } from '../../device/adapter.js';
import type {
  SyncPlan,
  SyncOperation,
  ExecutorProgress,
  ExecuteResult,
  CategorizedError,
  ExecutionWarning,
} from './types.js';
import type { TranscodeProgress } from '../../transcode/types.js';
import type { ContentTypeHandler, ExecutionContext, OperationProgress } from './content-type.js';
import { categorizeError, createCategorizedError, type RetryConfig } from './error-handling.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for sync execution
 */
export interface SyncExecuteOptions {
  /** Perform dry run without making changes */
  dryRun?: boolean;
  /** Continue executing remaining operations after an error */
  continueOnError?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Device adapter instance (required for non-dry-run execution) */
  device?: DeviceAdapter;
  /** Temporary directory for transcoded files */
  tempDir?: string;
  /**
   * Save the device database every N completed operations.
   * Set to 0 to disable checkpoint saves.
   * @default 10
   */
  saveInterval?: number;
  /** Retry configuration (passed through, not used by executor directly) */
  retryConfig?: RetryConfig;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive a progress phase from an operation type string using naming conventions.
 *
 * This is content-type-agnostic — it works for any content type whose operation
 * types follow the naming conventions (e.g., `remove`, `add-transcode`,
 * `video-copy`, `podcast-download`). The handler's operation type naming
 * determines the phase.
 */
function getDefaultPhaseForOperation(type: string): ExecutorProgress['phase'] {
  if (type.includes('remove')) return 'removing';
  if (type.includes('update') || type.includes('sync-tag')) return 'updating-metadata';
  if (type.includes('transcode')) return 'transcoding';
  if (type.includes('copy')) return 'copying';
  if (type.includes('upgrade')) return 'upgrading';
  return 'preparing';
}

/**
 * Build an ExecutorProgress from an OperationProgress event
 */
function buildExecutorProgress(
  progress: OperationProgress,
  index: number,
  total: number,
  displayName: string,
  completedCount: number,
  overrides?: Partial<ExecutorProgress>
): ExecutorProgress {
  return {
    phase: getDefaultPhaseForOperation(progress.operation.type),
    operation: progress.operation,
    index,
    current: index,
    total,
    currentTrack: displayName,
    bytesProcessed: 0,
    bytesTotal: 0,
    completedCount,
    error: progress.error,
    transcodeProgress: progress.transcodeProgress
      ? ({
          time: 0,
          duration: 0,
          percent: progress.transcodeProgress.percent,
          speed: progress.transcodeProgress.speed,
        } satisfies TranscodeProgress)
      : undefined,
    ...overrides,
  };
}

// =============================================================================
// SyncExecutor
// =============================================================================

/**
 * Generic sync executor that delegates to a ContentTypeHandler.
 *
 * @typeParam TSource - The source item type
 * @typeParam TDevice - The device item type
 */
export class SyncExecutor<TSource, TDevice> {
  constructor(private handler: ContentTypeHandler<TSource, TDevice>) {}

  /**
   * Execute a sync plan, yielding progress updates.
   *
   * Returns an `ExecuteResult` summary when the generator completes.
   */
  async *execute(
    plan: SyncPlan,
    options?: SyncExecuteOptions
  ): AsyncGenerator<ExecutorProgress, ExecuteResult> {
    const {
      dryRun = false,
      continueOnError = false,
      signal,
      device,
      tempDir,
      saveInterval = 10,
    } = options ?? {};

    const total = plan.operations.length;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ operation: SyncOperation; error: Error }> = [];
    const categorizedErrors: CategorizedError[] = [];
    const warnings: ExecutionWarning[] = [];
    let aborted = false;

    const ctx: ExecutionContext = {
      device: device!,
      signal,
      dryRun,
      tempDir,
    };

    // Path 1: Batch execution (when handler has executeBatch and not dry-run)
    if (!dryRun && this.handler.executeBatch) {
      const result = yield* this.executeBatch(plan, ctx, options ?? {});
      return result;
    }

    // Path 2: Per-operation execution
    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]!;
      const displayName = this.handler.getDisplayName(operation);

      // Check abort signal
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      // Dry-run: yield skipped progress and continue
      if (dryRun) {
        skipped++;
        yield {
          phase: getDefaultPhaseForOperation(operation.type),
          operation,
          index,
          current: index,
          total,
          currentTrack: displayName,
          bytesProcessed: 0,
          bytesTotal: plan.estimatedSize,
          skipped: true,
          completedCount: completed + failed + skipped,
        };
        continue;
      }

      // Execute the operation
      try {
        const gen = this.handler.execute(operation, ctx);
        for await (const progress of gen) {
          yield buildExecutorProgress(
            progress,
            index,
            total,
            displayName,
            completed + failed + skipped,
            {
              bytesTotal: plan.estimatedSize,
            }
          );
        }
        completed++;

        // Checkpoint save
        if (saveInterval > 0 && completed % saveInterval === 0 && device && !signal?.aborted) {
          await device.save();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const category = categorizeError(error, operation.type);
        const catError = createCategorizedError(error, category, displayName, 0, false);

        failed++;
        errors.push({ operation, error });
        categorizedErrors.push(catError);

        // Yield error progress
        yield {
          phase: getDefaultPhaseForOperation(operation.type),
          operation,
          index,
          current: index,
          total,
          currentTrack: displayName,
          bytesProcessed: 0,
          bytesTotal: plan.estimatedSize,
          completedCount: completed + failed + skipped,
          error,
          categorizedError: catError,
        };

        if (!continueOnError) {
          break;
        }
      }
    }

    return {
      completed,
      failed,
      skipped,
      errors,
      categorizedErrors,
      warnings,
      bytesTransferred: 0,
      aborted,
    };
  }

  /**
   * Batch execution path — delegates to handler.executeBatch
   */
  private async *executeBatch(
    plan: SyncPlan,
    ctx: ExecutionContext,
    options: SyncExecuteOptions
  ): AsyncGenerator<ExecutorProgress, ExecuteResult> {
    const { continueOnError = false, signal, device, saveInterval = 10 } = options;

    const total = plan.operations.length;
    let completed = 0;
    let failed = 0;
    // Intentionally const: batch execution has no skip path — dry-run uses per-operation path instead.
    const skipped = 0;
    const errors: Array<{ operation: SyncOperation; error: Error }> = [];
    const categorizedErrors: CategorizedError[] = [];
    const warnings: ExecutionWarning[] = [];
    let aborted = false;
    let operationIndex = 0;

    try {
      const gen = this.handler.executeBatch!(plan.operations, ctx);
      let currentOp: SyncOperation | undefined;

      for await (const progress of gen) {
        // Check abort signal
        if (signal?.aborted) {
          aborted = true;
          break;
        }

        // Track which operation we're on by reference
        if (currentOp !== progress.operation) {
          if (currentOp !== undefined) {
            operationIndex++;
          }
          currentOp = progress.operation;
        }

        const displayName = this.handler.getDisplayName(progress.operation);

        if (progress.phase === 'complete') {
          completed++;

          // Checkpoint save
          if (saveInterval > 0 && completed % saveInterval === 0 && device && !signal?.aborted) {
            await device.save();
          }
        }

        if (progress.phase === 'failed') {
          const error = progress.error ?? new Error('Operation failed');
          const category = categorizeError(error, progress.operation.type);
          const catError = createCategorizedError(error, category, displayName, 0, false);

          failed++;
          errors.push({ operation: progress.operation, error });
          categorizedErrors.push(catError);

          yield buildExecutorProgress(
            progress,
            operationIndex,
            total,
            displayName,
            completed + failed + skipped,
            {
              bytesTotal: plan.estimatedSize,
              categorizedError: catError,
            }
          );

          if (!continueOnError) {
            break;
          }
          continue;
        }

        yield buildExecutorProgress(
          progress,
          operationIndex,
          total,
          displayName,
          completed + failed + skipped,
          {
            bytesTotal: plan.estimatedSize,
          }
        );
      }
    } catch (err) {
      // Batch generator threw — treat as failure of current operation
      const error = err instanceof Error ? err : new Error(String(err));
      const operation = plan.operations[operationIndex] ?? plan.operations[0]!;
      const displayName = this.handler.getDisplayName(operation);
      const category = categorizeError(error, operation.type);
      const catError = createCategorizedError(error, category, displayName, 0, false);

      failed++;
      errors.push({ operation, error });
      categorizedErrors.push(catError);

      yield buildExecutorProgress(
        { operation, phase: 'failed', error },
        operationIndex,
        total,
        displayName,
        completed + failed + skipped,
        {
          bytesTotal: plan.estimatedSize,
          categorizedError: catError,
        }
      );
    }

    return {
      completed,
      failed,
      skipped,
      errors,
      categorizedErrors,
      warnings,
      bytesTransferred: 0,
      aborted,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SyncExecutor for a given content type handler
 */
export function createSyncExecutor<TSource, TDevice>(
  handler: ContentTypeHandler<TSource, TDevice>
): SyncExecutor<TSource, TDevice> {
  return new SyncExecutor(handler);
}
