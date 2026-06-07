/**
 * Tests for the warning surface on the video sync path.
 *
 * Mirrors music-presenter.warnings.test.ts Layer 1 coverage for the video side.
 * Two tests:
 * 1. VideoPresenter.executeSync returns warnings emitted via device.setWarningSink
 *    when the handler wires the sink through the device adapter.
 * 2. VideoPresenter.executeSync returns a `warnings` field on every code path —
 *    pins the latent return-shape bug where the field was absent before TASK-396.
 */

import { describe, expect, it, mock } from 'bun:test';
import { VideoPresenter } from './video-presenter.js';
import { OutputContext } from '../output/index.js';
import type { OutputSink } from '../output/types.js';
import type {
  ContentTypeHandler,
  ExecutionContext,
  OperationProgress,
  SyncPlan,
  VideoOperation,
  CollectionVideo,
  Warning,
  WarningSink,
} from '@podkit/core';
import type { DeviceVideo } from '@podkit/core';
import * as core from '@podkit/core';

// =============================================================================
// Fixtures
// =============================================================================

class BufferSink implements OutputSink {
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

function makeOutput(): { out: OutputContext } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({
    mode: 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
  });
  return { out };
}

/**
 * Build a stub VideoHandler whose executeBatch captures the warningSink from
 * ctx, calls device.setWarningSink?.(sink) to wire it into the device, then
 * emits a Warning via the captured sink. This mirrors how a real device adapter
 * would emit a soft failure (e.g. a mass-storage sidecar-write miss) through the
 * sink contract.
 */
function stubVideoHandlerEmittingWarning(
  warning: Warning
): ContentTypeHandler<CollectionVideo, DeviceVideo, VideoOperation> {
  const handler: Partial<ContentTypeHandler<CollectionVideo, DeviceVideo, VideoOperation>> = {
    type: 'video',
    generateMatchKey: () => 'k',
    generateDeviceMatchKey: () => 'k',
    getDeviceItemId: (d) => (d as any).id ?? 'id',
    detectUpdates: () => [],
    planAdd: () => ({ type: 'video-copy', source: { filePath: 'v.mp4' } as any }) as VideoOperation,
    planRemove: () =>
      ({
        type: 'video-remove',
        video: { id: 'v', filePath: 'v.mp4', contentType: 'movie', title: 'V' },
      }) as VideoOperation,
    planUpdate: () => [],
    estimateSize: () => 1,
    estimateTime: () => 1,
    getOperationPriority: () => 0,
    async *execute(op: VideoOperation): AsyncGenerator<OperationProgress<VideoOperation>> {
      yield { operation: op, phase: 'starting' };
      yield { operation: op, phase: 'complete' };
    },
    async *executeBatch(
      operations: VideoOperation[],
      ctx: ExecutionContext
    ): AsyncGenerator<OperationProgress<VideoOperation>> {
      // Wire the sink into the device before processing, mirroring VideoHandler.executeBatch.
      if (ctx.warningSink) {
        ctx.device.setWarningSink?.(ctx.warningSink);
        ctx.warningSink.emit(warning);
      }
      for (const op of operations) {
        yield { operation: op, phase: 'starting' };
        yield { operation: op, phase: 'complete' };
      }
    },
    getDeviceItems: () => [],
    getDisplayName: () => 'stub-video',
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
  };
  return handler as ContentTypeHandler<CollectionVideo, DeviceVideo, VideoOperation>;
}

const TAG_WRITE_WARNING: Warning = {
  phase: 'execute',
  type: 'tag-write',
  message: 'synthetic video tag-write miss',
  tracks: [{ artist: 'Video Artist', title: 'Test Video', album: '' }],
};

function makeMinimalDevice() {
  return {
    save: mock(async () => {}),
    getTracks: mock(() => []),
    setWarningSink: mock((_sink: WarningSink) => {}),
  };
}

function makeMinimalPlan(): SyncPlan<VideoOperation> {
  return {
    operations: [
      {
        type: 'video-copy',
        source: {
          id: 'v.mp4',
          filePath: 'v.mp4',
          contentType: 'movie',
          title: 'Test Video',
          year: 2024,
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 640,
          height: 480,
          duration: 60,
        },
      } as VideoOperation,
    ],
    estimatedSize: 1,
    estimatedTime: 1,
    warnings: [],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('VideoPresenter execute-phase warnings', () => {
  it('VideoPresenter.executeSync returns warnings from sink-emitted warnings', async () => {
    const { out } = makeOutput();
    const presenter = new VideoPresenter();
    // Inject stub handler that emits via the wired sink
    (
      presenter as unknown as { handler: ContentTypeHandler<unknown, unknown, VideoOperation> }
    ).handler = stubVideoHandlerEmittingWarning(TAG_WRITE_WARNING);

    const device = makeMinimalDevice();
    const result = await presenter.executeSync(
      out,
      makeMinimalPlan(),
      {} as any,
      { type: 'video' } as any,
      device as any,
      core
    );

    expect(result.warnings).toBeDefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]!.type).toBe('tag-write');
    expect(result.warnings![0]!.message).toBe('synthetic video tag-write miss');
  });

  it('VideoPresenter.executeSync returns warnings field on every code path', async () => {
    // Pins the latent bug: before the return-shape fix the abort and error paths
    // returned objects without a `warnings` key, so SyncOutput.warnings[]
    // would be undefined even when warnings were emitted.

    const makePresenter = () => {
      const p = new VideoPresenter();
      (p as unknown as { handler: ContentTypeHandler<unknown, unknown, VideoOperation> }).handler =
        stubVideoHandlerEmittingWarning(TAG_WRITE_WARNING);
      return p;
    };

    // Path 1: normal completion
    {
      const { out } = makeOutput();
      const result = await makePresenter().executeSync(
        out,
        makeMinimalPlan(),
        {} as any,
        { type: 'video' } as any,
        makeMinimalDevice() as any,
        core
      );
      expect('warnings' in result).toBe(true);
    }

    // Path 2: abort signal already fired before the loop runs
    {
      const { out } = makeOutput();
      const controller = new AbortController();
      controller.abort();
      const result = await makePresenter().executeSync(
        out,
        makeMinimalPlan(),
        {} as any,
        { type: 'video' } as any,
        makeMinimalDevice() as any,
        core,
        controller.signal
      );
      expect('warnings' in result).toBe(true);
    }

    // Path 3: handler throws a non-abort error
    {
      const { out } = makeOutput();
      const throwingHandler: Partial<
        ContentTypeHandler<CollectionVideo, DeviceVideo, VideoOperation>
      > = {
        type: 'video',
        generateMatchKey: () => 'k',
        generateDeviceMatchKey: () => 'k',
        getDeviceItemId: () => 'id',
        detectUpdates: () => [],
        planAdd: () => ({ type: 'video-copy', source: {} as any }) as VideoOperation,
        planRemove: () =>
          ({
            type: 'video-remove',
            video: { id: 'v', filePath: 'v', contentType: 'movie', title: 'V' },
          }) as VideoOperation,
        planUpdate: () => [],
        estimateSize: () => 1,
        estimateTime: () => 1,
        getOperationPriority: () => 0,
        async *execute(op: VideoOperation): AsyncGenerator<OperationProgress<VideoOperation>> {
          yield { operation: op, phase: 'starting' };
          yield { operation: op, phase: 'complete' };
        },
        async *executeBatch(): AsyncGenerator<OperationProgress<VideoOperation>> {
          throw new Error('simulated executor failure');
        },
        getDeviceItems: () => [],
        getDisplayName: () => 'stub',
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
      };

      const p = new VideoPresenter();
      (p as unknown as { handler: ContentTypeHandler<unknown, unknown, VideoOperation> }).handler =
        throwingHandler as ContentTypeHandler<CollectionVideo, DeviceVideo, VideoOperation>;

      const result = await p.executeSync(
        out,
        makeMinimalPlan(),
        {} as any,
        { type: 'video' } as any,
        makeMinimalDevice() as any,
        core
      );
      expect('warnings' in result).toBe(true);
    }
  });
});
