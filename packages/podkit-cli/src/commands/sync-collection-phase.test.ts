import { describe, expect, it } from 'bun:test';
import { runCollectionPhase } from './sync-collection-phase.js';
import { OutputContext } from './../output/index.js';
import { BufferSink } from './../test-utils/buffer-sink.js';
import { BufferExitCodeSink } from './../output/index.js';
import type {
  ContentTypePresenter,
  GenericSyncResult,
  MusicContentConfig,
  VideoContentConfig,
} from './sync-presenter.js';
import type { ResolvedCollection } from './sync.js';

// =============================================================================
// Test fixtures
// =============================================================================

const makeAdapter = () => ({
  saveCalls: 0,
  async save() {
    this.saveCalls++;
  },
});

const makeShutdown = () => ({
  signal: new AbortController().signal,
  install() {},
  uninstall() {},
  protect(fn: () => Promise<unknown>) {
    return fn();
  },
  unprotect() {},
  get isShuttingDown() {
    return false;
  },
});

const makeOut = (mode: 'json' | 'text' = 'text') => {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  return {
    out: new OutputContext({
      mode,
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode,
    }),
    stdout,
    stderr,
    exitCode,
  };
};

const musicPresenter = {
  type: 'music' as const,
  itemNoun: 'tracks',
  sectionTitle: 'Music',
  getSourcePath: (c: ResolvedCollection) => (c.config as { path: string }).path,
  getInterruptedSuffix: () => 'Sync interrupted.',
};

const videoPresenter = {
  type: 'video' as const,
  itemNoun: 'videos',
  sectionTitle: 'Video',
  getSourcePath: (c: ResolvedCollection) => (c.config as { path: string }).path,
  getInterruptedSuffix: () => 'Video sync interrupted.',
};

const collection = (name: string, path = `/src/${name}`): ResolvedCollection => ({
  name,
  type: 'music',
  config: { type: 'directory', path } as ResolvedCollection['config'],
});

const successResult = (overrides: Partial<GenericSyncResult> = {}): GenericSyncResult => ({
  success: true,
  completed: 1,
  failed: 0,
  ...overrides,
});

const failResult = (overrides: Partial<GenericSyncResult> = {}): GenericSyncResult => ({
  success: false,
  completed: 0,
  failed: 1,
  ...overrides,
});

const musicConfigStub = { type: 'music' } as unknown as MusicContentConfig;
const videoConfigStub = { type: 'video' } as unknown as VideoContentConfig;

type SyncOneStub = (
  ...args: Parameters<typeof import('./sync-presenter.js').genericSyncCollection>
) => Promise<GenericSyncResult>;

const makeDeps = (syncOne: SyncOneStub, dryRun = false) => {
  const ctx = makeOut();
  const adapter = makeAdapter();
  const shutdown = makeShutdown();
  return {
    deps: {
      out: ctx.out,
      adapter,
      core: {} as typeof import('@podkit/core'),
      shutdown: shutdown as unknown as import('./../shutdown.js').ShutdownController,
      dryRun,
      removeOrphans: false,
      devicePath: '/dev/ipod',
      syncOne: syncOne as unknown as typeof import('./sync-presenter.js').genericSyncCollection,
    },
    ctx,
    adapter,
  };
};

// =============================================================================
// Tests
// =============================================================================

describe('runCollectionPhase', () => {
  // ─── AC #7: empty collections ────────────────────────────────────────────
  describe('empty collections', () => {
    it('no iterations, no save, accumulators all zero', async () => {
      let callCount = 0;
      const { deps, ctx, adapter } = makeDeps(async () => {
        callCount++;
        return successResult();
      });

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(callCount).toBe(0);
      expect(adapter.saveCalls).toBe(0);
      expect(ctx.stdout.text()).toBe('');
      expect(result.kind).toBe('music');
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.interrupted).toBe(false);
      expect(result.consumedPreliminaries).toBe(false);
    });
  });

  // ─── AC #7: single collection happy path ─────────────────────────────────
  describe('happy path', () => {
    it('music: single collection, header suppressed (length===1)', async () => {
      const { deps, ctx } = makeDeps(async () =>
        successResult({
          completed: 5,
          warnings: [{ phase: 'plan', type: 'lossy-to-lossy', message: 'm', tracks: [] }],
        })
      );

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('main')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      // Header must NOT appear when renderPerCollectionHeader is false.
      expect(ctx.stdout.text()).not.toContain('=== Music: main ===');
      expect(result.completed).toBe(5);
      expect(result.warnings).toHaveLength(1);
    });

    it('music: multi collection, headers byte-identical', async () => {
      const { deps, ctx } = makeDeps(async () => successResult());

      await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('main'), collection('archive')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      // Byte-identical header pin: '=== Music: NAME ===' (AC #5).
      expect(ctx.stdout.text()).toContain('=== Music: main ===');
      expect(ctx.stdout.text()).toContain('=== Music: archive ===');
    });

    it('video: header always renders, byte-identical', async () => {
      const { deps, ctx } = makeDeps(async () => successResult());

      await runCollectionPhase(
        {
          presenter: videoPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'video';
          },
          collections: [collection('movies')],
          contentConfig: videoConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      // Byte-identical header pin: '=== Video: NAME ===' (AC #5).
      expect(ctx.stdout.text()).toContain('=== Video: movies ===');
    });

    it('music: extras (artworkMissingBaseline, transferModeMismatch) accumulate', async () => {
      let i = 0;
      const { deps } = makeDeps(async () => {
        i++;
        return successResult({
          completed: i,
          artworkMissingBaseline: i * 2,
          transferModeMismatch: i * 3,
        });
      });

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(result.completed).toBe(3);
      expect(result.artworkMissingBaseline).toBe(2 + 4);
      expect(result.transferModeMismatch).toBe(3 + 6);
    });
  });

  // ─── AC #7: interrupt mid-loop ───────────────────────────────────────────
  describe('interrupted mid-loop', () => {
    it('music: interrupt with priorPhaseCompleted+completed>0 triggers save with byte-identical suffix', async () => {
      let i = 0;
      const { deps, ctx, adapter } = makeDeps(async () => {
        i++;
        if (i === 1) return successResult({ completed: 2 });
        return successResult({ completed: 0, interrupted: true });
      });

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b'), collection('c')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(i).toBe(2); // Stopped before collection 'c'
      expect(result.interrupted).toBe(true);
      expect(adapter.saveCalls).toBe(1);
      // Byte-identical interrupt suffix (AC #6): music = "Sync interrupted."
      expect(ctx.stdout.text()).toContain('Saving device database...');
      expect(ctx.stdout.text()).toContain('Database saved. Sync interrupted.');
      expect(ctx.exitCode.get()).toBe(130);
    });

    it('video: interrupt suffix is "Video sync interrupted."', async () => {
      const { deps, ctx, adapter } = makeDeps(async () =>
        successResult({ completed: 1, interrupted: true })
      );

      await runCollectionPhase(
        {
          presenter: videoPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'video';
          },
          collections: [collection('movies')],
          contentConfig: videoConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(adapter.saveCalls).toBe(1);
      expect(ctx.stdout.text()).toContain('Database saved. Video sync interrupted.');
    });

    it('video: priorPhaseCompleted>0 triggers save even when video completed=0', async () => {
      // Cross-phase invariant: any device write across the run gates the
      // save. Regression test for the bug caught during extraction where the
      // original ran `totalCompleted > 0` but a naive helper-local accumulator
      // would not.
      const { deps, ctx, adapter } = makeDeps(async () =>
        successResult({ completed: 0, interrupted: true })
      );

      await runCollectionPhase(
        {
          presenter: videoPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'video';
          },
          collections: [collection('movies')],
          contentConfig: videoConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 17, // music synced 17 tracks earlier
        },
        deps
      );

      expect(adapter.saveCalls).toBe(1);
      expect(ctx.stdout.text()).toContain('Database saved. Video sync interrupted.');
    });

    it('dry-run interrupt: never saves, never prints save banner', async () => {
      const { deps, ctx, adapter } = makeDeps(
        async () => successResult({ completed: 3, interrupted: true }),
        true /* dryRun */
      );

      await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(adapter.saveCalls).toBe(0);
      expect(ctx.stdout.text()).not.toContain('Saving device database');
      expect(ctx.exitCode.get()).toBe(130);
    });

    it('interrupt with zero total completed: exit code set but no save', async () => {
      const { deps, ctx, adapter } = makeDeps(async () =>
        successResult({ completed: 0, interrupted: true })
      );

      await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(adapter.saveCalls).toBe(0);
      expect(ctx.stdout.text()).not.toContain('Saving device database');
      expect(ctx.exitCode.get()).toBe(130);
    });
  });

  // ─── Helper renders header when caller says so, even for one collection ──
  describe('header rendering is caller-driven', () => {
    it('music: single collection with renderPerCollectionHeader=true does render', async () => {
      // Caller (sync.ts) suppresses for music when length===1, but the
      // helper itself stays content-agnostic — if the caller passes true,
      // the header renders. Documents the boundary.
      const { deps, ctx } = makeDeps(async () => successResult());

      await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('only')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: true,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(ctx.stdout.text()).toContain('=== Music: only ===');
    });
  });

  // ─── AC #7: error accumulation ───────────────────────────────────────────
  describe('error accumulation', () => {
    it('two consecutive failures: anyError stays true, errors accrue', async () => {
      const { deps } = makeDeps(async () =>
        failResult({
          collectedErrors: [
            {
              trackName: 'x.mp3',
              category: 'transcode-error',
              message: 'boom',
              retryAttempts: 0,
              wasRetried: false,
            },
          ],
        })
      );

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(result.anyError).toBe(true);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('collects errors and flips anyError when result.success=false', async () => {
      let i = 0;
      const { deps } = makeDeps(async () => {
        i++;
        if (i === 1) {
          return failResult({
            collectedErrors: [
              {
                trackName: 'bad.mp3',
                category: 'transcode-error',
                message: 'ffmpeg crash',
                retryAttempts: 0,
                wasRetried: false,
              },
            ],
          });
        }
        return successResult({
          warnings: [{ phase: 'plan', type: 'lossy-to-lossy', message: 'note', tracks: [] }],
        });
      });

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(result.anyError).toBe(true);
      expect(result.failed).toBe(1);
      expect(result.completed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.trackName).toBe('bad.mp3');
      expect(result.warnings).toHaveLength(1);
    });
  });

  // ─── AC #8: preliminaries one-shot ───────────────────────────────────────
  describe('preliminaries one-shot', () => {
    it('first iteration receives preliminaries, second receives undefined', async () => {
      const received: Array<unknown> = [];
      const { deps } = makeDeps(async (...args) => {
        received.push(args[13]); // 14th positional = preliminaries
        return successResult();
      });

      const prelim = {
        debrisCleanup: { paths: [], totalBytes: 0 },
      } as unknown as import('@podkit/core').PlanPreliminaries;

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: prelim,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(received[0]).toBe(prelim);
      expect(received[1]).toBeUndefined();
      expect(result.consumedPreliminaries).toBe(true);
    });

    it('non-undefined preliminaries with empty collections: consumedPreliminaries stays false', async () => {
      // Documents the contract: the helper doesn't claim to have consumed
      // preliminaries unless an iteration actually received them.
      let called = false;
      const { deps } = makeDeps(async () => {
        called = true;
        return successResult();
      });

      const prelim = {
        debrisCleanup: { paths: [], totalBytes: 0 },
      } as unknown as import('@podkit/core').PlanPreliminaries;

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: prelim,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(called).toBe(false);
      expect(result.consumedPreliminaries).toBe(false);
    });

    it('caller-already-consumed: passes undefined everywhere, consumedPreliminaries=false', async () => {
      const received: Array<unknown> = [];
      const { deps } = makeDeps(async (...args) => {
        received.push(args[13]);
        return successResult();
      });

      const result = await runCollectionPhase(
        {
          presenter: musicPresenter as unknown as ContentTypePresenter<unknown, unknown> & {
            type: 'music';
          },
          collections: [collection('a'), collection('b')],
          contentConfig: musicConfigStub,
          renderPerCollectionHeader: false,
          preSyncPreliminaries: undefined,
          priorPhaseCompleted: 0,
        },
        deps
      );

      expect(received).toEqual([undefined, undefined]);
      expect(result.consumedPreliminaries).toBe(false);
    });
  });
});
