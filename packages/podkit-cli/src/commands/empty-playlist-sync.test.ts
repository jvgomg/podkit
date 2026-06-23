/**
 * Wiring tests for the empty-playlist guard inside `genericSyncCollection`.
 *
 * The pure decision is unit-tested in `empty-playlist-guard.test.ts`; here we
 * assert the guard is wired correctly into the sync flow:
 *   - playlist-scoped + zero tracks + headless  → aborts (throws CliError),
 *     never reaches the device diff/plan.
 *   - playlist-scoped + zero tracks + confirm-yes → proceeds past the guard.
 *   - playlist-scoped + zero tracks + override   → proceeds past the guard.
 *   - playlist-scoped + non-empty                → proceeds normally.
 *   - NON-playlist empty collection              → unaffected (existing skip).
 *
 * A minimal fake presenter stands in for MusicPresenter so the test exercises
 * only the guard branch — the heavy core/transcode machinery is never invoked.
 */

import { describe, expect, it, mock } from 'bun:test';
import { OutputContext } from '../output/index.js';
import { CliError } from '../errors.js';
import {
  genericSyncCollection,
  EMPTY_PLAYLIST_ABORT_CODE,
  type ContentTypePresenter,
  type MusicContentConfig,
} from './sync-presenter.js';
import type { ResolvedCollection } from './sync.js';

function createTestOutput(opts: { mode?: 'text' | 'json'; tty?: boolean } = {}): OutputContext {
  return new OutputContext({
    mode: opts.mode ?? 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: opts.tty ?? false,
    stdout: { write() {} },
    stderr: { write() {} },
  });
}

/**
 * Build a fake presenter that records whether the post-guard plan stages
 * (`createPlan`) were reached, so a test can prove the guard aborted before
 * any destructive work.
 */
function makeFakePresenter(sourceItems: unknown[]) {
  const createAdapterDisconnect = mock(async () => {});
  let reachedPlan = false;
  const presenter = {
    type: 'music' as const,
    itemNoun: 'tracks',
    sectionTitle: 'Music',
    getSourcePath: () => '/subsonic',
    getInterruptedSuffix: () => 'Sync interrupted.',
    createAdapter: () => ({
      adapter: {
        connect: mock(async () => {}),
        disconnect: createAdapterDisconnect,
        getItems: mock(async () => sourceItems),
      },
      scanWarnings: [],
      spinner: { stop() {}, update() {} },
    }),
    formatScanResult: () => 'scanned',
    displayScanWarnings: () => {},
    // 3 device tracks present — the guard reports these as "would remove".
    getDeviceItems: () => [{}, {}, {}],
    computeDiff: () => ({ toAdd: [], toRemove: [], toUpdate: [], existing: [] }),
    createPlan: () => {
      reachedPlan = true;
      return { plan: { operations: [], preliminaries: undefined }, summary: {} };
    },
    willFit: () => true,
    renderDryRunText: () => {},
    buildDryRunJson: () => ({}) as never,
    formatAlreadySynced: () => {},
    renderExecutionHeader: () => {},
    executeSync: async () => ({ completed: 0, failed: 0, collectedErrors: [] }),
    renderCompletion: () => {},
  } as unknown as ContentTypePresenter<unknown, unknown>;

  return { presenter, createAdapterDisconnect, reachedPlan: () => reachedPlan };
}

function playlistCollection(name = 'workout'): ResolvedCollection {
  return {
    name,
    type: 'music',
    config: { type: 'subsonic', path: '', url: 'https://nav', playlist: 'Workout' },
  } as ResolvedCollection;
}

function directoryCollection(name = 'main'): ResolvedCollection {
  return {
    name,
    type: 'music',
    config: { type: 'directory', path: '/music' },
  } as ResolvedCollection;
}

function buildArgs(
  presenter: ContentTypePresenter<unknown, unknown>,
  collection: ResolvedCollection,
  extra: Record<string, unknown> = {}
) {
  return {
    presenter,
    out: createTestOutput(),
    collection,
    sourcePath: '/subsonic',
    devicePath: '/fake/ipod',
    dryRun: false,
    removeOrphans: false,
    contentConfig: { type: 'music' } as unknown as MusicContentConfig,
    ipod: {} as never,
    core: {} as never,
    statfsSyncFn: () => ({ blocks: 1000, bsize: 4096, bfree: 1000 }),
    ...extra,
  } as Parameters<typeof genericSyncCollection>[0];
}

describe('empty-playlist guard wiring (genericSyncCollection)', () => {
  it('aborts non-zero (throws CliError) for empty playlist when headless', async () => {
    const { presenter, createAdapterDisconnect, reachedPlan } = makeFakePresenter([]);
    const args = buildArgs(presenter, playlistCollection(), {
      out: createTestOutput({ tty: false }),
      allowEmptyPlaylist: false,
    });

    let thrown: unknown;
    try {
      await genericSyncCollection(args);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).code).toBe(EMPTY_PLAYLIST_ABORT_CODE);
    // Never reached the destructive plan stage; source connection released.
    expect(reachedPlan()).toBe(false);
    expect(createAdapterDisconnect).toHaveBeenCalled();
  });

  it('aborts non-zero in JSON mode (non-interactive) too', async () => {
    const { presenter } = makeFakePresenter([]);
    const args = buildArgs(presenter, playlistCollection(), {
      out: createTestOutput({ mode: 'json', tty: true }),
      allowEmptyPlaylist: false,
    });

    let thrown: unknown;
    try {
      await genericSyncCollection(args);
    } catch (err) {
      thrown = err;
    }
    // json mode is non-interactive regardless of TTY → abort.
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).code).toBe(EMPTY_PLAYLIST_ABORT_CODE);
  });

  it('proceeds past the guard when override (allowEmptyPlaylist) is set', async () => {
    const { presenter, reachedPlan } = makeFakePresenter([]);
    const args = buildArgs(presenter, playlistCollection(), {
      out: createTestOutput({ tty: false }),
      allowEmptyPlaylist: true,
    });

    const result = await genericSyncCollection(args);
    // Reached the plan stage (empty plan → "already synced"); no abort thrown.
    expect(reachedPlan()).toBe(true);
    expect(result.success).toBe(true);
  });

  it('confirm-yes proceeds; confirm-no aborts', async () => {
    // confirm-yes
    {
      const { presenter, reachedPlan } = makeFakePresenter([]);
      const args = buildArgs(presenter, playlistCollection(), {
        out: createTestOutput({ tty: true }),
        allowEmptyPlaylist: false,
        confirm: mock(async () => true),
      });
      const result = await genericSyncCollection(args);
      expect(reachedPlan()).toBe(true);
      expect(result.success).toBe(true);
    }

    // confirm-no
    {
      const { presenter, reachedPlan } = makeFakePresenter([]);
      let thrown: unknown;
      const args = buildArgs(presenter, playlistCollection(), {
        out: createTestOutput({ tty: true }),
        allowEmptyPlaylist: false,
        confirm: mock(async () => false),
      });
      try {
        await genericSyncCollection(args);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CliError);
      expect((thrown as CliError).code).toBe(EMPTY_PLAYLIST_ABORT_CODE);
      expect(reachedPlan()).toBe(false);
    }
  });

  it('non-empty playlist proceeds normally (no guard)', async () => {
    const { presenter, reachedPlan } = makeFakePresenter([{ id: 't1' }]);
    const args = buildArgs(presenter, playlistCollection(), {
      out: createTestOutput({ tty: false }),
      allowEmptyPlaylist: false,
    });

    const result = await genericSyncCollection(args);
    expect(reachedPlan()).toBe(true);
    expect(result.success).toBe(true);
  });

  it('non-playlist empty collection is unaffected (existing skip, not the guard)', async () => {
    const { presenter, reachedPlan } = makeFakePresenter([]);
    const args = buildArgs(presenter, directoryCollection(), {
      out: createTestOutput({ tty: false }),
      allowEmptyPlaylist: false,
    });

    // No throw — the generic zero-items skip returns a failure result and
    // never engages the playlist guard.
    const result = await genericSyncCollection(args);
    expect(result.success).toBe(false);
    expect(result.completed).toBe(0);
    expect(reachedPlan()).toBe(false);
  });
});
