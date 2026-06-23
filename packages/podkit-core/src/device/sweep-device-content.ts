/**
 * Brute-force on-disk content sweep for a factory reset.
 *
 * Clearing the iTunesDB (removing all tracks) only resets the *database* — it
 * leaves the actual audio files sitting in `iPod_Control/Music/F00..Fnn` and the
 * artwork thumbnails in `iPod_Control/Artwork`. Those files become orphans: no
 * database row references them, yet they still occupy space and (for artwork)
 * can confuse a subsequent rebuild. `clear`/`reset-artwork` only remove files
 * the DB knows about, so an orphan introduced by an external tool, a crashed
 * sync, or a corrupt DB survives them.
 *
 * `sweepDeviceContent` deletes the content files *directly on disk*, by walking
 * the on-disk tree rather than the database. That is what makes `reset` a true
 * factory wipe: every audio file under `Music/F*` and every artwork `.ithmb`
 * (plus the `ArtworkDB`) is removed regardless of whether any database still
 * references it.
 *
 * ## Safety
 *
 * This deletes files. It is constrained so it can only ever operate inside the
 * `iPod_Control` tree of the given mount path:
 *
 *   - `mountPath` must be a non-empty, absolute path that is not the filesystem
 *     root and not `/Volumes` itself (guards against a stray sweep of a real
 *     volume root if a caller passes a bad value).
 *   - The `iPod_Control` directory must already exist under `mountPath` — a
 *     path with no `iPod_Control` is not an iPod and is rejected.
 *   - Deletion targets are always rebuilt from `mountPath` via `join`; the
 *     walk never recurses above `iPod_Control/Music` or `iPod_Control/Artwork`.
 *
 * Errors are typed ({@link SweepContentError}); this module never writes to
 * `console`.
 */

import { join, resolve, sep } from 'node:path';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';

/** Typed error thrown when the sweep cannot run (bad path, no iPod tree). */
export class SweepContentError extends Error {
  readonly code: 'INVALID_MOUNT_PATH' | 'NOT_AN_IPOD';
  constructor(message: string, code: SweepContentError['code']) {
    super(message);
    this.name = 'SweepContentError';
    this.code = code;
  }
}

export interface SweepDeviceContentOptions {
  /** Remove audio files under `iPod_Control/Music/F*`. Defaults to `true`. */
  music?: boolean;
  /** Remove artwork `.ithmb` files + `ArtworkDB`. Defaults to `true`. */
  artwork?: boolean;
  /**
   * Remove the on-disk database files (`iTunesDB`, `iTunesCDB`, their `.ext`
   * sidecars, and the play-state files that reference tracks). Defaults to
   * `true`. A factory reset deletes these so the database can be recreated from
   * scratch — this is the only way to clear *orphaned playlist members* (stale
   * "track ID 0" entries left by external tools or a prior corrupt DB), which no
   * track-level removal API can reach.
   */
  database?: boolean;
}

export interface SweepDeviceContentResult {
  /** Number of audio files removed from `iPod_Control/Music/F*`. */
  musicFilesRemoved: number;
  /** Number of artwork files removed (`.ithmb` + `ArtworkDB`). */
  artworkFilesRemoved: number;
  /** Number of database files removed from `iPod_Control/iTunes`. */
  databaseFilesRemoved: number;
  /** Total bytes freed across all removed files. */
  bytesFreed: number;
  /** Whether the music branch ran. */
  musicSwept: boolean;
  /** Whether the artwork branch ran. */
  artworkSwept: boolean;
  /** Whether the database branch ran. */
  databaseSwept: boolean;
}

/**
 * Database files under `iPod_Control/iTunes` that reference tracks (so stale
 * copies cause libgpod "track not found" warnings) and are safe to delete for a
 * reset — libgpod recreates the iTunesDB on the next `initializeIpod`. We do NOT
 * touch `iTunesControl`, `iTunesPrefs*`, or `DeviceInfo` (settings/identity).
 */
const RESET_DATABASE_FILES = [
  'iTunesDB',
  'iTunesCDB',
  'iTunesDB.ext',
  'iTunesCDB.ext',
  'Play Counts',
  'OTGPlaylistInfo',
  'iTunesStats',
  'iTunesPState',
];

/**
 * Validate the mount path is safe to sweep within, and that it carries an
 * `iPod_Control` directory. Returns the resolved (absolute) mount path.
 */
function assertSweepableMountPath(mountPath: string): string {
  const trimmed = mountPath?.trim();
  if (!trimmed) {
    throw new SweepContentError('Refusing to sweep: mount path is empty.', 'INVALID_MOUNT_PATH');
  }

  const resolved = resolve(trimmed);

  // Reject the filesystem root and bare `/Volumes` — a sweep there would be
  // catastrophic. We compare against the resolved form so `/` and `/Volumes/`
  // (trailing slash) are both caught.
  const normalized = resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved;
  if (normalized === '' || normalized === '/' || normalized === '/Volumes') {
    throw new SweepContentError(
      `Refusing to sweep an unsafe mount path: "${mountPath}".`,
      'INVALID_MOUNT_PATH'
    );
  }

  const controlDir = join(resolved, 'iPod_Control');
  if (!existsSync(controlDir)) {
    throw new SweepContentError(
      `No iPod_Control directory at "${resolved}" — not an iPod, refusing to sweep.`,
      'NOT_AN_IPOD'
    );
  }

  return resolved;
}

/**
 * Remove every file under `iPod_Control/Music/F*`, returning a count + bytes.
 * The `F00..Fnn` directory skeleton is preserved (libgpod expects it / reuses
 * it on the next sync); only the audio files inside are removed.
 */
function sweepMusic(mountPath: string): { removed: number; bytes: number } {
  const musicDir = join(mountPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) {
    return { removed: 0, bytes: 0 };
  }

  let removed = 0;
  let bytes = 0;

  let entries;
  try {
    entries = readdirSync(musicDir, { withFileTypes: true });
  } catch {
    return { removed: 0, bytes: 0 };
  }

  const fDirs = entries.filter((e) => e.isDirectory() && /^F\d+$/i.test(e.name));
  for (const dir of fDirs) {
    const dirPath = join(musicDir, dir.name);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = join(dirPath, file);
      try {
        const s = statSync(filePath);
        if (!s.isFile()) continue;
        bytes += s.size;
        unlinkSync(filePath);
        removed++;
      } catch {
        // Best-effort: a file we can't stat/remove is skipped, not fatal.
      }
    }
  }

  return { removed, bytes };
}

/**
 * Remove the artwork thumbnails (`.ithmb`) and the `ArtworkDB` from
 * `iPod_Control/Artwork`. Mirrors the locations `repair.ts`'s orphaned-ithmb
 * cleanup knows about; here we additionally remove the `ArtworkDB` index so the
 * reset leaves no artwork state behind.
 */
function sweepArtwork(mountPath: string): { removed: number; bytes: number } {
  const artworkDir = join(mountPath, 'iPod_Control', 'Artwork');
  if (!existsSync(artworkDir)) {
    return { removed: 0, bytes: 0 };
  }

  let removed = 0;
  let bytes = 0;

  let files: string[];
  try {
    files = readdirSync(artworkDir);
  } catch {
    return { removed: 0, bytes: 0 };
  }

  for (const file of files) {
    // Thumbnail caches (.ithmb) plus the ArtworkDB index itself.
    if (!file.endsWith('.ithmb') && file !== 'ArtworkDB') continue;
    const filePath = join(artworkDir, file);
    try {
      const s = statSync(filePath);
      if (!s.isFile()) continue;
      bytes += s.size;
      unlinkSync(filePath);
      removed++;
    } catch {
      // Best-effort.
    }
  }

  return { removed, bytes };
}

/**
 * Remove the track-referencing database files from `iPod_Control/iTunes` so the
 * iTunesDB can be recreated empty. This is what clears orphaned playlist members
 * (phantom "track ID 0" entries) that survive track-level removal.
 */
function sweepDatabase(mountPath: string): { removed: number; bytes: number } {
  const itunesDir = join(mountPath, 'iPod_Control', 'iTunes');
  if (!existsSync(itunesDir)) {
    return { removed: 0, bytes: 0 };
  }

  let removed = 0;
  let bytes = 0;

  for (const name of RESET_DATABASE_FILES) {
    const filePath = join(itunesDir, name);
    try {
      const s = statSync(filePath);
      if (!s.isFile()) continue;
      bytes += s.size;
      unlinkSync(filePath);
      removed++;
    } catch {
      // Best-effort: a missing file (the usual case) or one we can't remove is
      // skipped, not fatal.
    }
  }

  return { removed, bytes };
}

/**
 * Sweep on-disk content for a factory reset.
 *
 * @param mountPath - The iPod mount path. Must be a safe, absolute path with an
 *   existing `iPod_Control` directory (validated; see module doc).
 * @param options - Which classes to remove (`music`, `artwork`, `database`); all
 *   default to `true`.
 * @returns A summary of files removed and bytes freed.
 * @throws {SweepContentError} If `mountPath` is unsafe or not an iPod.
 */
export function sweepDeviceContent(
  mountPath: string,
  options: SweepDeviceContentOptions = {}
): SweepDeviceContentResult {
  const { music = true, artwork = true, database = true } = options;
  const resolved = assertSweepableMountPath(mountPath);

  let musicFilesRemoved = 0;
  let artworkFilesRemoved = 0;
  let databaseFilesRemoved = 0;
  let bytesFreed = 0;

  if (music) {
    const r = sweepMusic(resolved);
    musicFilesRemoved = r.removed;
    bytesFreed += r.bytes;
  }

  if (artwork) {
    const r = sweepArtwork(resolved);
    artworkFilesRemoved = r.removed;
    bytesFreed += r.bytes;
  }

  if (database) {
    const r = sweepDatabase(resolved);
    databaseFilesRemoved = r.removed;
    bytesFreed += r.bytes;
  }

  return {
    musicFilesRemoved,
    artworkFilesRemoved,
    databaseFilesRemoved,
    bytesFreed,
    musicSwept: music,
    artworkSwept: artwork,
    databaseSwept: database,
  };
}
