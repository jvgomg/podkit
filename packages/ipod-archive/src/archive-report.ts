/**
 * ArchiveReport + README — the human- and machine-readable paper trail.
 *
 * An iPod archive run is **non-interactive**: it never prompts, it never
 * negotiates. So the only way a user learns what was and wasn't archived is
 * after the fact, from the files this module writes:
 *
 * - `report.md` / `report.json` — every skip and failure across both stages,
 *   grouped into buckets (stage 1: foreign files, dump failures; stage 2:
 *   tracks with no audio, tracks with no artwork, transform/playlist failures).
 *   The markdown is for a human glancing at a shelf of dumps; the JSON is the
 *   full, untruncated structure for tooling.
 * - `README.md` — a one-screen identity card for the archive: what the device
 *   was (model, serial, capacity, generation), when it was dumped, the podkit
 *   version, and a few library stats so a dump is identifiable at a glance.
 *
 * The render methods are **pure and deterministic**: no IO, sorted lists, and a
 * caller-injected clock for the dump date. Long lists are truncated in the
 * markdown (with an "...and N more" note) but never in the JSON. The accumulator
 * collects buckets across both orchestrator stages; the transform threads the
 * stage-1 buckets in when both stages run in one invocation, and marks the
 * stage-1 section "not available" for a standalone `--from-dump` transform.
 *
 * Leaf module: no `@podkit/core`, no `console`/stderr — it returns strings.
 *
 * @module
 */

import type { Track } from '@podkit/libgpod-node';
import type { DumpDeviceIdentity } from './dump-loader.js';

/** Maximum entries listed per bucket in `report.md` before truncation kicks in. */
export const REPORT_MARKDOWN_LIST_CAP = 50;

/** Number of top artists surfaced in the README's library stats. */
export const README_TOP_ARTISTS = 10;

/** Number of most-played tracks surfaced in the README's listening stats. */
export const README_TOP_PLAYED_TRACKS = 10;

/** Number of most-played artists surfaced in the README's listening stats. */
export const README_TOP_PLAYED_ARTISTS = 5;

/** Number of most-skipped tracks surfaced in the README's listening stats. */
export const README_TOP_SKIPPED_TRACKS = 10;

/** Number of most-skipped artists surfaced in the README's listening stats. */
export const README_TOP_SKIPPED_ARTISTS = 6;

// ── Bucket shapes ────────────────────────────────────────────────────────────

/** A stage-1 file that failed to copy (path + reason). */
export interface ReportDumpFailure {
  /** Source-relative path of the entry that failed. */
  path: string;
  /** Human-readable failure reason. */
  error: string;
}

/** A stage-2 track that produced no archive entry, or whose extraction failed. */
export interface ReportTrackSkip {
  /** Database id of the track (decimal string — stable, JSON-safe for 64-bit). */
  dbid: string;
  /** Best-effort track title for the report, or null. */
  title: string | null;
}

/** A stage-2 track extraction failure (track + planned path + reason). */
export interface ReportTransformFailure {
  /** Database id of the track (decimal string). */
  dbid: string;
  /** Best-effort track title for the report, or null. */
  title: string | null;
  /** Planned archive-relative destination path. */
  relPath: string;
  /** Human-readable failure reason. */
  error: string;
}

/** A stage-2 playlist whose `.m3u8` write failed. */
export interface ReportPlaylistFailure {
  /** Best-effort playlist name, or null. */
  name: string | null;
  /** Archive-relative destination that failed to write. */
  relPath: string;
  /** Human-readable failure reason. */
  error: string;
}

/**
 * The stage-1 buckets, threaded into the report when the dump stage ran in the
 * same invocation. `null` means the report was produced by a standalone
 * transform (`--from-dump`) that never saw the dump stage, so stage-1
 * information is genuinely unavailable — distinct from "ran, found nothing".
 */
export interface ReportStage1 {
  /** User-added files skipped (not copied) — volume-relative names/paths. */
  foreignSkipped: string[];
  /** Files that could not be copied during the dump. */
  dumpFailures: ReportDumpFailure[];
}

/** The stage-2 buckets, always present once the transform has run. */
export interface ReportStage2 {
  /** Tracks with no audio body (null/empty `ipodPath`). */
  noAudio: ReportTrackSkip[];
  /** Tracks extracted but carrying no decodable album artwork. */
  noArtwork: ReportTrackSkip[];
  /** Tracks whose audio was missing or whose extraction (copy) failed. */
  transformFailures: ReportTransformFailure[];
  /**
   * Tracks extracted into the archive but whose tags could not be written by
   * either taglib or ffmpeg. The audio is present and playable with its original
   * on-device tags — a tagging warning, not a lost track.
   */
  tagFailures: ReportTransformFailure[];
  /** Playlists whose `.m3u8` write failed. */
  playlistFailures: ReportPlaylistFailure[];
}

/**
 * Listening statistics for `report.json` — the machine-readable counterpart of
 * the README's listening section. A projection of {@link LibraryStats} carrying
 * the totals and the four ranked lists (see {@link listeningStatsFrom}).
 */
export interface ReportListeningStats {
  /** Sum of every track's play count. */
  totalPlayCount: number;
  /** Sum of every track's skip count. */
  totalSkipCount: number;
  /** Most-played tracks (descending), zero-play tracks excluded. */
  topPlayedTracks: TrackListenStat[];
  /** Most-played artists by summed play count (descending). */
  topPlayedArtists: ArtistListenStat[];
  /** Most-skipped tracks (descending), zero-skip tracks excluded. */
  topSkippedTracks: TrackListenStat[];
  /** Most-skipped artists by summed skip count (descending). */
  topSkippedArtists: ArtistListenStat[];
}

/** The full machine-readable report structure (`report.json`). */
export interface ReportJson {
  /**
   * Stage-1 buckets, or `null` when the report was produced by a standalone
   * transform that never ran the dump stage.
   */
  stage1: ReportStage1 | null;
  /** Stage-2 buckets. `null` only for a dump-only run (no transform ran). */
  stage2: ReportStage2 | null;
  /**
   * Listening stats derived from the library, or `null` when unavailable (a
   * dump-only run computes no library stats).
   */
  listening: ReportListeningStats | null;
}

// ── Library stats (README) ───────────────────────────────────────────────────

/** A single (artist, track-count) pair in the README's top-artists list. */
export interface ArtistTrackCount {
  /** Artist name (display value; `Unknown Artist` when absent on every track). */
  artist: string;
  /** Number of tracks attributed to this artist. */
  trackCount: number;
}

/**
 * A track in a listening-stats ranking (most played / most skipped). `count` is
 * the play or skip count depending on which list the entry belongs to.
 */
export interface TrackListenStat {
  /** Display title (`Untitled` when the track carries no title). */
  title: string;
  /** Display artist (`Unknown Artist` when the track carries no artist). */
  artist: string;
  /** Play or skip count for this track (always > 0 — zero-count tracks are excluded). */
  count: number;
}

/**
 * An artist in a listening-stats ranking (most played / most skipped). `count`
 * is the summed play or skip count across all of that artist's tracks.
 */
export interface ArtistListenStat {
  /** Display artist (`Unknown Artist` when absent on every track). */
  artist: string;
  /** Summed play or skip count across this artist's tracks (always > 0). */
  count: number;
}

/**
 * Aggregate library statistics derived from a dump's track set. Pure projection
 * of the libgpod track fields — every value is computed, none read from IO.
 */
export interface LibraryStats {
  /** Total number of tracks in the catalogue. */
  totalTracks: number;
  /** Sum of every track's `size` in bytes. */
  totalSizeBytes: number;
  /** Sum of every track's `duration` in milliseconds. */
  totalDurationMs: number;
  /** Count of distinct non-empty artist names. */
  distinctArtists: number;
  /** Count of distinct non-empty album names. */
  distinctAlbums: number;
  /**
   * Earliest `timeAdded` across all tracks (Unix seconds), or `null` when no
   * track carries a positive `timeAdded`.
   */
  earliestAdded: number | null;
  /** Latest `timeAdded` across all tracks (Unix seconds), or `null`. */
  latestAdded: number | null;
  /**
   * Top artists by track count (descending), capped at {@link README_TOP_ARTISTS}.
   * Ties break alphabetically by artist name so the list is deterministic.
   */
  topArtists: ArtistTrackCount[];
  /** Sum of every track's `playCount`. */
  totalPlayCount: number;
  /** Sum of every track's `skipCount`. */
  totalSkipCount: number;
  /**
   * Most-played tracks (descending play count), capped at
   * {@link README_TOP_PLAYED_TRACKS}. Tracks never played are excluded. Ties
   * break by title then artist so the list is deterministic.
   */
  topPlayedTracks: TrackListenStat[];
  /**
   * Most-played artists by summed play count (descending), capped at
   * {@link README_TOP_PLAYED_ARTISTS}. Artists with zero total plays are
   * excluded. Ties break alphabetically by artist name.
   */
  topPlayedArtists: ArtistListenStat[];
  /**
   * Most-skipped tracks (descending skip count), capped at
   * {@link README_TOP_SKIPPED_TRACKS}. Tracks never skipped are excluded. Ties
   * break by title then artist.
   */
  topSkippedTracks: TrackListenStat[];
  /**
   * Most-skipped artists by summed skip count (descending), capped at
   * {@link README_TOP_SKIPPED_ARTISTS}. Artists with zero total skips are
   * excluded. Ties break alphabetically by artist name.
   */
  topSkippedArtists: ArtistListenStat[];
}

/** Display fallback for a track with no artist. */
const UNKNOWN_ARTIST = 'Unknown Artist';

/** Display fallback for a track with no title. */
const UNTITLED = 'Untitled';

/**
 * Stable, locale-independent string order by UTF-16 code point. Used for every
 * sort key in this module so output is byte-identical on any host (a localised
 * `String.prototype.localeCompare` could reorder names on a non-en CI). The
 * keys here are file paths and ASCII-heavy metadata, so a code-point order reads
 * naturally without needing collation.
 */
export function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compute {@link LibraryStats} from a dump's track set. Pure and deterministic:
 * the same tracks always yield the same stats, with ties resolved alphabetically.
 *
 * Distinct artist/album counts ignore null and whitespace-only values (those are
 * not real names). The top-artists rollup, by contrast, buckets nameless tracks
 * under `Unknown Artist` so the list still accounts for every track.
 */
export function computeLibraryStats(tracks: readonly Track[]): LibraryStats {
  let totalSizeBytes = 0;
  let totalDurationMs = 0;
  let earliestAdded: number | null = null;
  let latestAdded: number | null = null;
  let totalPlayCount = 0;
  let totalSkipCount = 0;

  const distinctArtistSet = new Set<string>();
  const distinctAlbumSet = new Set<string>();
  const artistCounts = new Map<string, number>();
  const artistPlayCounts = new Map<string, number>();
  const artistSkipCounts = new Map<string, number>();
  const playedTracks: TrackListenStat[] = [];
  const skippedTracks: TrackListenStat[] = [];

  for (const track of tracks) {
    totalSizeBytes += track.size > 0 ? track.size : 0;
    totalDurationMs += track.duration > 0 ? track.duration : 0;

    if (track.timeAdded > 0) {
      if (earliestAdded === null || track.timeAdded < earliestAdded)
        earliestAdded = track.timeAdded;
      if (latestAdded === null || track.timeAdded > latestAdded) latestAdded = track.timeAdded;
    }

    const artist = track.artist?.trim();
    if (artist) distinctArtistSet.add(artist);
    const album = track.album?.trim();
    if (album) distinctAlbumSet.add(album);

    // Top-artists rollup counts every track, falling back to a display name so
    // nameless tracks are not silently dropped from the rollup.
    const rollupArtist = artist || UNKNOWN_ARTIST;
    artistCounts.set(rollupArtist, (artistCounts.get(rollupArtist) ?? 0) + 1);

    // Listening stats. Only positive counts contribute to a ranking — a track
    // never played (or skipped) is not "top" anything, so it's excluded from the
    // per-track lists and the per-artist rollups alike.
    const displayTitle = track.title?.trim() || UNTITLED;
    const plays = track.playCount > 0 ? track.playCount : 0;
    const skips = track.skipCount > 0 ? track.skipCount : 0;
    totalPlayCount += plays;
    totalSkipCount += skips;
    if (plays > 0) {
      playedTracks.push({ title: displayTitle, artist: rollupArtist, count: plays });
      artistPlayCounts.set(rollupArtist, (artistPlayCounts.get(rollupArtist) ?? 0) + plays);
    }
    if (skips > 0) {
      skippedTracks.push({ title: displayTitle, artist: rollupArtist, count: skips });
      artistSkipCounts.set(rollupArtist, (artistSkipCounts.get(rollupArtist) ?? 0) + skips);
    }
  }

  const topArtists = [...artistCounts.entries()]
    .map(([artist, trackCount]) => ({ artist, trackCount }))
    .sort((a, b) => {
      if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount;
      return compareStable(a.artist, b.artist);
    })
    .slice(0, README_TOP_ARTISTS);

  return {
    totalTracks: tracks.length,
    totalSizeBytes,
    totalDurationMs,
    distinctArtists: distinctArtistSet.size,
    distinctAlbums: distinctAlbumSet.size,
    earliestAdded,
    latestAdded,
    topArtists,
    totalPlayCount,
    totalSkipCount,
    topPlayedTracks: rankTracks(playedTracks, README_TOP_PLAYED_TRACKS),
    topPlayedArtists: rankArtists(artistPlayCounts, README_TOP_PLAYED_ARTISTS),
    topSkippedTracks: rankTracks(skippedTracks, README_TOP_SKIPPED_TRACKS),
    topSkippedArtists: rankArtists(artistSkipCounts, README_TOP_SKIPPED_ARTISTS),
  };
}

/**
 * Project the listening subset of {@link LibraryStats} into the report's shape.
 * The README renders these from `LibraryStats` directly; `report.json` carries
 * this narrower projection so tooling gets the same numbers without the
 * library-wide totals.
 */
export function listeningStatsFrom(stats: LibraryStats): ReportListeningStats {
  return {
    totalPlayCount: stats.totalPlayCount,
    totalSkipCount: stats.totalSkipCount,
    topPlayedTracks: stats.topPlayedTracks,
    topPlayedArtists: stats.topPlayedArtists,
    topSkippedTracks: stats.topSkippedTracks,
    topSkippedArtists: stats.topSkippedArtists,
  };
}

/**
 * Rank listening-stat tracks by count (descending), capped at `limit`. Ties
 * break by title then artist so the ordering is deterministic across hosts.
 */
function rankTracks(tracks: readonly TrackListenStat[], limit: number): TrackListenStat[] {
  return [...tracks]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const byTitle = compareStable(a.title, b.title);
      return byTitle !== 0 ? byTitle : compareStable(a.artist, b.artist);
    })
    .slice(0, limit);
}

/**
 * Rank summed per-artist listening counts (descending), capped at `limit`. Ties
 * break alphabetically by artist name.
 */
function rankArtists(counts: ReadonlyMap<string, number>, limit: number): ArtistListenStat[] {
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return compareStable(a.artist, b.artist);
    })
    .slice(0, limit);
}

// ── Human-readable formatting helpers ─────────────────────────────────────────

/** Binary (IEC) units, so a "GB" here matches the capacity figures iPods quote. */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Format a byte count as a human-readable size using binary (1024) steps.
 * Deterministic: fixed to two decimals above bytes, no locale dependence.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} ${SIZE_UNITS[unit]}`;
  return `${value.toFixed(2)} ${SIZE_UNITS[unit]}`;
}

/**
 * Format a millisecond duration as `Dd HHh MMm SSs`, dropping leading zero
 * units. Deterministic and locale-free.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || parts.length > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Format a Unix-seconds timestamp as a stable `YYYY-MM-DD` UTC date, or `—`
 * when null. UTC + ISO slice keeps the README byte-stable across machines.
 */
function formatDate(unixSeconds: number | null): string {
  if (unixSeconds === null) return '—';
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Format a full Unix-seconds timestamp as an ISO-8601 UTC instant. */
function formatInstant(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

// ── README rendering ─────────────────────────────────────────────────────────

/** Inputs to {@link renderReadme}. */
export interface RenderReadmeOptions {
  /** Best-effort device identity resolved from the dump. */
  identity: DumpDeviceIdentity;
  /** Wall-clock the dump was taken at (Unix seconds). */
  dumpDate: number;
  /** podkit version string recorded in the archive. */
  podkitVersion: string;
  /** Pre-computed library statistics (see {@link computeLibraryStats}). */
  stats: LibraryStats;
}

/** Render a single `| Field | Value |` markdown table row. */
function row(field: string, value: string): string {
  return `| ${field} | ${value} |`;
}

/** Coalesce an optional identity string to a dash placeholder. */
function orDash(value: string | undefined): string {
  return value && value.trim() ? value : '—';
}

/**
 * Render the archive's `README.md`: a device identity card plus library stats.
 *
 * Every identity field degrades to `—` when absent (a stock/dying iPod may lack
 * `SysInfoExtended` entirely, so serial and family are frequently missing). Pure
 * and deterministic — the only time source is the injected `dumpDate`.
 */
export function renderReadme(opts: RenderReadmeOptions): string {
  const { identity, dumpDate, podkitVersion, stats } = opts;

  const lines: string[] = [];
  lines.push('# iPod Archive');
  lines.push('');
  lines.push('A self-contained archive of an iPod, produced by `podkit device archive`.');
  lines.push('');

  lines.push('## Device');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(row('Name', orDash(identity.name)));
  lines.push(row('Model', orDash(identity.modelName ?? identity.model)));
  lines.push(row('Model number', orDash(identity.modelNumber)));
  // Colour only appears when a variant-level model resolved it — it's redundant
  // for generation-only identity and would just add a dash row.
  if (identity.color) lines.push(row('Colour', identity.color));
  lines.push(row('Serial', orDash(identity.serialNumber)));
  lines.push(row('Generation', orDash(identity.generation)));
  lines.push(
    row('Capacity', identity.capacityGb !== undefined ? `${identity.capacityGb} GB` : '—')
  );
  lines.push('');

  lines.push('## Archive');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(row('Dump date', formatInstant(dumpDate)));
  lines.push(row('podkit version', podkitVersion));
  lines.push('');

  lines.push('## Library');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(row('Tracks', String(stats.totalTracks)));
  lines.push(row('Total size', formatBytes(stats.totalSizeBytes)));
  lines.push(row('Total play time', formatDuration(stats.totalDurationMs)));
  lines.push(row('Distinct artists', String(stats.distinctArtists)));
  lines.push(row('Distinct albums', String(stats.distinctAlbums)));
  lines.push(
    row('Date added range', `${formatDate(stats.earliestAdded)} – ${formatDate(stats.latestAdded)}`)
  );
  lines.push(row('Total plays', String(stats.totalPlayCount)));
  lines.push(row('Total skips', String(stats.totalSkipCount)));
  lines.push('');

  if (stats.topArtists.length > 0) {
    lines.push('### Top artists');
    lines.push('');
    for (const { artist, trackCount } of stats.topArtists) {
      lines.push(`- ${artist} (${trackCount})`);
    }
    lines.push('');
  }

  // Listening stats. Each section renders only when it has entries, so a device
  // with no play/skip history (or firmware that never recorded it) stays clean.
  renderListenTracks(lines, 'Top played tracks', stats.topPlayedTracks, 'play');
  renderListenArtists(lines, 'Top played artists', stats.topPlayedArtists, 'play');
  renderListenTracks(lines, 'Top skipped tracks', stats.topSkippedTracks, 'skip');
  renderListenArtists(lines, 'Top skipped artists', stats.topSkippedArtists, 'skip');

  return lines.join('\n');
}

/** Pluralise a listening-stat count, e.g. `1 play` / `40 plays` / `17 skips`. */
function formatListenCount(count: number, noun: 'play' | 'skip'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Append a `### <heading>` section listing ranked tracks, or nothing when empty. */
function renderListenTracks(
  lines: string[],
  heading: string,
  items: readonly TrackListenStat[],
  noun: 'play' | 'skip'
): void {
  if (items.length === 0) return;
  lines.push(`### ${heading}`);
  lines.push('');
  for (const { title, artist, count } of items) {
    lines.push(`- ${title} — ${artist} (${formatListenCount(count, noun)})`);
  }
  lines.push('');
}

/** Append a `### <heading>` section listing ranked artists, or nothing when empty. */
function renderListenArtists(
  lines: string[],
  heading: string,
  items: readonly ArtistListenStat[],
  noun: 'play' | 'skip'
): void {
  if (items.length === 0) return;
  lines.push(`### ${heading}`);
  lines.push('');
  for (const { artist, count } of items) {
    lines.push(`- ${artist} (${formatListenCount(count, noun)})`);
  }
  lines.push('');
}

// ── ArchiveReport accumulator + renderer ──────────────────────────────────────

/**
 * Accumulates skip/failure buckets across both archive stages and renders them
 * as `report.md` (human, truncated) and `report.json` (machine, complete).
 *
 * Construct with the stage-2 buckets the transform produced. Stage-1 buckets are
 * folded in via {@link withStage1} when both stages ran in one invocation; left
 * absent for a standalone `--from-dump` transform (the markdown then marks the
 * stage-1 section "not available"). A dump-only run constructs the report with
 * {@link forDumpOnly}, which carries stage-1 buckets and no stage-2 section.
 */
export class ArchiveReport {
  private constructor(
    private readonly stage1: ReportStage1 | null,
    private readonly stage2: ReportStage2 | null,
    private readonly listening: ReportListeningStats | null = null
  ) {}

  /** Build a transform-stage report from the stage-2 buckets (stage-1 absent). */
  static forTransform(stage2: ReportStage2): ArchiveReport {
    return new ArchiveReport(null, normalizeStage2(stage2));
  }

  /** Build a dump-only report carrying just the stage-1 buckets. */
  static forDumpOnly(stage1: ReportStage1): ArchiveReport {
    return new ArchiveReport(normalizeStage1(stage1), null);
  }

  /**
   * Return a copy of this report with stage-1 buckets folded in — used when the
   * default run threads stage-1's classification/failures into the transform.
   */
  withStage1(stage1: ReportStage1): ArchiveReport {
    return new ArchiveReport(normalizeStage1(stage1), this.stage2, this.listening);
  }

  /**
   * Return a copy of this report carrying listening stats — the machine-readable
   * counterpart of the README's listening section (see {@link listeningStatsFrom}).
   */
  withListening(listening: ReportListeningStats): ArchiveReport {
    return new ArchiveReport(this.stage1, this.stage2, listening);
  }

  /** The full, untruncated machine-readable structure. */
  toJson(): ReportJson {
    return { stage1: this.stage1, stage2: this.stage2, listening: this.listening };
  }

  /**
   * Render the human-readable `report.md`. Buckets are grouped under headings
   * with counts; long lists are truncated with an "...and N more" note (the
   * JSON keeps the full list). When a section produced nothing, it renders a
   * clean "Nothing skipped / no failures" line rather than an empty list.
   */
  renderMarkdown(): string {
    const lines: string[] = [];
    lines.push('# iPod Archive Report');
    lines.push('');
    lines.push(
      'Everything that was skipped or failed during this archive run. ' +
        'This run is non-interactive, so this report is the record of what was and was not archived.'
    );
    lines.push('');

    lines.push('## Stage 1 — raw dump');
    lines.push('');
    if (this.stage1 === null) {
      lines.push(
        '_Not available (transform-only run). Stage-1 dump classification is recorded only ' +
          'when the dump stage runs in the same invocation._'
      );
      lines.push('');
    } else {
      renderPathBucket(lines, 'Foreign files skipped (not copied)', this.stage1.foreignSkipped);
      renderDumpFailures(lines, this.stage1.dumpFailures);
    }

    lines.push('## Stage 2 — archive transform');
    lines.push('');
    if (this.stage2 === null) {
      lines.push('_Not run (dump-only run)._');
      lines.push('');
    } else {
      renderTrackBucket(lines, 'Tracks with no audio', this.stage2.noAudio);
      renderTrackBucket(lines, 'Tracks with no artwork', this.stage2.noArtwork);
      renderTransformFailures(lines, this.stage2.transformFailures);
      renderTagFailures(lines, this.stage2.tagFailures);
      renderPlaylistFailures(lines, this.stage2.playlistFailures);
    }

    // Trim the trailing blank line into a single terminating newline.
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }
}

/** Sort + de-dup a stage-1 bucket set so output is deterministic. */
function normalizeStage1(stage1: ReportStage1): ReportStage1 {
  return {
    foreignSkipped: [...stage1.foreignSkipped].sort(compareStable),
    dumpFailures: [...stage1.dumpFailures].sort((a, b) => compareStable(a.path, b.path)),
  };
}

/** Sort the stage-2 buckets so output is deterministic. */
function normalizeStage2(stage2: ReportStage2): ReportStage2 {
  return {
    noAudio: sortTrackSkips(stage2.noAudio),
    noArtwork: sortTrackSkips(stage2.noArtwork),
    transformFailures: [...stage2.transformFailures].sort((a, b) => {
      const byPath = compareStable(a.relPath, b.relPath);
      return byPath !== 0 ? byPath : compareStable(a.dbid, b.dbid);
    }),
    tagFailures: [...stage2.tagFailures].sort((a, b) => {
      const byPath = compareStable(a.relPath, b.relPath);
      return byPath !== 0 ? byPath : compareStable(a.dbid, b.dbid);
    }),
    playlistFailures: [...stage2.playlistFailures].sort((a, b) =>
      compareStable(a.relPath, b.relPath)
    ),
  };
}

/** Sort track skips by title then dbid for a stable, browseable order. */
function sortTrackSkips(skips: readonly ReportTrackSkip[]): ReportTrackSkip[] {
  return [...skips].sort((a, b) => {
    const byTitle = compareStable(a.title ?? '', b.title ?? '');
    return byTitle !== 0 ? byTitle : compareStable(a.dbid, b.dbid);
  });
}

/** Append a markdown subsection for a bucket of plain path/name strings. */
function renderPathBucket(lines: string[], heading: string, items: readonly string[]): void {
  lines.push(`### ${heading} (${items.length})`);
  lines.push('');
  if (items.length === 0) {
    lines.push('Nothing skipped.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map((item) => `\`${item}\``)
  );
}

/** Append a markdown subsection for stage-2 track skips. */
function renderTrackBucket(
  lines: string[],
  heading: string,
  items: readonly ReportTrackSkip[]
): void {
  lines.push(`### ${heading} (${items.length})`);
  lines.push('');
  if (items.length === 0) {
    lines.push('None.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map((item) => `${item.title ?? '<untitled>'} (dbid ${item.dbid})`)
  );
}

/** Append a markdown subsection for stage-1 dump failures. */
function renderDumpFailures(lines: string[], items: readonly ReportDumpFailure[]): void {
  lines.push(`### Dump failures (${items.length})`);
  lines.push('');
  if (items.length === 0) {
    lines.push('No failures.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map((item) => `\`${item.path}\` — ${item.error}`)
  );
}

/** Append a markdown subsection for stage-2 transform failures. */
function renderTransformFailures(lines: string[], items: readonly ReportTransformFailure[]): void {
  lines.push(`### Transform failures (${items.length})`);
  lines.push('');
  if (items.length === 0) {
    lines.push('No failures.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map(
      (item) =>
        `${item.title ?? '<untitled>'} (dbid ${item.dbid}) → \`${item.relPath}\` — ${item.error}`
    )
  );
}

/**
 * Append a markdown subsection for stage-2 tag failures — tracks that WERE
 * extracted (their audio is in the archive) but could not be tagged by either
 * taglib or ffmpeg. Worded to make clear nothing was lost.
 */
function renderTagFailures(lines: string[], items: readonly ReportTransformFailure[]): void {
  lines.push(`### Tracks extracted but not tagged (${items.length})`);
  lines.push('');
  lines.push(
    '_These tracks are in the archive and playable; only their metadata could not ' +
      'be rewritten, so they keep their original on-device tags._'
  );
  lines.push('');
  if (items.length === 0) {
    lines.push('None.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map(
      (item) =>
        `${item.title ?? '<untitled>'} (dbid ${item.dbid}) → \`${item.relPath}\` — ${item.error}`
    )
  );
}

/** Append a markdown subsection for stage-2 playlist failures. */
function renderPlaylistFailures(lines: string[], items: readonly ReportPlaylistFailure[]): void {
  lines.push(`### Playlist failures (${items.length})`);
  lines.push('');
  if (items.length === 0) {
    lines.push('No failures.');
    lines.push('');
    return;
  }
  appendList(
    lines,
    items.map((item) => `${item.name ?? '<unnamed>'} → \`${item.relPath}\` — ${item.error}`)
  );
}

/**
 * Append a bullet list to `lines`, truncating to {@link REPORT_MARKDOWN_LIST_CAP}
 * with an "...and N more" note. The cap applies to the markdown only — the JSON
 * keeps every entry. A trailing blank line separates the section from the next.
 */
function appendList(lines: string[], rendered: readonly string[]): void {
  const shown = rendered.slice(0, REPORT_MARKDOWN_LIST_CAP);
  for (const item of shown) {
    lines.push(`- ${item}`);
  }
  const remaining = rendered.length - shown.length;
  if (remaining > 0) {
    lines.push(`- ...and ${remaining} more (see \`report.json\` for the full list)`);
  }
  lines.push('');
}
