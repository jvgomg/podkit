/**
 * Categorized sync errors — the typed-error convention for the sync engine.
 *
 * Errors thrown out of an adapter's `save()`, a content-type handler's
 * `execute()`, or any other sync-engine code MUST extend
 * {@link CategorizedSyncError}. The category lives on the error class — the
 * pipeline's categorizer reads `error.category` rather than scraping the
 * message body for keywords.
 *
 * **Why:** the prior implementation (see `error-handling.ts` git history)
 * inferred the category by lowercased-substring matching on `error.message`,
 * which mis-classified any error whose path embedded a domain keyword (e.g.
 * "iPod" in a mass-storage device path → mis-classified as a database error).
 * Typed errors close that hole and document the policy at the throw site.
 *
 * See `documents/architecture/error-handling.md` for the full responsibility
 * model.
 *
 * @module
 */

import type { ErrorCategory, ErrorCause } from './types.js';

/**
 * Recover an fs-style errno code (`ENOSPC`, `EACCES`, `EROFS`, `ENOENT`, …)
 * from an arbitrary thrown value. Node's fs errors and many native bindings
 * expose `code` as a string; synthetic errors and non-Error values return
 * `undefined`. Used by every {@link ErrorCause} construction site to keep
 * errno extraction out of message-body inspection.
 */
export function errnoOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Build an {@link ErrorCause} from a thrown value at a flush-stage rejection
 * or throw site. `path` identifies the unit of work (file path, album dir,
 * `"oldPath → newPath"` for moves); errno is recovered via {@link errnoOf}
 * — used by the categorizer's `hasEnospc → 'space'` override.
 */
export function toErrorCause(path: string, reason: unknown): ErrorCause {
  const message = reason instanceof Error ? reason.message : String(reason);
  return { path, message, errno: errnoOf(reason) };
}

/**
 * Abstract base class for all categorized sync errors.
 *
 * Subclasses declare a `readonly category: ErrorCategory` so that
 * {@link categorizeError} (in `error-handling.ts`) can recover the category
 * without inspecting the message.
 *
 * Carries two failure-description channels:
 *
 * - `causes: readonly string[]` — human-readable `"${path}: ${message}"`
 *   lines, surfaced as-is into the `--json` envelope's `errors[].causes`
 *   array (see `packages/podkit-cli/src/commands/sync.ts` `ErrorInfo`).
 *   Stable wire format; consumers parse these as opaque strings.
 * - `structuredCauses?: readonly ErrorCause[]` — in-process detail with
 *   typed `{ path, message, errno }` so the categorizer can read the
 *   underlying fs errno (`ENOSPC`/`EACCES`/…) without scraping the message
 *   body. Optional — single-string-cause subclasses (`DatabaseWriteError`,
 *   `InsufficientSpaceAfterCleanup` where causes are bare path strings)
 *   leave it `undefined`.
 *
 * Both channels stay in lockstep when populated together — `causes[i]`
 * formats `structuredCauses[i]` as `"${path}: ${message}"`.
 */
export abstract class CategorizedSyncError extends Error {
  /** Category used by the executor's retry policy. */
  abstract readonly category: ErrorCategory;

  /**
   * Per-entry failure descriptions for aggregated errors. Single-cause
   * subclasses (e.g. DatabaseWriteError) populate it with one entry;
   * consumers should not assume length > 1.
   */
  readonly causes: readonly string[];

  /**
   * Structured per-entry detail with errno. Populated by aggregate errors
   * (`TagWriteError`/`PictureWriteError`/`SidecarWriteError`/`MoveError`) and
   * the `CopyError` single-cause wrap. `undefined` when the subclass does
   * not carry per-cause errno detail.
   */
  readonly structuredCauses: readonly ErrorCause[] | undefined;

  constructor(
    message: string,
    causes: readonly string[] = [],
    structuredCauses?: readonly ErrorCause[]
  ) {
    super(message);
    this.name = new.target.name;
    this.causes = causes;
    this.structuredCauses = structuredCauses;
  }

  /**
   * True when any cause carries an `ENOSPC` errno. Drives the categorizer's
   * "device exhausted" override: an ENOSPC inside a tag/picture/sidecar/move
   * flush should route to the `'space'` category (no retry) regardless of
   * the subclass's declared default of `'copy'`. Falls back to `false` when
   * the subclass does not populate `structuredCauses`.
   */
  get hasEnospc(): boolean {
    return this.structuredCauses?.some((c) => c.errno === 'ENOSPC') ?? false;
  }
}

/**
 * iPod database (libgpod / iTunesDB) write failure. Wraps the underlying
 * native error so the categorizer doesn't have to substring-match on
 * "libgpod" / "iTunes" / "ipod" out of the message body.
 *
 * Today this is wrapped at the `IpodAdapter.save()` boundary; wrapping the
 * other libgpod mutators (`addTrack`, `updateTrack`, `removeTrack`) is a
 * follow-up — those currently propagate the raw native error and rely on
 * the operation-type fallback to land in a sane category.
 */
export class DatabaseWriteError extends CategorizedSyncError {
  readonly category = 'database' as const;

  constructor(
    cause: string,
    public readonly underlying?: unknown
  ) {
    super(`device database write failed: ${cause}`, [cause]);
  }
}

/**
 * Insufficient free space detected after the pre-sync sweep ran.
 *
 * Thrown by the executor's post-sweep recompute (see ADR-018) when the
 * sweep recovered less than promised — the plan-time envelope counted
 * `debrisCleanup.totalBytes` as available, but per-path `rm` failures
 * left the actual freed bytes below the threshold. Surfaces ONCE,
 * before any track is attempted, instead of leaking into N consecutive
 * per-track ENOSPC errors as the transfer phase exhausts the device.
 *
 * Carries structured detail so `--json` consumers can render without
 * scraping the message body.
 *
 * See `adr/adr-018-free-space-pre-flight-strategy.md`.
 */
export class InsufficientSpaceAfterCleanup extends CategorizedSyncError {
  readonly category = 'space' as const;

  constructor(
    readonly detail: {
      bytesNeeded: number;
      bytesAvailable: number;
      bytesFreedBySweep: number;
      failedSweepPaths: readonly string[];
    }
  ) {
    super(
      `Not enough space after debris cleanup. Need ${detail.bytesNeeded} bytes, have ${detail.bytesAvailable} (sweep freed ${detail.bytesFreedBySweep} bytes${detail.failedSweepPaths.length > 0 ? `; ${detail.failedSweepPaths.length} sweep path(s) failed` : ''}).`,
      detail.failedSweepPaths
    );
  }
}

/**
 * User-cancelled sync. Distinct from {@link CategorizedSyncError} — abort is
 * a sync-level state change (the user pressed Ctrl-C / called
 * `controller.abort()`), not a per-operation failure with a category and
 * retry policy.
 *
 * Thrown from handlers when they detect `signal?.aborted` and need to unwind
 * the stack to the engine. The engine's batch- and per-operation catch
 * blocks recognise this class and set `ExecuteResult.aborted = true` instead
 * of recording a synthetic per-operation failure.
 *
 * Carrying its own class (rather than reusing a generic `Error` with a
 * message check) lets the engine distinguish cancellation from genuine
 * handler failures without scraping the message body. See ADR-019 Phase 4b.
 */
export class AbortError extends Error {
  override readonly name = 'AbortError' as const;

  constructor(message = 'Sync aborted') {
    super(message);
  }
}
