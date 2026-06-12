/**
 * @internal
 *
 * Per-content-phase orchestration helper for `runSync`. Music + video each
 * sync N collections in a loop; this helper factors the common scaffold
 * (loop, header, JSON envelope emit, accumulator math, interrupt handling)
 * into one place. Content-type divergence flows through the presenter's
 * `getSourcePath`, `getInterruptedSuffix`, `type` fields — the helper
 * itself is content-type-agnostic.
 *
 * Extracted in TASK-423; the two original loops lived in `sync.ts` and
 * shared ~75% structure.
 */

import type { OutputContext, CollectedError } from '../output/index.js';
import type { ShutdownController } from '../shutdown.js';
import type { ResolvedCollection } from './sync.js';
import {
  genericSyncCollection,
  type ContentTypePresenter,
  type MusicContentConfig,
  type VideoContentConfig,
} from './sync-presenter.js';

/**
 * Loose adapter shape — `genericSyncCollection` accepts `any` for the
 * device adapter, so the helper only constrains what it directly uses:
 * the interrupt-flow `save()` call. Caller passes the same concrete
 * device adapter it already holds.
 */
interface AdapterLike {
  save(): Promise<void>;
}

/**
 * What the caller hands to the helper for a single content-phase run.
 */
export interface CollectionPhaseInput {
  /** Content-type presenter (Music or Video). Drives sourcePath + interrupted-suffix dispatch. */
  presenter: ContentTypePresenter<unknown, unknown>;
  /** Collections of this content type to sync, in order. */
  collections: ResolvedCollection[];
  /** Pre-built device-wide content config — caller assembles outside the helper. */
  contentConfig: MusicContentConfig | VideoContentConfig;
  /**
   * Whether to render the `=== {Section}: {name} ===` header for each
   * collection. Music suppresses when there's only one collection; video
   * always renders. Caller decides; the helper is content-agnostic.
   */
  renderPerCollectionHeader: boolean;
  /**
   * Pre-sync sweep result. The helper attaches it to the FIRST iteration
   * only (matches `genericSyncCollection`'s pre-flight expectation), and
   * passes `undefined` to subsequent iterations. Pass `undefined` if the
   * preliminaries were already consumed by a prior phase.
   */
  preSyncPreliminaries: import('@podkit/core').PlanPreliminaries | undefined;
  /**
   * Number of items completed by phases BEFORE this one (e.g. music's
   * completions feed into video's gate). The interrupt-flow save fires
   * only when SOMETHING has been written to the device this run —
   * `priorPhaseCompleted + this phase's completed > 0`. For the first
   * phase, pass 0.
   */
  priorPhaseCompleted: number;
}

/**
 * Cross-phase deps that don't change between music and video.
 */
export interface CollectionPhaseDeps {
  out: OutputContext;
  adapter: AdapterLike;
  core: typeof import('@podkit/core');
  shutdown: ShutdownController;
  dryRun: boolean;
  removeOrphans: boolean;
  devicePath: string;
  /**
   * @internal Injection point for tests — defaults to
   * `genericSyncCollection`. Production callers should never override.
   */
  syncOne?: typeof genericSyncCollection;
}

interface CollectionPhaseResultCommon {
  completed: number;
  failed: number;
  warnings: import('@podkit/core').Warning[];
  errors: CollectedError[];
  anyError: boolean;
  /**
   * @internal Set when an iteration returned `interrupted: true`. Callers
   * detect cross-phase abort via `shutdown.isShuttingDown` instead — the
   * helper already calls `out.setExitCode(130)` and drains the save flow
   * internally. Kept for completeness + testability.
   */
  interrupted: boolean;
  /**
   * True if the helper's first iteration received non-undefined
   * preliminaries — i.e. the device-scoped pre-flight has now been
   * consumed and any subsequent phase must pass `undefined`.
   */
  consumedPreliminaries: boolean;
}

/**
 * Discriminated by `kind` so music's extra accumulators are typed, not
 * stringly-keyed. Video gets no extras; music carries the two TASK-378
 * tip counters.
 */
export type CollectionPhaseResult =
  | (CollectionPhaseResultCommon & {
      kind: 'music';
      artworkMissingBaseline: number;
      transferModeMismatch: number;
    })
  | (CollectionPhaseResultCommon & { kind: 'video' });

/**
 * Run one content-type phase end-to-end: iterate collections, call
 * `genericSyncCollection` per collection, accumulate counters, handle
 * interrupted-flow save + exit code, return a typed result the caller
 * can fold into its run-wide totals.
 *
 * Return type narrows on `presenter.type` via overloads so callers can
 * read music-only fields (`artworkMissingBaseline`, `transferModeMismatch`)
 * without runtime `kind` checks.
 *
 * The interrupt-flow side effect (printing `Saving device database…` →
 * `await adapter.save()` → `Database saved. {suffix}`) is intentionally
 * inside the helper — it's the shutdown contract the per-collection
 * loop owns. The caller stays unaware of save semantics.
 */
export async function runCollectionPhase(
  input: CollectionPhaseInput & {
    presenter: ContentTypePresenter<unknown, unknown> & { type: 'music' };
  },
  deps: CollectionPhaseDeps
): Promise<Extract<CollectionPhaseResult, { kind: 'music' }>>;
export async function runCollectionPhase(
  input: CollectionPhaseInput & {
    presenter: ContentTypePresenter<unknown, unknown> & { type: 'video' };
  },
  deps: CollectionPhaseDeps
): Promise<Extract<CollectionPhaseResult, { kind: 'video' }>>;
export async function runCollectionPhase(
  input: CollectionPhaseInput,
  deps: CollectionPhaseDeps
): Promise<CollectionPhaseResult> {
  const { presenter, collections, contentConfig, renderPerCollectionHeader } = input;
  const { out, adapter, core, shutdown, dryRun, removeOrphans, devicePath } = deps;
  const syncOne = deps.syncOne ?? genericSyncCollection;

  let completed = 0;
  let failed = 0;
  let artworkMissingBaseline = 0;
  let transferModeMismatch = 0;
  const warnings: import('@podkit/core').Warning[] = [];
  const errors: CollectedError[] = [];
  let anyError = false;
  let interrupted = false;
  let consumedPreliminaries = false;

  let nextPreliminaries = input.preSyncPreliminaries;

  for (const collection of collections) {
    const sourcePath = presenter.getSourcePath(collection);

    if (renderPerCollectionHeader) {
      out.newline();
      out.print(`=== ${presenter.sectionTitle}: ${collection.name} ===`);
    }

    const preliminariesForThisCall = nextPreliminaries;
    if (preliminariesForThisCall !== undefined) {
      consumedPreliminaries = true;
    }
    nextPreliminaries = undefined;

    const result = await syncOne(
      presenter,
      out,
      collection,
      sourcePath,
      devicePath,
      dryRun,
      removeOrphans,
      contentConfig,
      adapter,
      core,
      shutdown.signal,
      shutdown,
      undefined,
      preliminariesForThisCall
    );

    if (result.jsonOutput && out.isJson) {
      out.json(result.jsonOutput);
    }

    completed += result.completed;
    failed += result.failed;
    artworkMissingBaseline += result.artworkMissingBaseline ?? 0;
    transferModeMismatch += result.transferModeMismatch ?? 0;
    if (result.warnings && result.warnings.length > 0) {
      warnings.push(...result.warnings);
    }
    if (result.collectedErrors && result.collectedErrors.length > 0) {
      errors.push(...result.collectedErrors);
    }
    if (!result.success) {
      anyError = true;
    }

    if (result.interrupted) {
      interrupted = true;
      if (!dryRun && input.priorPhaseCompleted + completed > 0) {
        out.print('Saving device database...');
        await adapter.save();
        out.print(`Database saved. ${presenter.getInterruptedSuffix()}`);
      }
      out.setExitCode(130);
      break;
    }
  }

  const common: CollectionPhaseResultCommon = {
    completed,
    failed,
    warnings,
    errors,
    anyError,
    interrupted,
    consumedPreliminaries,
  };

  if (presenter.type === 'music') {
    return { kind: 'music', ...common, artworkMissingBaseline, transferModeMismatch };
  }
  return { kind: 'video', ...common };
}
