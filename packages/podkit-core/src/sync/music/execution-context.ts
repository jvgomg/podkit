/**
 * Music pipeline ExecutionContext — per-execute state for a single
 * `MusicPipeline.execute()` call.
 *
 * Built once at the top of `execute()` from the caller's `ExtendedExecuteOptions`
 * and threaded through every private method that needs any of these fields.
 *
 * Previously each field lived on `this` and was set/cleared by `execute()` —
 * which meant two overlapping `execute()` calls on the same instance would
 * silently clobber each other's state (see doc-041 §3.6). With the context
 * threaded as a parameter the pipeline is structurally safe for concurrent
 * execution; the `PipelineBusyError` guard is now a defensive net rather than
 * the load-bearing safety mechanism.
 *
 * All fields are `readonly` to make accidental mutation a type error — the
 * context is created once and treated as immutable for the duration of the
 * execute() call.
 *
 * Lives in its own module so {@link ../music/artwork.ts | MusicArtworkManager}
 * and {@link ./pipeline.ts | MusicPipeline} can share the type without a
 * circular import.
 *
 * @module
 */

import type { CollectionAdapter } from '../../adapters/interface.js';
import type { TransferMode } from '../../transcode/types.js';
import type { SyncTagConfig } from './pipeline-options.js';

/**
 * Per-execute state for a single `MusicPipeline.execute()` call.
 */
export interface ExecutionContext {
  /**
   * Source adapter for the current execution.
   *
   * Held so the artwork manager can ask the adapter for non-embedded artwork
   * bytes (directory sidecars, Subsonic getCoverArt) when extraction from the
   * audio body returns null.
   */
  readonly adapter?: CollectionAdapter;
  /** Transfer mode optimization strategy (`fast` | `optimized` | `portable`). */
  readonly transferMode?: TransferMode;
  /** Resize embedded artwork to this maximum dimension (pixels, square). */
  readonly artworkResize?: number;
  /** Resize sidecar artwork (peer `cover.jpg`) to this maximum dimension. */
  readonly sidecarResize?: number;
  /** Audio normalization mode for the target device (`replaygain` | `soundcheck` | `none`). */
  readonly audioNormalization?: string;
  /** Sync tag config for writing transcode metadata to device tracks. */
  readonly syncTagConfig?: SyncTagConfig;
  /**
   * Whether artwork sync is enabled for the current execution.
   *
   * Resolved from `MusicSyncConfig.artwork` (default `true`) and snapshotted
   * at `execute()` start. Not optional — has a true default.
   */
  readonly artworkEnabled: boolean;
}
