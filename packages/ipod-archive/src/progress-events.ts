/**
 * ArchiveProgressEvent — the side-effect-only progress channel the archive
 * orchestrators emit through.
 *
 * The package is a leaf and never writes to a terminal: it has no `OutputContext`
 * and no notion of TTY, JSON, or quiet mode. Instead each orchestrator accepts an
 * optional `onProgress(e: ArchiveProgressEvent)` callback and emits a small,
 * deterministic event stream as it reaches each stage. The CLI subscribes and
 * does the actual rendering (progress bars, the device-meta block) through its
 * `OutputContext`.
 *
 * Determinism: events carry only data already derived from the dump/volume — no
 * wall-clock timestamps — so a given input always yields the same sequence.
 * `onProgress` is optional and purely observational: an orchestrator's return
 * value and on-disk output are identical whether or not a callback is supplied.
 *
 * @module
 */

import type { DumpDeviceIdentity } from './dump-loader.js';

/**
 * The per-media-kind breakdown surfaced at the start of the transform stage, so
 * the CLI can print a library summary (`N songs · M movies · …`) before the
 * extraction loop runs. `songs` folds plain music and compilations together;
 * the rest mirror {@link import('./archive-path-planner.js').MediaKind}.
 */
export interface TransformStats {
  /** Total tracks in the catalogue (every media kind). */
  total: number;
  /** Plain music + compilation tracks. */
  songs: number;
  /** Movie-flagged / Movie media-type tracks. */
  movies: number;
  /** Podcast tracks. */
  podcasts: number;
  /** Audiobook tracks. */
  audiobooks: number;
  /** Music-video tracks. */
  musicVideos: number;
  /** TV-show episode tracks. */
  tvShows: number;
  /** Number of playlists (including the master/library playlist libgpod reports). */
  playlists: number;
}

/**
 * A single progress event from an archive orchestrator. Discriminated by `kind`.
 *
 * Dump stage (stages 1):
 *  - `dump:start` — emitted once the output directory name is known, *before*
 *    the copy begins. Carries where the archive is going and the best device
 *    label available pre-copy.
 *  - `dump:file` — emitted once per file as it is copied + hashed; `copied` is
 *    the running count.
 *  - `dump:done` — emitted after the copy, with the final file count.
 *
 * Transform stage (stage 2):
 *  - `transform:start` — emitted after the dump is loaded, carrying the resolved
 *    device identity and the media-kind {@link TransformStats} breakdown.
 *  - `transform:track` — emitted once per track in the extraction loop; `done`
 *    is the running count and `total` the catalogue size.
 *  - `transform:done` — emitted at the end, with the number of tracks written.
 */
export type ArchiveProgressEvent =
  | { kind: 'dump:start'; outputDir: string; deviceName: string; serialNumber?: string }
  | { kind: 'dump:file'; copied: number }
  | { kind: 'dump:done'; fileCount: number }
  | { kind: 'transform:start'; identity: DumpDeviceIdentity; stats: TransformStats }
  | { kind: 'transform:track'; done: number; total: number; title?: string }
  | { kind: 'transform:done'; written: number };

/** The callback shape orchestrators accept. Optional and side-effect-only. */
export type ArchiveProgressCallback = (event: ArchiveProgressEvent) => void;
