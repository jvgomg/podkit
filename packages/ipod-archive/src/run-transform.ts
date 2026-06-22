/**
 * `runTransform` — stage-2 orchestrator.
 *
 * A **pure function of a stage-1 dump**: it loads the dump's database, plans an
 * archive path for every track, and extracts each track's audio (lossless copy
 * + restamped tags) into a browsable `Music/` tree. It never opens a live
 * device.
 *
 * On-disk layout produced (sibling of the dump's `raw dump/`):
 *
 *   <named dump dir>/
 *     raw dump/                      (stage 1, untouched)
 *     archive/
 *       Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>
 *
 * Output-location resolution: the archive root is `archive/` inside the dump
 * dir the loader resolved the iPod root from. When `dumpDir` is a named
 * stage-1 archive dir (containing `raw dump/`), `archive/` lands beside
 * `raw dump/`. When `dumpDir` is a bare iPod root (containing `iPod_Control`),
 * `archive/` lands inside it. `opts.outputDir` overrides this entirely.
 *
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type { Track } from '@podkit/libgpod-node';
import { loadDump, type DumpDeviceIdentity } from './dump-loader.js';
import {
  planPath,
  createCollisionState,
  toPlannerTrack,
  classifyMediaType,
  MUSIC_SUBDIR,
} from './archive-path-planner.js';
import type { ArchiveProgressCallback, TransformStats } from './progress-events.js';
import { writeTrack, type TrackTagMeta } from './tag-writer.js';
import { resolveDumpAudioPath } from './ipod-path.js';
import { createArtworkDecoder } from './artwork/artwork-decoder.js';
import { rgbaToPng } from './artwork/rgba-to-png.js';
import { writeLibraryDb, type TrackPathInfo } from './library-db-writer.js';
import { writePlaylists, type WrittenPlaylist, type PlaylistFailure } from './playlist-writer.js';
import {
  ArchiveReport,
  computeLibraryStats,
  renderReadme,
  type ReportStage1,
  type ReportStage2,
} from './archive-report.js';

/** Subdirectory under the named dump dir that holds the browsable archive. */
export const ARCHIVE_SUBDIR = 'archive';

/** Filename of the human-readable archive identity card. */
export const README_FILENAME = 'README.md';

/** Filename of the human-readable skip/failure report. */
export const REPORT_MD_FILENAME = 'report.md';

/** Filename of the machine-readable skip/failure report. */
export const REPORT_JSON_FILENAME = 'report.json';

/** Options for {@link runTransform}. */
export interface RunTransformOptions {
  /**
   * Override the archive output directory. When omitted, the archive root is
   * `<dumpDir-or-its-parent>/archive` (see the module docs for the exact rule).
   */
  outputDir?: string;
  /**
   * podkit version string recorded in the catalogue's `device` row. Defaults to
   * `'unknown'` when the caller (a leaf package) cannot resolve a build version;
   * the CLI passes its own version through.
   */
  podkitVersion?: string;
  /**
   * Wall-clock used for the catalogue's `dump_date` (Unix seconds). Injected so
   * tests are deterministic; defaults to the current time.
   */
  now?: () => Date;
  /**
   * Stage-1 dump buckets to fold into the emitted report, threaded in by the
   * CLI when the default run executes both stages in one invocation. Omitted for
   * a standalone `--from-dump` transform — the report then marks its stage-1
   * section "not available (transform-only run)" rather than claiming nothing
   * was skipped.
   */
  dumpReport?: ReportStage1;
  /**
   * Side-effect-only progress channel. Emits `transform:start` (with the
   * resolved identity + media-kind breakdown) after the dump loads,
   * `transform:track` per track in the extraction loop, and `transform:done`
   * at the end. Optional; never affects the result.
   */
  onProgress?: ArchiveProgressCallback;
}

/** A track that produced no archive entry, with the reason recorded. */
export interface TransformSkip {
  /** Database ID of the skipped track. */
  dbid: bigint;
  /** Track title (best-effort), for the report. */
  title: string | null;
}

/** A track whose extraction failed (recorded, not fatal to the run). */
export interface TransformFailure {
  /** Database ID of the failed track. */
  dbid: bigint;
  /** Track title (best-effort), for the report. */
  title: string | null;
  /** Planned archive-relative destination path. */
  relPath: string;
  /** Resolved source path inside the dump, or the raw ipodPath when resolution itself failed. */
  sourcePath: string;
  /** Human-readable failure reason. */
  error: string;
}

/** Everything stage-2 produced, for the CLI summary and the later report stage. */
export interface TransformResult {
  /** Absolute path of the archive root (`archive/`). */
  archiveDir: string;
  /** The iPod root inside the dump that tracks were resolved against. */
  ipodRoot: string;
  /** Number of tracks successfully extracted + tagged. */
  written: number;
  /** Tracks with no audio body (null/empty `ipodPath`). */
  noAudio: TransformSkip[];
  /**
   * Tracks that were extracted but carried no decodable album artwork — no
   * cover was embedded and none could be written. The report stage consumes
   * this; it is not a failure (many iPods have no artwork at all).
   */
  noArtwork: TransformSkip[];
  /** Tracks whose audio was missing or whose extraction failed. */
  failures: TransformFailure[];
  /** Resolved device identity (best-effort). */
  identity: DumpDeviceIdentity;
  /** Absolute path of the emitted SQLite catalogue (`library.sqlite`). */
  libraryDbPath: string;
  /** Absolute path of the emitted `README.md` identity card. */
  readmePath: string;
  /** Absolute path of the emitted human-readable `report.md`. */
  reportMarkdownPath: string;
  /** Absolute path of the emitted machine-readable `report.json`. */
  reportJsonPath: string;
  /**
   * Non-master playlists emitted as `Playlists/<name>.m3u8`. Empty when the dump
   * has no playlists beyond the master/library one.
   */
  playlistsWritten: WrittenPlaylist[];
  /** Playlists whose `.m3u8` write failed (recorded, not fatal to the run). */
  playlistFailures: PlaylistFailure[];
}

/**
 * Project a libgpod `Track`'s metadata into the tag-write payload.
 *
 * Writes the core textual fields. Artwork is folded in by the caller (it sets
 * `cover` on the returned meta when a track has decodable album art).
 */
function toTagMeta(track: Track): TrackTagMeta {
  const meta: TrackTagMeta = {};
  if (track.title !== null) meta.title = track.title;
  if (track.artist !== null) meta.artist = track.artist;
  if (track.album !== null) meta.album = track.album;
  if (track.albumArtist !== null) meta.albumArtist = track.albumArtist;
  if (track.genre !== null) meta.genre = track.genre;
  if (track.trackNumber > 0) meta.trackNumber = track.trackNumber;
  if (track.discNumber > 0) meta.discNumber = track.discNumber;
  if (track.year > 0) meta.year = track.year;
  if (track.comment !== null) meta.comment = track.comment;
  return meta;
}

/**
 * Compute the per-media-kind {@link TransformStats} breakdown from a
 * materialised track list. Pure projection of each track's classified
 * {@link import('./archive-path-planner.js').MediaKind} — `songs` folds plain
 * music and compilations together; `playlistCount` is supplied by the caller
 * (libgpod reports it separately from the track set).
 */
function computeTransformStats(tracks: readonly Track[], playlistCount: number): TransformStats {
  const stats: TransformStats = {
    total: tracks.length,
    songs: 0,
    movies: 0,
    podcasts: 0,
    audiobooks: 0,
    musicVideos: 0,
    tvShows: 0,
    playlists: playlistCount,
  };
  for (const track of tracks) {
    switch (classifyMediaType(toPlannerTrack(track))) {
      case 'music':
      case 'compilation':
        stats.songs += 1;
        break;
      case 'movie':
        stats.movies += 1;
        break;
      case 'podcast':
        stats.podcasts += 1;
        break;
      case 'audiobook':
        stats.audiobooks += 1;
        break;
      case 'musicVideo':
        stats.musicVideos += 1;
        break;
      case 'tvShow':
        stats.tvShows += 1;
        break;
    }
  }
  return stats;
}

/**
 * Resolve the archive root directory for a dump. Defaults to `archive/` beside
 * the dump's `raw dump/` (i.e. inside the named archive dir). `opts.outputDir`
 * overrides this entirely.
 *
 * `dumpDir` is always the anchor — it is never the `raw dump/` subdirectory
 * itself, so `archive/` lands beside `raw dump/` for a named stage-1 archive
 * dir, or inside a bare iPod root when no named dir wraps it.
 */
function resolveArchiveDir(dumpDir: string, opts: RunTransformOptions): string {
  if (opts.outputDir) return opts.outputDir;
  return join(dumpDir, ARCHIVE_SUBDIR);
}

/**
 * Run the transform stage against an existing dump.
 *
 * @param dumpDir - the named archive dir (containing `raw dump/`) or a directory
 *   that itself contains `iPod_Control`. Pass the named dir, not its
 *   `raw dump/` subdirectory: the archive is anchored at `<dumpDir>/archive`,
 *   so pointing at `raw dump/` itself would nest the archive under it. Use
 *   `opts.outputDir` to place the archive anywhere else.
 * @param opts - optional output-directory override.
 */
export async function runTransform(
  dumpDir: string,
  opts: RunTransformOptions = {}
): Promise<TransformResult> {
  const { db, identity, ipodRoot } = await loadDump(dumpDir);

  try {
    const archiveDir = resolveArchiveDir(dumpDir, opts);
    await mkdir(archiveDir, { recursive: true });

    // One decoder per dump: parses the ArtworkDB once and indexes the largest
    // thumbnail per track dbid. Degrades to an all-null decoder when the dump
    // has no readable ArtworkDB.
    const artwork = createArtworkDecoder(ipodRoot);
    // Album folders (archive-relative dirnames) that already have a cover.png,
    // so it is encoded + written at most once per album.
    const coveredAlbumDirs = new Set<string>();

    const collisionState = createCollisionState();
    const noAudio: TransformSkip[] = [];
    const noArtwork: TransformSkip[] = [];
    const failures: TransformFailure[] = [];
    let written = 0;

    // dbid → where each track was written + where it came from. Threaded into the
    // catalogue so `tracks.exported_path` / `tracks.dump_path` resolve. A track
    // is recorded here whether or not its audio was extracted (no-audio tracks
    // get a null exportedPath), so every track appears in the catalogue.
    const pathMap = new Map<bigint, TrackPathInfo>();

    // Materialise libgpod's track set a single time per run. The same array is
    // counted for the progress breakdown, iterated for extraction below, and
    // reused for the README library stats — libgpod's handle walk happens once.
    const allTracks: Track[] = db.getTracks().map((handle) => db.getTrack(handle));

    // Read the playlist list once and share it between the start-of-transform
    // breakdown, the catalogue (which records playlists + membership + smart
    // rules), and the m3u8 playlist writer. libgpod is asked for it a single
    // time per run.
    const playlists = db.getPlaylists();

    // Announce the resolved identity + media-kind breakdown before extraction.
    opts.onProgress?.({
      kind: 'transform:start',
      identity,
      stats: computeTransformStats(allTracks, playlists.filter((p) => !p.isMaster).length),
    });

    let processed = 0;
    for (const track of allTracks) {
      processed += 1;
      opts.onProgress?.({
        kind: 'transform:track',
        done: processed,
        total: allTracks.length,
        ...(track.title !== null ? { title: track.title } : {}),
      });

      const relPath = planPath(toPlannerTrack(track), collisionState);
      if (relPath === null) {
        noAudio.push({ dbid: track.dbid, title: track.title });
        // No audio body → no archive entry, but it still belongs in the
        // catalogue with a null exported_path and its (possibly null) ipodPath.
        pathMap.set(track.dbid, { exportedPath: null, dumpPath: track.ipodPath });
        continue;
      }

      const sourcePath = resolveDumpAudioPath(ipodRoot, track.ipodPath);
      // planPath returned non-null, so ipodPath was non-empty. The only way
      // resolveDumpAudioPath returns null here is when the path-traversal
      // containment check fires (crafted dump escaping ipodRoot). That is a
      // planner/loader inconsistency — not a legitimate "no audio" track —
      // so route it to failures rather than silently bucketing it as noAudio.
      if (sourcePath === null) {
        failures.push({
          dbid: track.dbid,
          title: track.title,
          relPath,
          sourcePath: track.ipodPath ?? '',
          error: 'ipodPath resolves outside the dump root (path-traversal guard)',
        });
        // Not extracted → null exported_path; the ipodPath is its dump source.
        pathMap.set(track.dbid, { exportedPath: null, dumpPath: track.ipodPath });
        continue;
      }

      // Decode the track's largest album art to a PNG. A decode failure is
      // non-fatal: it routes the track to the `noArtwork` bucket and the
      // extraction proceeds without an embedded cover.
      const meta = toTagMeta(track);
      let coverPng: Buffer | null = null;
      try {
        const rgba = artwork.coverRgba(track.dbid);
        if (rgba !== null) {
          coverPng = rgbaToPng(rgba);
          meta.cover = coverPng;
        }
      } catch {
        // Treat any decode/encode error as "no artwork" rather than failing the
        // track — the audio extraction below is the important part.
        coverPng = null;
      }

      const destFile = join(archiveDir, relPath);
      try {
        await writeTrack(sourcePath, destFile, meta);
        written += 1;
        // Extracted: record the archive-relative destination + dump source so
        // the catalogue maps this track to its exported file.
        pathMap.set(track.dbid, { exportedPath: relPath, dumpPath: track.ipodPath });
        // Only record no-artwork for tracks that were successfully extracted;
        // a track that fails extraction appears only in failures, not here.
        if (coverPng === null) {
          noArtwork.push({ dbid: track.dbid, title: track.title });
        }
      } catch (err) {
        failures.push({
          dbid: track.dbid,
          title: track.title,
          relPath,
          sourcePath,
          error: err instanceof Error ? err.message : String(err),
        });
        // Extraction failed → no exported file; still cataloguable via its source.
        pathMap.set(track.dbid, { exportedPath: null, dumpPath: track.ipodPath });
        continue;
      }

      // Write a `cover.png` into the album folder, once per folder. Only the
      // Music tree gets sidecar covers — podcasts and video are embedding-only
      // (those layouts aren't album-shaped, so a per-folder cover.png would be
      // misleading). A sidecar write failure is non-fatal: the cover is still
      // embedded in the track, so it is recorded as a failure but does not undo
      // the successful extraction.
      if (coverPng !== null && isMusicTreePath(relPath)) {
        const albumRelDir = posix.dirname(relPath);
        if (!coveredAlbumDirs.has(albumRelDir)) {
          const coverFile = join(dirname(destFile), COVER_FILENAME);
          try {
            await writeFile(coverFile, coverPng);
            // Mark covered only after the write succeeds, so a transient write
            // failure doesn't permanently suppress cover.png for this album —
            // a later track in the same album gets another chance.
            coveredAlbumDirs.add(albumRelDir);
          } catch (err) {
            failures.push({
              dbid: track.dbid,
              title: track.title,
              relPath: posix.join(albumRelDir, COVER_FILENAME),
              sourcePath,
              error: `cover.png write failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }
    }

    opts.onProgress?.({ kind: 'transform:done', written });

    // Emit the parsed, queryable catalogue. The track loop above accumulated the
    // exported/source paths; the artwork index and identity are sourced as-is.
    const dumpDate = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000);
    const libraryDbPath = writeLibraryDb({
      db,
      archiveDir,
      identity,
      pathMap,
      playlists,
      artworkIndex: artwork,
      dumpDate,
      podkitVersion: opts.podkitVersion ?? 'unknown',
    });

    // Emit `Playlists/<name>.m3u8` for every non-master playlist. A failure on
    // one playlist is collected and does not abort the run.
    const playlistResult = await writePlaylists({ db, playlists, pathMap, archiveDir });

    // Emit the README identity card + the cross-stage skip/failure report. The
    // stage-2 buckets come from this run; stage-1 buckets are folded in only when
    // the caller threaded them through `opts.dumpReport` (the default both-stages
    // run). For a standalone `--from-dump` transform, stage-1 is absent and the
    // report marks that section "not available".
    const stage2: ReportStage2 = {
      noAudio: noAudio.map(toReportSkip),
      noArtwork: noArtwork.map(toReportSkip),
      transformFailures: failures.map((f) => ({
        dbid: f.dbid.toString(),
        title: f.title,
        relPath: f.relPath,
        error: f.error,
      })),
      playlistFailures: playlistResult.failures.map((f) => ({
        name: f.name,
        relPath: f.relPath,
        error: f.error,
      })),
    };
    let report = ArchiveReport.forTransform(stage2);
    if (opts.dumpReport) report = report.withStage1(opts.dumpReport);

    const stats = computeLibraryStats(allTracks);
    const readme = renderReadme({
      identity,
      dumpDate,
      podkitVersion: opts.podkitVersion ?? 'unknown',
      stats,
    });

    const readmePath = join(archiveDir, README_FILENAME);
    const reportMarkdownPath = join(archiveDir, REPORT_MD_FILENAME);
    const reportJsonPath = join(archiveDir, REPORT_JSON_FILENAME);
    await writeFile(readmePath, readme, 'utf8');
    await writeFile(reportMarkdownPath, report.renderMarkdown(), 'utf8');
    await writeFile(reportJsonPath, `${JSON.stringify(report.toJson(), null, 2)}\n`, 'utf8');

    return {
      archiveDir,
      ipodRoot,
      written,
      noAudio,
      noArtwork,
      failures,
      identity,
      libraryDbPath,
      readmePath,
      reportMarkdownPath,
      reportJsonPath,
      playlistsWritten: playlistResult.written,
      playlistFailures: playlistResult.failures,
    };
  } finally {
    db.close();
  }
}

/** Project a transform skip into the report's JSON-safe (string dbid) shape. */
function toReportSkip(skip: TransformSkip): { dbid: string; title: string | null } {
  return { dbid: skip.dbid.toString(), title: skip.title };
}

/** Filename of the per-album sidecar cover written into Music album folders. */
const COVER_FILENAME = 'cover.png';

/**
 * Whether an archive-relative path lives under the Music tree. Cover.png
 * sidecars are written only there; podcast/video layouts are embedding-only.
 * `relPath` uses POSIX separators (see {@link planPath}).
 */
function isMusicTreePath(relPath: string): boolean {
  return relPath === MUSIC_SUBDIR || relPath.startsWith(`${MUSIC_SUBDIR}/`);
}
