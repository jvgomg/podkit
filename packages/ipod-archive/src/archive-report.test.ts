/**
 * Unit tests for the report + README renderers.
 *
 * Pure, IO-free coverage of:
 * - `computeLibraryStats` — totals, distinct counts, date range, top-N (with a
 *   tie), and the empty-library degenerate case;
 * - `ArchiveReport.renderMarkdown` / `toJson` — populated buckets, the
 *   all-empty "nothing skipped" report, the transform-only stage-1-absent case,
 *   and markdown-only truncation (JSON keeps the full list);
 * - `renderReadme` — identity + stats fields present, and degradation when the
 *   serial (and the rest of identity) is absent.
 */

import { describe, expect, test } from 'bun:test';
import type { Track } from '@podkit/libgpod-node';
import {
  ArchiveReport,
  computeLibraryStats,
  renderReadme,
  formatBytes,
  formatDuration,
  REPORT_MARKDOWN_LIST_CAP,
  type ReportStage1,
  type ReportStage2,
} from './archive-report.js';

/** Build a synthetic libgpod track; only the fields stats reads are populated. */
function track(overrides: Partial<Track>): Track {
  return {
    dbid: 1n,
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    genre: null,
    composer: null,
    comment: null,
    grouping: null,
    trackNumber: 0,
    totalTracks: 0,
    discNumber: 0,
    totalDiscs: 0,
    year: 0,
    duration: 0,
    bitrate: 0,
    sampleRate: 0,
    size: 0,
    bpm: 0,
    soundcheck: 0,
    filetype: null,
    mediaType: 0,
    ipodPath: null,
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    mhiiLink: 0,
    tvShow: null,
    tvEpisode: null,
    sortTvShow: null,
    seasonNumber: 0,
    episodeNumber: 0,
    compilation: false,
    movieFlag: false,
    hasArtwork: false,
    ...overrides,
  } as Track;
}

const EMPTY_STAGE2: ReportStage2 = {
  noAudio: [],
  noArtwork: [],
  transformFailures: [],
  tagFailures: [],
  playlistFailures: [],
};

describe('computeLibraryStats', () => {
  test('totals, distinct counts, date range, and top artists', () => {
    const stats = computeLibraryStats([
      track({ artist: 'A', album: 'X', size: 1000, duration: 60_000, timeAdded: 100 }),
      track({ artist: 'A', album: 'Y', size: 2000, duration: 120_000, timeAdded: 300 }),
      track({ artist: 'B', album: 'X', size: 500, duration: 30_000, timeAdded: 200 }),
    ]);

    expect(stats.totalTracks).toBe(3);
    expect(stats.totalSizeBytes).toBe(3500);
    expect(stats.totalDurationMs).toBe(210_000);
    // X appears on two tracks but is one distinct album; A,B are two artists.
    expect(stats.distinctArtists).toBe(2);
    expect(stats.distinctAlbums).toBe(2);
    expect(stats.earliestAdded).toBe(100);
    expect(stats.latestAdded).toBe(300);
    expect(stats.topArtists).toEqual([
      { artist: 'A', trackCount: 2 },
      { artist: 'B', trackCount: 1 },
    ]);
  });

  test('top-artist ties break alphabetically; nameless tracks roll up to Unknown Artist', () => {
    const stats = computeLibraryStats([
      track({ artist: 'Zeta' }),
      track({ artist: 'Alpha' }),
      track({ artist: null }),
    ]);
    // All three have one track → tie → alphabetical order.
    expect(stats.topArtists).toEqual([
      { artist: 'Alpha', trackCount: 1 },
      { artist: 'Unknown Artist', trackCount: 1 },
      { artist: 'Zeta', trackCount: 1 },
    ]);
    // The nameless track is not counted as a distinct *named* artist.
    expect(stats.distinctArtists).toBe(2);
  });

  test('whitespace-only artist/album are not distinct names', () => {
    const stats = computeLibraryStats([track({ artist: '   ', album: '' })]);
    expect(stats.distinctArtists).toBe(0);
    expect(stats.distinctAlbums).toBe(0);
  });

  test('a track with timeAdded 0 (no date on device) leaves the range null', () => {
    const stats = computeLibraryStats([track({ artist: 'A', timeAdded: 0 })]);
    expect(stats.totalTracks).toBe(1);
    expect(stats.earliestAdded).toBeNull();
    expect(stats.latestAdded).toBeNull();
  });

  test('empty library yields zeroed stats and null date range', () => {
    const stats = computeLibraryStats([]);
    expect(stats.totalTracks).toBe(0);
    expect(stats.totalSizeBytes).toBe(0);
    expect(stats.totalDurationMs).toBe(0);
    expect(stats.distinctArtists).toBe(0);
    expect(stats.distinctAlbums).toBe(0);
    expect(stats.earliestAdded).toBeNull();
    expect(stats.latestAdded).toBeNull();
    expect(stats.topArtists).toEqual([]);
  });
});

describe('formatBytes / formatDuration', () => {
  test('formatBytes uses binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.50 MB');
  });

  test('formatDuration drops leading zero units but keeps interior ones', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration((86_400 + 3600 + 60 + 1) * 1000)).toBe('1d 1h 1m 1s');
    // Once a higher unit is present, lower units are kept even when zero, so the
    // `Dd HHh MMm SSs` shape stays consistent.
    expect(formatDuration(3_600_000)).toBe('1h 0m 0s');
    expect(formatDuration(86_405_000)).toBe('1d 0h 0m 5s');
  });
});

describe('ArchiveReport — populated buckets', () => {
  const stage1: ReportStage1 = {
    foreignSkipped: ['mixtape.flac', 'home-movie.mov'],
    dumpFailures: [{ path: 'iPod_Control/Music/F02/bad.m4a', error: 'EIO' }],
  };
  const stage2: ReportStage2 = {
    noAudio: [{ dbid: '10', title: 'Lonely Track' }],
    noArtwork: [{ dbid: '11', title: 'No Art' }],
    transformFailures: [
      { dbid: '12', title: 'Broken', relPath: 'Music/A/B/01 Broken.m4a', error: 'missing source' },
    ],
    tagFailures: [
      {
        dbid: '13',
        title: 'Untaggable',
        relPath: 'Music/C/D/01 Untaggable.mp3',
        error: 'taglib: MPEG audio header not found; ffmpeg: spawn ENOENT',
      },
    ],
    playlistFailures: [{ name: 'My Mix', relPath: 'Playlists/My Mix.m3u8', error: 'EACCES' }],
  };

  test('markdown enumerates every bucket with counts', () => {
    const report = ArchiveReport.forTransform(stage2).withStage1(stage1);
    const md = report.renderMarkdown();

    expect(md).toContain('## Stage 1 — raw dump');
    expect(md).toContain('### Foreign files skipped (not copied) (2)');
    expect(md).toContain('`mixtape.flac`');
    expect(md).toContain('`home-movie.mov`');
    expect(md).not.toContain('Junk skipped');
    expect(md).not.toContain('`.DS_Store`');
    expect(md).toContain('### Dump failures (1)');
    expect(md).toContain('`iPod_Control/Music/F02/bad.m4a` — EIO');

    expect(md).toContain('## Stage 2 — archive transform');
    expect(md).toContain('### Tracks with no audio (1)');
    expect(md).toContain('Lonely Track (dbid 10)');
    expect(md).toContain('### Tracks with no artwork (1)');
    expect(md).toContain('No Art (dbid 11)');
    expect(md).toContain('### Transform failures (1)');
    expect(md).toContain('Broken (dbid 12) → `Music/A/B/01 Broken.m4a` — missing source');
    expect(md).toContain('### Tracks extracted but not tagged (1)');
    expect(md).toContain(
      'Untaggable (dbid 13) → `Music/C/D/01 Untaggable.mp3` — ' +
        'taglib: MPEG audio header not found; ffmpeg: spawn ENOENT'
    );
    // Worded so a reader knows these tracks are present, not lost.
    expect(md).toContain('in the archive and playable');
    expect(md).toContain('### Playlist failures (1)');
    expect(md).toContain('My Mix → `Playlists/My Mix.m3u8` — EACCES');
  });

  test('json mirrors both stages fully and untruncated', () => {
    const report = ArchiveReport.forTransform(stage2).withStage1(stage1);
    const json = report.toJson();
    expect(json.stage1?.foreignSkipped.sort()).toEqual(['home-movie.mov', 'mixtape.flac']);
    expect(json.stage1).not.toHaveProperty('junkSkipped');
    expect(json.stage1?.dumpFailures).toEqual([
      { path: 'iPod_Control/Music/F02/bad.m4a', error: 'EIO' },
    ]);
    expect(json.stage2?.noAudio).toEqual([{ dbid: '10', title: 'Lonely Track' }]);
    expect(json.stage2?.noArtwork).toEqual([{ dbid: '11', title: 'No Art' }]);
    expect(json.stage2?.transformFailures).toHaveLength(1);
    expect(json.stage2?.tagFailures).toEqual([
      {
        dbid: '13',
        title: 'Untaggable',
        relPath: 'Music/C/D/01 Untaggable.mp3',
        error: 'taglib: MPEG audio header not found; ffmpeg: spawn ENOENT',
      },
    ]);
    expect(json.stage2?.playlistFailures).toHaveLength(1);
  });

  test('markdown bucket order is deterministic regardless of input order', () => {
    const shuffled: ReportStage1 = {
      foreignSkipped: ['home-movie.mov', 'mixtape.flac'],
      dumpFailures: [{ path: 'iPod_Control/Music/F02/bad.m4a', error: 'EIO' }],
    };
    const a = ArchiveReport.forTransform(stage2).withStage1(stage1).renderMarkdown();
    const b = ArchiveReport.forTransform(stage2).withStage1(shuffled).renderMarkdown();
    expect(a).toBe(b);
  });
});

describe('ArchiveReport — empty / transform-only / dump-only', () => {
  test('all-empty transform report renders a clean "nothing skipped" body', () => {
    const md = ArchiveReport.forTransform(EMPTY_STAGE2)
      .withStage1({
        foreignSkipped: [],
        dumpFailures: [],
      })
      .renderMarkdown();

    expect(md).toContain('### Foreign files skipped (not copied) (0)');
    expect(md).toContain('Nothing skipped.');
    expect(md).not.toContain('Junk skipped');
    expect(md).toContain('### Tracks with no audio (0)');
    expect(md).toContain('None.');
    expect(md).toContain('No failures.');
    expect(md).not.toContain('- `'); // no bullet entries at all
  });

  test('transform-only run marks the stage-1 section "not available"', () => {
    const report = ArchiveReport.forTransform(EMPTY_STAGE2);
    const md = report.renderMarkdown();
    expect(md).toContain('Not available (transform-only run)');
    expect(report.toJson().stage1).toBeNull();
    expect(report.toJson().stage2).not.toBeNull();
  });

  test('dump-only run has stage-1 buckets and no stage-2 section', () => {
    const report = ArchiveReport.forDumpOnly({
      foreignSkipped: ['x.flac'],
      dumpFailures: [],
    });
    const md = report.renderMarkdown();
    expect(md).toContain('### Foreign files skipped (not copied) (1)');
    expect(md).not.toContain('Junk skipped');
    expect(md).toContain('Not run (dump-only run)');
    expect(report.toJson().stage2).toBeNull();
    expect(report.toJson().stage1?.foreignSkipped).toEqual(['x.flac']);
  });
});

describe('ArchiveReport — truncation', () => {
  test('markdown truncates a long bucket but json keeps every entry', () => {
    const many = Array.from(
      { length: REPORT_MARKDOWN_LIST_CAP + 7 },
      (_, i) => `foreign-${String(i).padStart(3, '0')}.bin`
    );
    const report = ArchiveReport.forTransform(EMPTY_STAGE2).withStage1({
      foreignSkipped: many,
      dumpFailures: [],
    });

    const md = report.renderMarkdown();
    // Exactly the cap is shown, plus the "and N more" note.
    const shownBullets = md.split('\n').filter((l) => l.startsWith('- `foreign-')).length;
    expect(shownBullets).toBe(REPORT_MARKDOWN_LIST_CAP);
    expect(md).toContain('...and 7 more');

    // JSON keeps the full untruncated list.
    expect(report.toJson().stage1?.foreignSkipped).toHaveLength(REPORT_MARKDOWN_LIST_CAP + 7);
  });
});

describe('renderReadme', () => {
  const stats = computeLibraryStats([
    track({
      artist: 'Band',
      album: 'Album',
      size: 1024,
      duration: 180_000,
      timeAdded: 1_600_000_000,
    }),
    track({
      artist: 'Band',
      album: 'Album',
      size: 2048,
      duration: 200_000,
      timeAdded: 1_700_000_000,
    }),
  ]);

  test('renders identity, archive, and library sections', () => {
    const md = renderReadme({
      identity: {
        modelName: 'iPod Video (60GB)',
        modelNumber: 'MA147',
        serialNumber: 'ABC123',
        generation: 'video_1',
        capacityGb: 60,
      },
      dumpDate: 1_700_000_000,
      podkitVersion: '1.2.3',
      stats,
    });

    expect(md).toContain('iPod Video (60GB)');
    expect(md).toContain('MA147');
    expect(md).toContain('ABC123');
    expect(md).toContain('video_1');
    expect(md).toContain('60 GB');
    expect(md).toContain('1.2.3');
    // Dump date renders as a stable UTC ISO instant.
    expect(md).toContain('| Dump date | 2023-11-14T22:13:20.000Z |');
    // Library stats present.
    expect(md).toContain('| Tracks | 2 |');
    expect(md).toContain('Total size');
    expect(md).toContain('Total play time');
    expect(md).toContain('| Distinct artists | 1 |');
    expect(md).toContain('| Distinct albums | 1 |');
    expect(md).toContain('### Top artists');
    expect(md).toContain('- Band (2)');
    // Date-added range uses the two timestamps' UTC dates.
    expect(md).toContain('2020-09-13 – 2023-11-14');
  });

  test('degrades every absent identity field to a dash', () => {
    const md = renderReadme({
      identity: {}, // stock/dying iPod with no SysInfoExtended
      dumpDate: 0,
      podkitVersion: 'unknown',
      stats: computeLibraryStats([]),
    });
    expect(md).toContain('| Model | — |');
    expect(md).toContain('| Serial | — |');
    expect(md).toContain('| Capacity | — |');
    expect(md).toContain('| Generation | — |');
    // Empty library: a "—" date range, zero tracks, no top-artists section.
    expect(md).toContain('| Tracks | 0 |');
    expect(md).toContain('— – —');
    expect(md).not.toContain('### Top artists');
  });
});
