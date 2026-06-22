/**
 * ArchivePathPlanner — maps an iPod track to its archive-relative file path.
 *
 * This is the deep, pure module at the heart of the transform: given a track's
 * metadata it decides where the extracted audio file lands inside the archive
 * tree. It performs no IO, so the entire policy (layout, sanitisation, length
 * caps, collision handling, Unknown fallbacks) is exhaustively unit-testable.
 *
 * Routing is by media type, producing these trees:
 *
 *   Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>   (plain audio)
 *   Music/Compilations/<Album>/<NN> <Title>.<ext>    (compilation flag)
 *   Podcasts/<Show>/<Title>.<ext>
 *   Audiobooks/<Author>/<Title>.<ext>
 *   Video/Movies/<Title>.<ext>
 *   Video/Music Videos/<Title>.<ext>
 *   Video/TV Shows/<Show>/Season <NN>/<EE> <Title>.<ext>
 *
 * @module
 */

import { posix } from 'node:path';
import { MediaType, type Track } from '@podkit/libgpod-node';
import { sanitizePathSegment } from './sanitize.js';
import { ipodPathBasename, ipodPathExtension, ipodPathToRelativeSegments } from './ipod-path.js';

/** Top-level archive directory the music layout lives under. */
export const MUSIC_SUBDIR = 'Music';
/** Sub-tree under {@link MUSIC_SUBDIR} grouping compilation albums by album. */
export const COMPILATIONS_SUBDIR = 'Compilations';
/** Top-level archive directory podcasts live under. */
export const PODCASTS_SUBDIR = 'Podcasts';
/** Top-level archive directory audiobooks live under. */
export const AUDIOBOOKS_SUBDIR = 'Audiobooks';
/** Top-level archive directory all video media lives under. */
export const VIDEO_SUBDIR = 'Video';
/** Sub-tree under {@link VIDEO_SUBDIR} for feature-length movies. */
export const MOVIES_SUBDIR = 'Movies';
/** Sub-tree under {@link VIDEO_SUBDIR} for music videos. */
export const MUSIC_VIDEOS_SUBDIR = 'Music Videos';
/** Sub-tree under {@link VIDEO_SUBDIR} for TV show episodes. */
export const TV_SHOWS_SUBDIR = 'TV Shows';

const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ALBUM = 'Unknown Album';
const UNKNOWN_TITLE = 'Unknown Title';
const UNKNOWN_PODCAST = 'Unknown Podcast';
const UNKNOWN_AUTHOR = 'Unknown Author';
const UNKNOWN_SHOW = 'Unknown Show';

/**
 * Collision-tracking state threaded through repeated `planPath` calls.
 *
 * The planner is otherwise stateless; this Set records the archive-relative
 * paths it has already handed out so a second track that would map to the same
 * path gets a deterministic `dbid`-suffixed variant instead of silently
 * overwriting the first. Callers create one of these per `runTransform` and
 * pass the same instance to every `planPath` call.
 */
export type CollisionState = Set<string>;

/** Construct a fresh, empty collision tracker. */
export function createCollisionState(): CollisionState {
  return new Set<string>();
}

/**
 * Subset of `Track` fields the planner reads. Declaring it explicitly (rather
 * than taking the whole `Track`) keeps the planner's contract narrow and its
 * unit tests free of constructing a full libgpod `Track`.
 */
export interface PlannerTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNumber: number;
  dbid: bigint;
  ipodPath: string | null;
  /** libgpod media-type bitflags (see {@link MediaType}). Test with bitwise AND. */
  mediaType: number;
  /** Whether the track is part of a compilation. */
  compilation: boolean;
  /** TV show name (for TV show episodes). */
  tvShow: string | null;
  /** Season number, or 0 when unset. */
  seasonNumber: number;
  /** Episode number, or 0 when unset. */
  episodeNumber: number;
  /** Whether libgpod flags this track as a movie. */
  movieFlag: boolean;
}

/**
 * The kind of media a track is, after collapsing the libgpod bitflags into a
 * single discriminated tag. Used to route the track into the right tree.
 *
 * Precedence (checked in this order by {@link classifyMediaType}, most specific
 * first): TV show → movie → music video → podcast → audiobook → compilation →
 * plain music. The non-music media types are exclusive enough in practice that
 * the order only matters for malformed tracks with several flags set; this
 * order resolves those deterministically (e.g. a track flagged both TVShow and
 * Movie is treated as a TV show).
 */
export type MediaKind =
  | 'music'
  | 'compilation'
  | 'podcast'
  | 'audiobook'
  | 'movie'
  | 'musicVideo'
  | 'tvShow';

/** True when `mediaType` has the given {@link MediaType} flag bit set. */
function hasMediaFlag(mediaType: number, flag: number): boolean {
  return (mediaType & flag) !== 0;
}

/**
 * Classify a track into a single {@link MediaKind} from its libgpod media-type
 * bitflags plus the `compilation`/`movieFlag` booleans. `mediaType` is a
 * bitflag field, so every check is a bitwise AND, not an equality test.
 *
 * See {@link MediaKind} for the precedence order and why it is ordered this way.
 */
export function classifyMediaType(track: PlannerTrack): MediaKind {
  const mt = track.mediaType;
  if (hasMediaFlag(mt, MediaType.TVShow)) return 'tvShow';
  if (track.movieFlag || hasMediaFlag(mt, MediaType.Movie)) return 'movie';
  if (hasMediaFlag(mt, MediaType.MusicVideo)) return 'musicVideo';
  if (hasMediaFlag(mt, MediaType.Podcast)) return 'podcast';
  if (hasMediaFlag(mt, MediaType.Audiobook)) return 'audiobook';
  if (track.compilation) return 'compilation';
  return 'music';
}

/** Zero-pad a positive integer to at least two digits, or `null` when ≤ 0. */
function formatTwoDigits(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return String(Math.trunc(value)).padStart(2, '0');
}

/**
 * Sanitise the first candidate that survives sanitisation, in order, falling
 * back to `fallback` when every candidate is empty or sanitises away to nothing
 * (e.g. a title that was entirely reserved characters). The fallback is itself
 * sanitised so it is always a safe segment.
 */
function segmentOr(candidates: Array<string | null>, fallback: string): string {
  for (const candidate of candidates) {
    const sanitized = candidate ? sanitizePathSegment(candidate) : '';
    if (sanitized) return sanitized;
  }
  return sanitizePathSegment(fallback);
}

/**
 * Resolve a track's title segment, falling back to the source basename and then
 * a constant — so a track with neither a usable title nor basename still gets a
 * stable name.
 */
function titleSegment(track: PlannerTrack): string {
  return segmentOr([track.title, ipodPathBasename(track.ipodPath)], UNKNOWN_TITLE);
}

/**
 * Compute the directory and file-stem (filename without extension) for a track,
 * routed by its {@link MediaKind}. The caller appends the extension and handles
 * collisions; this keeps the per-kind layout policy in one readable place.
 */
function planDirAndStem(track: PlannerTrack): { dir: string; stem: string } {
  const title = titleSegment(track);

  switch (classifyMediaType(track)) {
    case 'compilation': {
      // Compilations group by album only; the album-artist is not in the path.
      const album = segmentOr([track.album], UNKNOWN_ALBUM);
      const nn = formatTwoDigits(track.trackNumber);
      return {
        dir: posix.join(MUSIC_SUBDIR, COMPILATIONS_SUBDIR, album),
        stem: nn ? `${nn} ${title}` : title,
      };
    }

    case 'podcast': {
      // Podcasts store the show name in the album field; fall back to artist.
      const show = segmentOr([track.album, track.artist], UNKNOWN_PODCAST);
      return { dir: posix.join(PODCASTS_SUBDIR, show), stem: title };
    }

    case 'audiobook': {
      const author = segmentOr([track.albumArtist, track.artist], UNKNOWN_AUTHOR);
      return { dir: posix.join(AUDIOBOOKS_SUBDIR, author), stem: title };
    }

    case 'movie':
      return { dir: posix.join(VIDEO_SUBDIR, MOVIES_SUBDIR), stem: title };

    case 'musicVideo':
      return { dir: posix.join(VIDEO_SUBDIR, MUSIC_VIDEOS_SUBDIR), stem: title };

    case 'tvShow': {
      const show = segmentOr([track.tvShow, track.album], UNKNOWN_SHOW);
      const season = formatTwoDigits(track.seasonNumber);
      // Season directory is omitted gracefully when no season number is set.
      const dir = season
        ? posix.join(VIDEO_SUBDIR, TV_SHOWS_SUBDIR, show, `Season ${season}`)
        : posix.join(VIDEO_SUBDIR, TV_SHOWS_SUBDIR, show);
      // Episode prefix falls back to the track number, and is omitted when
      // neither is present.
      const ee = formatTwoDigits(track.episodeNumber) ?? formatTwoDigits(track.trackNumber);
      return { dir, stem: ee ? `${ee} ${title}` : title };
    }

    case 'music':
    default: {
      const albumArtist = segmentOr([track.albumArtist, track.artist], UNKNOWN_ARTIST);
      const album = segmentOr([track.album], UNKNOWN_ALBUM);
      const nn = formatTwoDigits(track.trackNumber);
      return {
        dir: posix.join(MUSIC_SUBDIR, albumArtist, album),
        stem: nn ? `${nn} ${title}` : title,
      };
    }
  }
}

/**
 * Plan the archive-relative path for a track, or `null` when the track has no
 * audio body to extract (null/empty `ipodPath`).
 *
 * The returned path uses POSIX separators (it is a relative path joined onto
 * the archive root by the caller). Routing is by media type (see
 * {@link classifyMediaType}). On a collision with a previously-planned path,
 * the track's `dbid` is appended before the extension (` [<dbid>]`), which is
 * unique per track and therefore deterministic regardless of order.
 *
 * @param track - the metadata fields the planner reads.
 * @param collisionState - shared collision tracker (see {@link CollisionState}).
 */
export function planPath(track: PlannerTrack, collisionState: CollisionState): string | null {
  // No source file → not a path-planning failure; the caller buckets it as
  // "no audio". Return null rather than throwing. A path with no real segments
  // (empty or colon-only) is treated the same as a null path.
  if (ipodPathToRelativeSegments(track.ipodPath) === null) return null;

  const ext = ipodPathExtension(track.ipodPath);
  const { dir, stem } = planDirAndStem(track);
  const relPath = posix.join(dir, `${stem}${ext}`);

  // Deterministic collision resolution: append the dbid before the extension.
  // In the rare case where that *also* collides (a different track's plain
  // title happened to equal this stem-plus-dbid), keep appending a counter
  // until the path is free, so two tracks never map to the same destination.
  let finalPath = relPath;
  if (collisionState.has(finalPath)) {
    finalPath = posix.join(dir, `${stem} [${track.dbid}]${ext}`);
    let n = 2;
    while (collisionState.has(finalPath)) {
      finalPath = posix.join(dir, `${stem} [${track.dbid}] (${n})${ext}`);
      n += 1;
    }
  }

  collisionState.add(finalPath);
  return finalPath;
}

/**
 * Narrow a full libgpod `Track` to the {@link PlannerTrack} fields. Lets the
 * orchestrator pass libgpod tracks straight in without leaking the wider
 * `Track` surface into the planner's contract.
 */
export function toPlannerTrack(track: Track): PlannerTrack {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    trackNumber: track.trackNumber,
    dbid: track.dbid,
    ipodPath: track.ipodPath,
    mediaType: track.mediaType,
    compilation: track.compilation,
    tvShow: track.tvShow,
    seasonNumber: track.seasonNumber,
    episodeNumber: track.episodeNumber,
    movieFlag: track.movieFlag,
  };
}
