/**
 * Tests for the warning surface that flows pipeline-emitted Warnings from
 * MusicPipeline → MusicHandler.executeBatch → SyncExecutor → MusicPresenter
 * out into the CLI's text "Warnings:" summary and the --json `warnings[]`
 * envelope.
 *
 * Closes the pre-existing wiring gap where adapters emitted a structured
 * Warning into their injected WarningSink but the duck-typed
 * `executor.getWarnings()` consumer in MusicPresenter found no method on the
 * generic SyncExecutor — the pipeline's warnings were GC'd with the pipeline
 * instance.
 *
 * Two-layer coverage:
 * 1. Presenter layer — drive MusicPresenter.executeSync with a stub handler
 *    that emits a Warning via ctx.warningSink, assert it lands in the
 *    returned `warnings` array (the field sync.ts aggregates into
 *    `allWarnings`).
 * 2. Rendering layer — feed an `allWarnings` array into the text and JSON
 *    rendering shapes sync.ts emits to assert both surfaces include the
 *    structured warning.
 */

import { describe, expect, it } from 'bun:test';
import { MusicPresenter } from './music-presenter.js';
import { OutputContext } from '../output/index.js';
import type { OutputSink } from '../output/types.js';
import type {
  ContentTypeHandler,
  ExecutionContext,
  OperationProgress,
  SyncPlan,
  MusicOperation,
  CollectionTrack,
  DeviceTrack,
} from '@podkit/core';
import * as core from '@podkit/core';
import type { MusicContentConfig } from './sync-presenter.js';
import type { SyncOutput, WarningInfo } from './sync.js';
import type { Warning } from '@podkit/core';

// =============================================================================
// Fixtures
// =============================================================================

class BufferSink implements OutputSink {
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

function makeOutput(opts?: { json?: boolean; verbose?: number }): {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
} {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({
    mode: opts?.json ? 'json' : 'text',
    quiet: false,
    verbose: opts?.verbose ?? 0,
    color: false,
    tips: false,
    // Non-TTY so the presenter prints plain progress lines rather than
    // driving the ANSI dual-progress display.
    tty: false,
    stdout,
    stderr,
  });
  return { out, stdout, stderr };
}

/**
 * Build a stub MusicHandler whose executeBatch emits a single tag-write
 * Warning via `ctx.warningSink` before yielding the standard
 * starting/complete events. This mirrors how IpodAdapter's portable-mode
 * tag-write soft failure emerges in production.
 */
function stubHandlerEmittingWarning(
  warning: Warning
): ContentTypeHandler<CollectionTrack, DeviceTrack, MusicOperation> {
  const handler: Partial<ContentTypeHandler<CollectionTrack, DeviceTrack, MusicOperation>> = {
    type: 'music',
    generateMatchKey: () => 'k',
    generateDeviceMatchKey: () => 'k',
    getDeviceItemId: (d) => (d as any).filePath ?? 'id',
    detectUpdates: () => [],
    planAdd: () =>
      ({
        type: 'add-direct-copy',
        source: { filePath: 'a.mp3', fileType: 'mp3' } as any,
      }) as MusicOperation,
    planRemove: () => ({ type: 'remove', track: { filePath: 'a.mp3' } as any }) as MusicOperation,
    planUpdate: () => [],
    estimateSize: () => 1,
    estimateTime: () => 1,
    getOperationPriority: () => 0,
    async *execute(op: MusicOperation): AsyncGenerator<OperationProgress<MusicOperation>> {
      yield { operation: op, phase: 'starting' };
      yield { operation: op, phase: 'complete' };
    },
    async *executeBatch(
      operations: MusicOperation[],
      ctx: ExecutionContext
    ): AsyncGenerator<OperationProgress<MusicOperation>> {
      ctx.warningSink?.emit(warning);
      for (const op of operations) {
        yield { operation: op, phase: 'starting' };
        yield { operation: op, phase: 'complete' };
      }
    },
    getDeviceItems: () => [],
    getDisplayName: () => 'stub-track',
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
  return handler as ContentTypeHandler<CollectionTrack, DeviceTrack, MusicOperation>;
}

const TAG_WRITE_WARNING: Warning = {
  phase: 'execute',
  type: 'tag-write',
  message: 'synthetic portable tag-write miss',
  tracks: [{ artist: 'Test Artist', title: 'Test Song', album: 'Test Album' }],
};

// =============================================================================
// Layer 1 — Presenter end-to-end
// =============================================================================

describe('MusicPresenter execute-phase warnings', () => {
  it('forwards a pipeline-emitted Warning into the executeSync result.warnings array', async () => {
    const { out } = makeOutput();
    const presenter = new MusicPresenter();
    // Inject the stub handler. The handler field is private in production
    // (set during computeDiff); the test bypasses that wiring to exercise
    // executeSync directly with a known-emitting batch handler.
    (
      presenter as unknown as { handler: ContentTypeHandler<unknown, unknown, MusicOperation> }
    ).handler = stubHandlerEmittingWarning(TAG_WRITE_WARNING);

    const plan: SyncPlan<MusicOperation> = {
      operations: [
        {
          type: 'add-direct-copy',
          source: { filePath: 'a.mp3', fileType: 'mp3' } as any,
        } as MusicOperation,
      ],
      estimatedTime: 1,
      estimatedSize: 1,
      warnings: [],
    };

    const mockIpod = {
      save: async () => {},
      // Adapters that the stub handler never touches; supply minimal stubs.
      getTracks: () => [],
    } as unknown as Parameters<typeof presenter.executeSync>[4];

    const result = await presenter.executeSync(
      out,
      plan,
      // _adapter not consumed by the stub handler's executeBatch
      {} as Parameters<typeof presenter.executeSync>[2],
      { type: 'music' } as MusicContentConfig,
      mockIpod,
      core
    );

    expect(result.warnings).toBeDefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]!.type).toBe('tag-write');
    expect(result.warnings![0]!.tracks[0]!.title).toBe('Test Song');
  });
});

// =============================================================================
// Layer 2 — Rendering both text + JSON
// =============================================================================

/**
 * Replicates the text rendering block in sync.ts (~line 1303 onwards) so the
 * test exercises the same surface a user sees, without spinning up the full
 * sync command. If the production renderer changes shape, this fixture
 * needs the same update — it intentionally mirrors that code so the seam
 * stays pinned.
 */
function renderTextWarningsSummary(out: OutputContext, allWarnings: Warning[]): void {
  const executeWarnings = allWarnings.filter((w) => w.phase === 'execute');
  if (executeWarnings.length === 0) return;
  out.newline();
  out.print(`Warnings: ${executeWarnings.length}`);
  const byType = new Map<string, number>();
  for (const w of executeWarnings) {
    byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
  }
  for (const [type, count] of byType) {
    out.print(`  ${type}: ${count}`);
  }
  if (out.isVerbose) {
    out.newline();
    for (const w of executeWarnings) {
      const trackHint =
        w.tracks.length === 1
          ? ` (${w.tracks[0]!.artist} — ${w.tracks[0]!.title})`
          : w.tracks.length > 1
            ? ` (${w.tracks.length} tracks)`
            : '';
      out.print(`  [${w.type}]${trackHint}: ${w.message}`);
    }
  }
}

/**
 * Replicates the JSON shaping in sync.ts (~line 1359 onwards).
 */
function buildJsonWarningInfos(
  allWarnings: Warning[],
  verbose: boolean
): WarningInfo[] | undefined {
  if (allWarnings.length === 0) return undefined;
  return allWarnings.map((w) => ({
    phase: w.phase,
    type: w.type,
    message: w.message,
    trackCount: w.tracks.length,
    tracks: verbose && w.tracks.length > 0 ? w.tracks : undefined,
  }));
}

describe('CLI rendering of execute-phase warnings', () => {
  it('text mode prints a Warnings: summary line and per-type breakdown', () => {
    const { out, stdout } = makeOutput();
    renderTextWarningsSummary(out, [TAG_WRITE_WARNING]);

    expect(stdout.text).toContain('Warnings: 1');
    expect(stdout.text).toContain('tag-write: 1');
  });

  it('text mode -v expands per-warning detail', () => {
    const { out, stdout } = makeOutput({ verbose: 1 });
    renderTextWarningsSummary(out, [TAG_WRITE_WARNING]);

    expect(stdout.text).toContain(
      '[tag-write] (Test Artist — Test Song): synthetic portable tag-write miss'
    );
  });

  it('JSON envelope includes a warnings[] entry with phase, type, message, and trackCount', () => {
    const json: SyncOutput = {
      success: true,
      status: 'ok',
      dryRun: false,
      warnings: buildJsonWarningInfos([TAG_WRITE_WARNING], false),
    };

    expect(json.warnings).toBeDefined();
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings![0]!).toMatchObject({
      phase: 'execute',
      type: 'tag-write',
      message: 'synthetic portable tag-write miss',
      trackCount: 1,
    });
  });

  it('JSON envelope -v includes the per-track refs', () => {
    const json: SyncOutput = {
      success: true,
      status: 'ok',
      dryRun: false,
      warnings: buildJsonWarningInfos([TAG_WRITE_WARNING], true),
    };

    expect(json.warnings![0]!.tracks).toEqual([
      { artist: 'Test Artist', title: 'Test Song', album: 'Test Album' },
    ]);
  });
});
