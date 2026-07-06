/**
 * LibraryDbWriter — build `library.sqlite`, the parsed, queryable view of a dump.
 *
 * This is the *catalogue* of an iPod archive: a single SQLite file holding every
 * meaningful field libgpod-node exposes for the dump's tracks, its playlists and
 * their ordered membership, derived album rollups, per-track artwork dimensions,
 * and smart-playlist rule definitions — plus a one-row `device` summary and a
 * `schema_version` constant.
 *
 * It is *not* a backup. No raw `iTunesDB`/`ArtworkDB` bytes are stored here; the
 * raw dump in `raw/` remains the lossless source of truth. The catalogue is
 * the convenient, queryable projection of it.
 *
 * Fidelity contract: play counts, ratings, last-played / skip counts and
 * date-added are copied through verbatim — no scaling, no clamping, no timezone
 * math. The 64-bit unsigned `dbid` / playlist id values are stored as TEXT to
 * avoid the precision loss SQLite's i64 INTEGER column would inflict on values
 * above 2^63. Booleans are stored as 0/1.
 *
 * The whole write runs inside one transaction with prepared statements, so the
 * file either lands complete or not at all, and bulk inserts stay fast.
 *
 * Driver: Bun's built-in `bun:sqlite` (the CLI ships Bun-only — see the PRD's
 * Branch A note). `Database` from `bun:sqlite` is aliased to `SqliteDatabase`
 * here because the name collides with libgpod-node's `Database`.
 *
 * @module
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Database as SqliteDatabase } from 'bun:sqlite';
import type { Database, Track, Playlist, SPLRule, SPLPreferences } from '@podkit/libgpod-node';
import type { ArtworkDecoder } from './artwork/artwork-decoder.js';
import type { DumpDeviceIdentity } from './dump-loader.js';
import { compareStable } from './archive-report.js';

/**
 * Schema version of `library.sqlite`. Stored in the `schema_version` table so a
 * future reader can branch on it. Bump on any breaking column change.
 */
export const LIBRARY_DB_SCHEMA_VERSION = 1;

/** Filename of the catalogue written into the archive root. */
export const LIBRARY_DB_FILENAME = 'library.sqlite';

/**
 * Where a track was written, and where it came from — accumulated by the
 * transform during its track loop and handed to the writer per `dbid`.
 */
export interface TrackPathInfo {
  /**
   * Archive-relative path the track's audio was written to, or `null` when the
   * track produced no archive entry (a no-audio track). Stored as `exported_path`.
   */
  exportedPath: string | null;
  /**
   * Source path of the track inside the dump — its colon-separated `ipodPath`.
   * Stored as `dump_path`; `null` when the track has no on-device file.
   */
  dumpPath: string | null;
}

/** Options for {@link writeLibraryDb}. */
export interface WriteLibraryDbOptions {
  /** The open libgpod database for the dump. The writer only reads from it. */
  db: Database;
  /** Archive root the `library.sqlite` file is written into. */
  archiveDir: string;
  /** Best-effort device identity resolved from the dump. */
  identity: DumpDeviceIdentity;
  /** `dbid` → exported/source paths, accumulated by the transform. */
  pathMap: Map<bigint, TrackPathInfo>;
  /**
   * The dump's playlists, read once by the caller (`db.getPlaylists()`) and
   * shared with the m3u8 playlist writer so libgpod's playlist list is fetched
   * a single time per run.
   */
  playlists: Playlist[];
  /** Artwork index for the dump — sources the `artwork` table's dimensions/format. */
  artworkIndex: ArtworkDecoder;
  /**
   * Timestamp recorded as the catalogue's `dump_date` (Unix seconds). Injected
   * so tests are deterministic; the caller defaults it to "now".
   */
  dumpDate: number;
  /** podkit version string recorded in the `device` row. */
  podkitVersion: string;
}

/** Render a 64-bit id as the canonical decimal TEXT key used across the schema. */
function idText(value: bigint): string {
  return value.toString();
}

/** SQLite has no boolean type; store flags as 0/1 integers. */
function boolInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** The DDL for every table, applied once up front. */
const SCHEMA_DDL = `
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE device (
  model          TEXT,
  model_name     TEXT,
  model_number   TEXT,
  serial         TEXT,
  capacity_gb    INTEGER,
  generation     TEXT,
  dump_date      INTEGER NOT NULL,
  podkit_version TEXT NOT NULL
);

CREATE TABLE tracks (
  dbid           TEXT PRIMARY KEY,
  title          TEXT,
  artist         TEXT,
  album          TEXT,
  album_artist   TEXT,
  composer       TEXT,
  genre          TEXT,
  comment        TEXT,
  grouping       TEXT,
  track_number   INTEGER,
  total_tracks   INTEGER,
  disc_number    INTEGER,
  total_discs    INTEGER,
  year           INTEGER,
  bpm            INTEGER,
  compilation    INTEGER,
  duration_ms    INTEGER,
  bitrate        INTEGER,
  sample_rate    INTEGER,
  size           INTEGER,
  filetype       TEXT,
  media_type     INTEGER,
  rating         INTEGER,
  play_count     INTEGER,
  skip_count     INTEGER,
  time_added     INTEGER,
  time_modified  INTEGER,
  time_played    INTEGER,
  time_released  INTEGER,
  soundcheck     INTEGER,
  tv_show        TEXT,
  tv_episode     TEXT,
  season_number  INTEGER,
  episode_number INTEGER,
  movie_flag     INTEGER,
  has_artwork    INTEGER,
  ipod_path      TEXT,
  exported_path  TEXT,
  dump_path      TEXT
);

CREATE TABLE playlists (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  is_master   INTEGER NOT NULL,
  is_smart    INTEGER NOT NULL,
  is_podcasts INTEGER NOT NULL,
  timestamp   INTEGER,
  match       INTEGER,
  live_update INTEGER,
  check_rules INTEGER,
  check_limits INTEGER,
  limit_type  INTEGER,
  limit_sort  INTEGER,
  limit_value INTEGER,
  match_checked_only INTEGER
);

CREATE TABLE playlist_items (
  playlist_id     TEXT NOT NULL,
  track_dbid      TEXT NOT NULL,
  position        INTEGER NOT NULL,
  added_timestamp INTEGER
);

CREATE TABLE albums (
  album        TEXT,
  album_artist TEXT,
  track_count  INTEGER NOT NULL
);

CREATE TABLE artwork (
  track_dbid TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  format     INTEGER NOT NULL
);

CREATE TABLE smart_playlist_rules (
  playlist_id TEXT NOT NULL,
  rule_index  INTEGER NOT NULL,
  field       INTEGER NOT NULL,
  action      INTEGER NOT NULL,
  string      TEXT,
  from_value  INTEGER,
  to_value    INTEGER,
  from_date   INTEGER,
  to_date     INTEGER,
  from_units  INTEGER,
  to_units    INTEGER
);
`;

/**
 * Flatten a single smart-playlist rule into the column values of one
 * `smart_playlist_rules` row. Numeric operands are stored only when the rule
 * carries them (libgpod leaves the irrelevant operands unset per action), so the
 * original definition reconstructs faithfully. Exported for direct unit testing
 * — it is the one piece of pure logic the smart-rule path hinges on.
 */
export function flattenSmartRule(
  playlistId: bigint,
  ruleIndex: number,
  rule: SPLRule
): {
  playlist_id: string;
  rule_index: number;
  field: number;
  action: number;
  string: string | null;
  from_value: number | null;
  to_value: number | null;
  from_date: number | null;
  to_date: number | null;
  from_units: number | null;
  to_units: number | null;
} {
  return {
    playlist_id: idText(playlistId),
    rule_index: ruleIndex,
    field: rule.field,
    action: rule.action,
    string: rule.string ?? null,
    from_value: rule.fromValue ?? null,
    to_value: rule.toValue ?? null,
    from_date: rule.fromDate ?? null,
    to_date: rule.toDate ?? null,
    from_units: rule.fromUnits ?? null,
    to_units: rule.toUnits ?? null,
  };
}

/**
 * Build `library.sqlite` inside `archiveDir` and return its absolute path.
 *
 * Reads everything from the open libgpod database (it never mutates it) and the
 * accumulated `pathMap` / `artworkIndex`. The file is created fresh (overwriting
 * any prior catalogue) and populated in a single transaction.
 */
export function writeLibraryDb(opts: WriteLibraryDbOptions): string {
  const { db, archiveDir, identity, pathMap, playlists, artworkIndex, dumpDate, podkitVersion } =
    opts;
  const dbPath = join(archiveDir, LIBRARY_DB_FILENAME);

  // Start from a clean file: a prior run's catalogue is fully replaced, never
  // appended to. Removing it first keeps the result a single self-contained
  // file (the default rollback journal is transient and gone after close()).
  rmSync(dbPath, { force: true });

  const sqlite = new SqliteDatabase(dbPath, { create: true });
  try {
    sqlite.exec(SCHEMA_DDL);

    const tracks = readTracks(db);

    const insertAll = sqlite.transaction(() => {
      writeSchemaVersion(sqlite);
      writeDevice(sqlite, identity, dumpDate, podkitVersion);
      writeTracks(sqlite, tracks, pathMap, artworkIndex);
      writeAlbums(sqlite, tracks);
      writePlaylists(sqlite, db, playlists);
    });
    insertAll();

    return dbPath;
  } finally {
    sqlite.close();
  }
}

/** A track plus the resolved `dbid` it is keyed by — read once, reused everywhere. */
function readTracks(db: Database): Track[] {
  return db.getTracks().map((handle) => db.getTrack(handle));
}

function writeSchemaVersion(sqlite: SqliteDatabase): void {
  sqlite.prepare('INSERT INTO schema_version (version) VALUES (?)').run(LIBRARY_DB_SCHEMA_VERSION);
}

function writeDevice(
  sqlite: SqliteDatabase,
  identity: DumpDeviceIdentity,
  dumpDate: number,
  podkitVersion: string
): void {
  sqlite
    .prepare(
      `INSERT INTO device
         (model, model_name, model_number, serial, capacity_gb, generation, dump_date, podkit_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      identity.model ?? null,
      identity.modelName ?? null,
      identity.modelNumber ?? null,
      identity.serialNumber ?? null,
      identity.capacityGb ?? null,
      identity.generation ?? null,
      dumpDate,
      podkitVersion
    );
}

function writeTracks(
  sqlite: SqliteDatabase,
  tracks: Track[],
  pathMap: Map<bigint, TrackPathInfo>,
  artworkIndex: ArtworkDecoder
): void {
  const insertTrack = sqlite.prepare(
    `INSERT INTO tracks (
       dbid, title, artist, album, album_artist, composer, genre, comment, grouping,
       track_number, total_tracks, disc_number, total_discs, year, bpm, compilation,
       duration_ms, bitrate, sample_rate, size, filetype, media_type,
       rating, play_count, skip_count,
       time_added, time_modified, time_played, time_released, soundcheck,
       tv_show, tv_episode, season_number, episode_number, movie_flag,
       has_artwork, ipod_path, exported_path, dump_path
     ) VALUES (
       $dbid, $title, $artist, $album, $albumArtist, $composer, $genre, $comment, $grouping,
       $trackNumber, $totalTracks, $discNumber, $totalDiscs, $year, $bpm, $compilation,
       $duration, $bitrate, $sampleRate, $size, $filetype, $mediaType,
       $rating, $playCount, $skipCount,
       $timeAdded, $timeModified, $timePlayed, $timeReleased, $soundcheck,
       $tvShow, $tvEpisode, $seasonNumber, $episodeNumber, $movieFlag,
       $hasArtwork, $ipodPath, $exportedPath, $dumpPath
     )`
  );

  const insertArtwork = sqlite.prepare(
    'INSERT INTO artwork (track_dbid, width, height, format) VALUES (?, ?, ?, ?)'
  );

  for (const track of tracks) {
    const paths = pathMap.get(track.dbid);
    insertTrack.run({
      $dbid: idText(track.dbid),
      $title: track.title,
      $artist: track.artist,
      $album: track.album,
      $albumArtist: track.albumArtist,
      $composer: track.composer,
      $genre: track.genre,
      $comment: track.comment,
      $grouping: track.grouping,
      $trackNumber: track.trackNumber,
      $totalTracks: track.totalTracks,
      $discNumber: track.discNumber,
      $totalDiscs: track.totalDiscs,
      $year: track.year,
      $bpm: track.bpm,
      $compilation: boolInt(track.compilation),
      $duration: track.duration,
      $bitrate: track.bitrate,
      $sampleRate: track.sampleRate,
      $size: track.size,
      $filetype: track.filetype,
      $mediaType: track.mediaType,
      $rating: track.rating,
      $playCount: track.playCount,
      $skipCount: track.skipCount,
      $timeAdded: track.timeAdded,
      $timeModified: track.timeModified,
      $timePlayed: track.timePlayed,
      $timeReleased: track.timeReleased,
      $soundcheck: track.soundcheck,
      $tvShow: track.tvShow,
      $tvEpisode: track.tvEpisode,
      $seasonNumber: track.seasonNumber,
      $episodeNumber: track.episodeNumber,
      $movieFlag: boolInt(track.movieFlag),
      $hasArtwork: boolInt(track.hasArtwork),
      $ipodPath: track.ipodPath,
      $exportedPath: paths?.exportedPath ?? null,
      $dumpPath: paths?.dumpPath ?? track.ipodPath ?? null,
    });

    const art = artworkIndex.artworkInfo(track.dbid);
    if (art !== null) {
      insertArtwork.run(idText(track.dbid), art.width, art.height, art.formatId);
    }
  }
}

/**
 * Derive the `albums` rollup from the track set. libgpod exposes no album list,
 * so we group by the distinct (album, albumArtist) pair and count tracks. The
 * grouping is keyed on the raw field values (null-safe), and rows are emitted in
 * a stable, sorted order so the catalogue is deterministic.
 */
function writeAlbums(sqlite: SqliteDatabase, tracks: Track[]): void {
  const counts = new Map<string, { album: string | null; albumArtist: string | null; n: number }>();
  for (const track of tracks) {
    // U+001F (unit separator) between the two fields prevents collisions between
    // e.g. (album='A ', albumArtist='B') and (album='A', albumArtist=' B').
    const key = `${track.album ?? ''}${track.albumArtist ?? ''}`;
    const existing = counts.get(key);
    if (existing) {
      existing.n += 1;
    } else {
      counts.set(key, { album: track.album, albumArtist: track.albumArtist, n: 1 });
    }
  }

  const rows = [...counts.values()].sort((a, b) => {
    const byArtist = compareStable(a.albumArtist ?? '', b.albumArtist ?? '');
    if (byArtist !== 0) return byArtist;
    return compareStable(a.album ?? '', b.album ?? '');
  });

  const insertAlbum = sqlite.prepare(
    'INSERT INTO albums (album, album_artist, track_count) VALUES (?, ?, ?)'
  );
  for (const row of rows) {
    insertAlbum.run(row.album, row.albumArtist, row.n);
  }
}

/**
 * Write the `playlists`, `playlist_items` and `smart_playlist_rules` tables.
 *
 * The `playlists` list is read once by the caller and shared with the m3u8
 * playlist writer, so libgpod's playlist list is not re-fetched here.
 *
 * Playlist membership preserves libgpod's order via `getPlaylistTracks`, which
 * returns the tracks in playlist order; each row records its 0-based `position`.
 * Smart playlists also get their rules flattened and their preferences folded
 * into the playlist row.
 */
function writePlaylists(sqlite: SqliteDatabase, db: Database, playlists: Playlist[]): void {
  const insertPlaylist = sqlite.prepare(
    `INSERT INTO playlists (
       id, name, is_master, is_smart, is_podcasts, timestamp,
       match, live_update, check_rules, check_limits, limit_type, limit_sort, limit_value, match_checked_only
     ) VALUES (
       $id, $name, $isMaster, $isSmart, $isPodcasts, $timestamp,
       $match, $liveUpdate, $checkRules, $checkLimits, $limitType, $limitSort, $limitValue, $matchCheckedOnly
     )`
  );
  const insertItem = sqlite.prepare(
    'INSERT INTO playlist_items (playlist_id, track_dbid, position, added_timestamp) VALUES (?, ?, ?, ?)'
  );
  const insertRule = sqlite.prepare(
    `INSERT INTO smart_playlist_rules
       (playlist_id, rule_index, field, action, string, from_value, to_value, from_date, to_date, from_units, to_units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const playlist of playlists) {
    const prefs = playlist.isSmart ? safeReadPreferences(db, playlist.id) : null;

    insertPlaylist.run({
      $id: idText(playlist.id),
      $name: playlist.name,
      $isMaster: boolInt(playlist.isMaster),
      $isSmart: boolInt(playlist.isSmart),
      $isPodcasts: boolInt(playlist.isPodcasts),
      $timestamp: playlist.timestamp,
      // libgpod's read path (`getPlaylists`) returns plain rows without the
      // smart `match` operator; the flattened rules are the durable predicate
      // definition. Kept as a nullable column for a future read API.
      $match: null,
      $liveUpdate: prefBoolInt(prefs?.liveUpdate),
      $checkRules: prefBoolInt(prefs?.checkRules),
      $checkLimits: prefBoolInt(prefs?.checkLimits),
      $limitType: prefs?.limitType ?? null,
      $limitSort: prefs?.limitSort ?? null,
      $limitValue: prefs?.limitValue ?? null,
      $matchCheckedOnly: prefBoolInt(prefs?.matchCheckedOnly),
    });

    // Ordered membership — `getPlaylistTracks` preserves playlist order. libgpod
    // does not expose a per-item add timestamp, so `added_timestamp` is null.
    const handles = db.getPlaylistTracks(playlist.id);
    let position = 0;
    for (const handle of handles) {
      const track = db.getTrack(handle);
      insertItem.run(idText(playlist.id), idText(track.dbid), position, null);
      position += 1;
    }

    if (playlist.isSmart) {
      const rules = safeReadRules(db, playlist.id);
      rules.forEach((rule, index) => {
        const r = flattenSmartRule(playlist.id, index, rule);
        insertRule.run(
          r.playlist_id,
          r.rule_index,
          r.field,
          r.action,
          r.string,
          r.from_value,
          r.to_value,
          r.from_date,
          r.to_date,
          r.from_units,
          r.to_units
        );
      });
    }
  }
}

/** Encode an optional preference boolean as 0/1, or null when unset. */
function prefBoolInt(value: boolean | undefined): 0 | 1 | null {
  if (value === undefined) return null;
  return boolInt(value);
}

/** Read smart-playlist preferences, degrading to null on any libgpod error. */
function safeReadPreferences(db: Database, playlistId: bigint): SPLPreferences | null {
  try {
    return db.getSmartPlaylistPreferences(playlistId);
  } catch {
    return null;
  }
}

/** Read smart-playlist rules, degrading to an empty list on any libgpod error. */
function safeReadRules(db: Database, playlistId: bigint): SPLRule[] {
  try {
    return db.getSmartPlaylistRules(playlistId);
  } catch {
    return [];
  }
}
