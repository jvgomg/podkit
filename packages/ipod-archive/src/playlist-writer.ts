/**
 * PlaylistWriter — emit a `Playlists/` directory of `.m3u8` files alongside the
 * browsable `Music/` tree.
 *
 * One UTF-8 `.m3u8` is written per playlist, *except* the master/library
 * playlist (which is just "everything" and would duplicate the whole archive).
 * Each file is an extended M3U: a `#EXTM3U` header followed, per track, by an
 * `#EXTINF:<seconds>,<artist> - <title>` line and the track's path. Paths are
 * **relative** to the `Playlists/` directory (typically
 * `../Music/<AlbumArtist>/<Album>/NN Title.ext`) and always use POSIX
 * separators so the file is portable across platforms.
 *
 * Smart playlists are written exactly like manual ones — the *resolved* track
 * list libgpod returns for them. The rule definitions are not duplicated here;
 * they are persisted by the catalogue slice (`smart_playlist_rules` in
 * `library.sqlite`).
 *
 * Track resolution: a track is written only when the transform exported its
 * audio (its `dbid` maps to a non-null `exportedPath` in the shared `pathMap`).
 * A playlist entry whose track was not exported (no audio, extraction failure,
 * or simply absent from the map) is skipped — the writer never emits a dangling
 * path — and recorded as a comment in the file for transparency.
 *
 * Leaf module: pure path/string logic plus a thin filesystem write. No
 * `@podkit/core`, no `console`/stderr — failures surface as typed errors or are
 * collected and returned to the caller.
 *
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Database, Playlist, Track, TrackHandle } from '@podkit/libgpod-node';
import type { TrackPathInfo } from './library-db-writer.js';
import { sanitizePathSegment } from './sanitize.js';
import { IpodArchiveError } from './errors.js';

/** Subdirectory under the archive root that holds the emitted `.m3u8` files. */
export const PLAYLISTS_SUBDIR = 'Playlists';

/** Extension (UTF-8 M3U) used for every emitted playlist file. */
const M3U8_EXT = '.m3u8';

/** Fallback base name for a playlist whose name sanitises to nothing. */
const FALLBACK_PLAYLIST_NAME = 'Playlist';

/** A single resolved entry in an emitted playlist. */
export interface PlaylistEntry {
  /** Track database id. */
  dbid: bigint;
  /** Duration in whole seconds, for the `#EXTINF` line (0 when unknown). */
  durationSeconds: number;
  /** Display artist for the `#EXTINF` line (empty string when absent). */
  artist: string;
  /** Display title for the `#EXTINF` line (empty string when absent). */
  title: string;
  /**
   * Path written for this entry, relative to the `Playlists/` directory and
   * using POSIX separators (e.g. `../Music/Band/Album/01 Song.m4a`).
   */
  relativePath: string;
}

/** A track that appeared in a playlist but produced no archive entry. */
export interface SkippedPlaylistEntry {
  /** Track database id. */
  dbid: bigint;
  /** Best-effort title for the report / file comment. */
  title: string | null;
}

/**
 * One ordered slot in a resolved playlist: either an exported entry (written as
 * `#EXTINF` + path) or a skipped member (written as a `# skipped` comment in the
 * position it would have occupied, so the file documents the gap without losing
 * playlist order or emitting a dangling path).
 */
export type PlaylistLine =
  | { kind: 'entry'; entry: PlaylistEntry }
  | { kind: 'skip'; skip: SkippedPlaylistEntry };

/** A playlist that was emitted as a `.m3u8` file. */
export interface WrittenPlaylist {
  /** Playlist database id. */
  id: bigint;
  /** Original (pre-sanitise) playlist name, or null. */
  name: string | null;
  /** Whether libgpod flagged this as a smart playlist. */
  isSmart: boolean;
  /** Archive-relative path of the emitted file (e.g. `Playlists/My Mix.m3u8`). */
  relPath: string;
  /** Resolved entries actually written (in order). */
  entries: PlaylistEntry[];
  /** Playlist members skipped because their audio was not exported. */
  skipped: SkippedPlaylistEntry[];
}

/** A playlist whose `.m3u8` could not be written (recorded, not fatal). */
export interface PlaylistFailure {
  /** Playlist database id. */
  id: bigint;
  /** Best-effort playlist name. */
  name: string | null;
  /** Archive-relative destination that failed to write. */
  relPath: string;
  /** Human-readable failure reason. */
  error: string;
}

/** Options for {@link writePlaylists}. */
export interface WritePlaylistsOptions {
  /** Open libgpod database for the dump (read-only use). */
  db: Database;
  /**
   * The playlists to consider, already read from `db.getPlaylists()` by the
   * caller. Passed in (rather than re-fetched) so the catalogue slice and the
   * playlist writer share a single read.
   */
  playlists: Playlist[];
  /** `dbid` → exported/source paths, accumulated by the transform's track loop. */
  pathMap: Map<bigint, TrackPathInfo>;
  /** Absolute archive root. The `Playlists/` dir is created inside it on demand. */
  archiveDir: string;
}

/** Everything the playlist write produced, for the run summary. */
export interface WritePlaylistsResult {
  /** Playlists successfully emitted as `.m3u8` files. */
  written: WrittenPlaylist[];
  /** Playlists whose file write failed (non-fatal). */
  failures: PlaylistFailure[];
}

/**
 * Compute the POSIX-relative path from the `Playlists/` directory to a track's
 * exported file. `exportedPath` is archive-relative and already POSIX (see
 * {@link planPath}); the archive root is one level up from `Playlists/`, so the
 * result is `../<exportedPath>`. Pure and platform-independent — it never
 * touches `path.sep`.
 */
export function playlistRelativePath(exportedPath: string): string {
  // Guard the contract: `exportedPath` must be archive-relative. An absolute
  // path would survive `posix.join('..', …)` unchanged (POSIX join discards
  // everything left of the last absolute segment), silently leaking an absolute
  // path into the m3u8. Treat that as a planner/transform inconsistency.
  if (exportedPath.startsWith('/')) {
    throw new IpodArchiveError(
      'PLAYLIST_PATH_INVALID',
      `exported path must be archive-relative, got absolute: ${exportedPath}`
    );
  }
  // `Playlists/` is a direct child of the archive root, so a track exported to
  // `Music/…` is reached from inside `Playlists/` by going up one level. Using
  // `posix.join` collapses the `..` cleanly and keeps forward slashes.
  return posix.join('..', exportedPath);
}

/**
 * Project a libgpod {@link Track} to the display fields an `#EXTINF` line needs:
 * whole-second duration (rounded from the millisecond field, never negative),
 * and artist/title coerced to strings (libgpod nulls become empty strings).
 */
export function trackExtinf(track: Track): {
  durationSeconds: number;
  artist: string;
  title: string;
} {
  const durationSeconds = Math.max(0, Math.round((track.duration || 0) / 1000));
  return {
    durationSeconds,
    artist: track.artist ?? '',
    title: track.title ?? '',
  };
}

/**
 * Serialise a resolved playlist (header + ordered lines) to the exact `.m3u8`
 * text.
 *
 * The output is an extended M3U: a `#EXTM3U` header, then for each ordered line
 * either an `#EXTINF:<seconds>,<artist> - <title>` line followed by its relative
 * path (for an exported entry), or a single `# skipped` comment **in the
 * position the track held in the playlist** (for a member whose audio was not
 * exported). Skips stay inline so the file preserves playlist order and never
 * emits a dangling path. The text ends with a trailing newline. Pure — no IO.
 */
export function serializePlaylistM3u8(lines: PlaylistLine[]): string {
  const out: string[] = ['#EXTM3U'];
  for (const line of lines) {
    if (line.kind === 'skip') {
      out.push(`# skipped (no exported audio): ${line.skip.title ?? '<untitled>'}`);
    } else {
      const { entry } = line;
      out.push(`#EXTINF:${entry.durationSeconds},${entry.artist} - ${entry.title}`);
      out.push(entry.relativePath);
    }
  }
  // Trailing newline so the file is a well-formed text file (every line,
  // including the last path, is newline-terminated).
  return `${out.join('\n')}\n`;
}

/**
 * Pick a unique, sanitised base name for a playlist file, disambiguating
 * collisions deterministically.
 *
 * The name is sanitised with the human-browsable segment rules (spaces kept,
 * illegal characters neutralised). When it sanitises to nothing, a fallback is
 * used. When the chosen base collides with one already taken (two playlists
 * sharing a sanitised name), the playlist id is appended (`Name [<id>]`); in
 * the astronomically unlikely event that still collides, a numeric index is
 * appended too. `taken` is mutated to reserve the returned name.
 */
export function uniquePlaylistBaseName(
  name: string | null,
  id: bigint,
  taken: Set<string>
): string {
  const sanitized = sanitizePathSegment(name ?? '');
  const base = sanitized || FALLBACK_PLAYLIST_NAME;

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }

  // First disambiguation: append the playlist id, which is unique per playlist.
  const withId = `${base} [${id.toString()}]`;
  if (!taken.has(withId)) {
    taken.add(withId);
    return withId;
  }

  // Defensive: if even the id-suffixed name is taken (e.g. a literal name that
  // already contained that suffix), walk an index until a free name is found.
  let index = 2;
  let candidate = `${withId} (${index})`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${withId} (${index})`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * The ordered track handles to emit for a playlist.
 *
 * Manual playlists use `getPlaylistTracks` — libgpod returns the members in
 * playlist order. Smart playlists store a *materialised* member list on a real
 * iPod (the firmware writes it), so `getPlaylistTracks` is preferred when it has
 * members; but a freshly-built smart playlist (and the test harness) has an
 * empty materialised list, so we fall back to `evaluateSmartPlaylist`, which
 * simulates the firmware's rule evaluation against the track set. The resolved
 * list is what the spec asks the m3u8 to contain.
 */
function playlistTrackHandles(db: Database, playlist: Playlist): TrackHandle[] {
  const materialised = db.getPlaylistTracks(playlist.id);
  if (!playlist.isSmart || materialised.length > 0) {
    return materialised;
  }
  try {
    return db.evaluateSmartPlaylist(playlist.id);
  } catch {
    // If evaluation fails, fall back to the (possibly empty) materialised list
    // rather than aborting — a header-only m3u8 is still valid.
    return materialised;
  }
}

/**
 * Resolve a playlist's ordered membership into an ordered list of lines (each an
 * exported entry or an in-position skip), preserving playlist order.
 *
 * Order is preserved from libgpod (materialised order, or rule-evaluation order
 * for an unmaterialised smart playlist). A track with no `pathMap` entry, or a
 * null `exportedPath`, becomes a `skip` line at the position it held (never an
 * emitted dangling path).
 */
function resolvePlaylistLines(
  db: Database,
  playlist: Playlist,
  pathMap: Map<bigint, TrackPathInfo>
): PlaylistLine[] {
  const lines: PlaylistLine[] = [];

  for (const handle of playlistTrackHandles(db, playlist)) {
    const track = db.getTrack(handle);
    const paths = pathMap.get(track.dbid);
    if (!paths || paths.exportedPath === null) {
      lines.push({ kind: 'skip', skip: { dbid: track.dbid, title: track.title } });
      continue;
    }
    const { durationSeconds, artist, title } = trackExtinf(track);
    lines.push({
      kind: 'entry',
      entry: {
        dbid: track.dbid,
        durationSeconds,
        artist,
        title,
        relativePath: playlistRelativePath(paths.exportedPath),
      },
    });
  }

  return lines;
}

/**
 * Write a `Playlists/<name>.m3u8` file for every non-master playlist.
 *
 * The master/library playlist is skipped. The `Playlists/` directory is created
 * only when at least one non-master playlist exists. A failure writing one
 * playlist is collected into `failures` and does not abort the others.
 */
export async function writePlaylists(opts: WritePlaylistsOptions): Promise<WritePlaylistsResult> {
  const { db, playlists, pathMap, archiveDir } = opts;

  const exportable = playlists.filter((p) => !p.isMaster);
  const written: WrittenPlaylist[] = [];
  const failures: PlaylistFailure[] = [];

  if (exportable.length === 0) {
    return { written, failures };
  }

  const playlistsDir = join(archiveDir, PLAYLISTS_SUBDIR);
  await mkdir(playlistsDir, { recursive: true });

  // Reserved base names, so two playlists with the same sanitised name land in
  // distinct files. Seeded as we go through the list in libgpod's order.
  const takenBaseNames = new Set<string>();

  for (const playlist of exportable) {
    const base = uniquePlaylistBaseName(playlist.name, playlist.id, takenBaseNames);
    const fileName = `${base}${M3U8_EXT}`;
    const relPath = posix.join(PLAYLISTS_SUBDIR, fileName);
    const destFile = join(playlistsDir, fileName);

    try {
      // Resolve inside the try so a contract violation (e.g. a non-relative
      // exported path) is recorded as a per-playlist failure, not a run abort.
      const lines = resolvePlaylistLines(db, playlist, pathMap);
      const content = serializePlaylistM3u8(lines);
      await writeFile(destFile, content, 'utf8');
      written.push({
        id: playlist.id,
        name: playlist.name,
        isSmart: playlist.isSmart,
        relPath,
        entries: lines.flatMap((l) => (l.kind === 'entry' ? [l.entry] : [])),
        skipped: lines.flatMap((l) => (l.kind === 'skip' ? [l.skip] : [])),
      });
    } catch (err) {
      failures.push({
        id: playlist.id,
        name: playlist.name,
        relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { written, failures };
}
