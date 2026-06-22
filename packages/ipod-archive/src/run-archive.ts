/**
 * `runArchive` — full happy-path orchestrator (both stages).
 *
 * A thin composition of the two package orchestrators that runs the default
 * `podkit device archive` path end to end: a lossless **raw dump** of the live
 * iPod volume followed by the device-free **transform** into a browsable
 * archive. The transform reads only the dump the first stage just produced, so
 * the resulting directory is fully self-contained:
 *
 *   <destDir>/<deviceName>-<identity>-<timestamp>/
 *     raw dump/                         (stage 1 — lossless copy + manifest)
 *       iPod_Control/...
 *       manifest.sha256
 *     archive/                          (stage 2 — browsable archive)
 *       Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>
 *       Playlists/<name>.m3u8
 *       library.sqlite
 *       README.md
 *       report.md  report.json          (covers BOTH stages)
 *
 * The unified `report.{md,json}` lives at the archive root and covers both
 * stages: stage-1 buckets are threaded through from {@link runDump}'s result so
 * the report's stage-1 section is real (foreign/junk/dump-failures), not the
 * "not available (transform-only run)" placeholder a standalone `--from-dump`
 * transform emits.
 *
 * Output location: the archive is written *inside* the same named output dir the
 * dump created, so one directory holds both artifacts. This is achieved by
 * handing the dump's `outputDir` to {@link runTransform} (whose default places
 * `archive/` beside `raw dump/` for a named stage-1 dir).
 *
 * @module
 */

import { runDump, type RunDumpOptions, type DumpResult } from './run-dump.js';
import { runTransform, type TransformResult } from './run-transform.js';

/** Options for {@link runArchive} — the union the CLI threads through. */
export interface RunArchiveOptions extends RunDumpOptions {
  /**
   * podkit version string recorded in the catalogue's `device` row. Defaults to
   * `'unknown'` when the caller (a leaf package) cannot resolve a build version.
   */
  podkitVersion?: string;
}

/**
 * Everything the full both-stages run produced, for the CLI summary. Carries the
 * stage-1 dump result and the stage-2 transform result whole, plus the shared
 * self-contained output directory.
 */
export interface ArchiveResult {
  /**
   * Absolute path of the named, self-contained output directory holding both
   * `raw dump/` and `archive/`. Same as {@link DumpResult.outputDir}.
   */
  outputDir: string;
  /** The complete stage-1 dump result. */
  dump: DumpResult;
  /** The complete stage-2 transform result. */
  transform: TransformResult;
}

/**
 * Run the full archive happy path against a mounted iPod volume: dump, then
 * transform the dump in place.
 *
 * @param volumeRoot - mounted iPod volume root (e.g. `/Volumes/IPOD`).
 * @param destDir - directory the named output dir is created under.
 * @param opts - device name / label / clock + podkit version.
 */
export async function runArchive(
  volumeRoot: string,
  destDir: string,
  opts: RunArchiveOptions = {}
): Promise<ArchiveResult> {
  const { podkitVersion, onProgress, ...dumpOpts } = opts;
  // Capture the clock once so the dir-name timestamp (stage 1) and the
  // catalogue's dump_date (stage 2) are identical even on a large iPod.
  const now = opts.now ?? new Date();

  const dump = await runDump(volumeRoot, destDir, {
    ...dumpOpts,
    now,
    skipReport: true,
    ...(onProgress ? { onProgress } : {}),
  });

  // Transform the dump in place. Passing the dump's named output dir lands
  // `archive/` beside `raw dump/`; threading the stage-1 buckets through
  // `dumpReport` makes the unified report cover both stages. The same
  // `onProgress` channel carries both stages' events in order.
  const transform = await runTransform(dump.outputDir, {
    ...(podkitVersion !== undefined ? { podkitVersion } : {}),
    now: () => now,
    dumpReport: dump.report,
    ...(onProgress ? { onProgress } : {}),
  });

  return { outputDir: dump.outputDir, dump, transform };
}
