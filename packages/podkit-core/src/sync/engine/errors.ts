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

import type { ErrorCategory } from './types.js';

/**
 * Abstract base class for all categorized sync errors.
 *
 * Subclasses declare a `readonly category: ErrorCategory` so that
 * {@link categorizeError} (in `error-handling.ts`) can recover the category
 * without inspecting the message.
 *
 * Carries an optional `causes` array — adapters that aggregate per-entry
 * failures into a single thrown error (TagWriteError, SidecarWriteError,
 * PictureWriteError) populate it for diagnostics.
 */
export abstract class CategorizedSyncError extends Error {
  /** Category used by the executor's retry policy. */
  abstract readonly category: ErrorCategory;

  /**
   * Per-entry failure descriptions for aggregated errors. Single-cause
   * subclasses (e.g. MoveError) populate it with one entry; consumers should
   * not assume length > 1.
   */
  readonly causes: readonly string[];

  constructor(message: string, causes: readonly string[] = []) {
    super(message);
    this.name = new.target.name;
    this.causes = causes;
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
