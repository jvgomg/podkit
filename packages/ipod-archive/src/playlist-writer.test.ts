/**
 * Unit tests for the pure pieces of the playlist writer.
 *
 * These pin the relative-path computation, the `#EXTINF` projection, the m3u8
 * serialisation (synthetic entries → exact string), and the collision
 * disambiguation. They construct plain objects only — no device, no libgpod, no
 * filesystem — so the io-bound `writePlaylists` path is left to the integration
 * suite.
 */

import { describe, expect, test } from 'bun:test';
import {
  playlistRelativePath,
  serializePlaylistM3u8,
  trackExtinf,
  uniquePlaylistBaseName,
  type PlaylistEntry,
  type PlaylistLine,
} from './playlist-writer.js';
import { IpodArchiveError } from './errors.js';

describe('playlistRelativePath', () => {
  test('prefixes an archive-relative export path with `..` (POSIX)', () => {
    expect(playlistRelativePath('Music/The Band/Greatest Hits/02 Song B.m4a')).toBe(
      '../Music/The Band/Greatest Hits/02 Song B.m4a'
    );
  });

  test('keeps forward slashes regardless of platform', () => {
    const rel = playlistRelativePath('Music/Artist/Album/01 Title.mp3');
    expect(rel).not.toContain('\\');
    expect(rel.startsWith('../')).toBe(true);
  });

  test('throws a typed error on an absolute path (would leak past posix.join)', () => {
    expect(() => playlistRelativePath('/Music/Artist/Album/01 Title.mp3')).toThrow(
      IpodArchiveError
    );
  });
});

describe('trackExtinf', () => {
  test('rounds millisecond duration to whole seconds', () => {
    const meta = trackExtinf({ duration: 200_400, artist: 'A', title: 'T' } as never);
    expect(meta.durationSeconds).toBe(200);
    expect(meta.artist).toBe('A');
    expect(meta.title).toBe('T');
  });

  test('coerces null artist/title to empty strings and clamps duration at 0', () => {
    const meta = trackExtinf({ duration: -5, artist: null, title: null } as never);
    expect(meta.durationSeconds).toBe(0);
    expect(meta.artist).toBe('');
    expect(meta.title).toBe('');
  });
});

describe('serializePlaylistM3u8', () => {
  const entryB: PlaylistEntry = {
    dbid: 1n,
    durationSeconds: 215,
    artist: 'The Band',
    title: 'Song B',
    relativePath: '../Music/The Band/Greatest Hits/02 Song B.m4a',
  };
  const entryA: PlaylistEntry = {
    dbid: 2n,
    durationSeconds: 180,
    artist: 'The Band',
    title: 'Song A',
    relativePath: '../Music/The Band/Greatest Hits/01 Song A.mp3',
  };

  test('emits header, one EXTINF + path per entry, in order, newline-terminated', () => {
    const lines: PlaylistLine[] = [
      { kind: 'entry', entry: entryB },
      { kind: 'entry', entry: entryA },
    ];
    expect(serializePlaylistM3u8(lines)).toBe(
      [
        '#EXTM3U',
        '#EXTINF:215,The Band - Song B',
        '../Music/The Band/Greatest Hits/02 Song B.m4a',
        '#EXTINF:180,The Band - Song A',
        '../Music/The Band/Greatest Hits/01 Song A.mp3',
        '',
      ].join('\n')
    );
  });

  test('records a skipped member as a comment IN POSITION, never as a dangling path', () => {
    // Skip is the middle member: it must appear between the two entries.
    const lines: PlaylistLine[] = [
      { kind: 'entry', entry: entryB },
      { kind: 'skip', skip: { dbid: 9n, title: 'Lonely Track' } },
      { kind: 'entry', entry: entryA },
    ];
    expect(serializePlaylistM3u8(lines)).toBe(
      [
        '#EXTM3U',
        '#EXTINF:215,The Band - Song B',
        '../Music/The Band/Greatest Hits/02 Song B.m4a',
        '# skipped (no exported audio): Lonely Track',
        '#EXTINF:180,The Band - Song A',
        '../Music/The Band/Greatest Hits/01 Song A.mp3',
        '',
      ].join('\n')
    );
  });

  test('an all-skipped playlist still yields a valid header-only file', () => {
    expect(serializePlaylistM3u8([{ kind: 'skip', skip: { dbid: 1n, title: null } }])).toBe(
      '#EXTM3U\n# skipped (no exported audio): <untitled>\n'
    );
  });

  test('an empty playlist yields just the header', () => {
    expect(serializePlaylistM3u8([])).toBe('#EXTM3U\n');
  });
});

describe('uniquePlaylistBaseName', () => {
  test('returns the sanitised name when free', () => {
    const taken = new Set<string>();
    expect(uniquePlaylistBaseName('My Mix', 1n, taken)).toBe('My Mix');
    expect(taken.has('My Mix')).toBe(true);
  });

  test('appends the playlist id when a sanitised name collides', () => {
    const taken = new Set<string>();
    const first = uniquePlaylistBaseName('Workout', 10n, taken);
    const second = uniquePlaylistBaseName('Workout', 20n, taken);
    expect(first).toBe('Workout');
    expect(second).toBe('Workout [20]');
  });

  test('falls back to a placeholder when the name sanitises to nothing', () => {
    const taken = new Set<string>();
    // A name of only illegal/stripped characters sanitises to ''.
    expect(uniquePlaylistBaseName('///', 5n, taken)).toBe('Playlist');
  });

  test('falls back to a placeholder for a null name', () => {
    const taken = new Set<string>();
    expect(uniquePlaylistBaseName(null, 5n, taken)).toBe('Playlist');
  });

  test('disambiguates two empty-sanitising names by id', () => {
    const taken = new Set<string>();
    expect(uniquePlaylistBaseName('', 1n, taken)).toBe('Playlist');
    expect(uniquePlaylistBaseName('', 2n, taken)).toBe('Playlist [2]');
  });

  test('walks an index when even the id-suffixed name is taken', () => {
    const taken = new Set<string>(['Mix', 'Mix [7]']);
    expect(uniquePlaylistBaseName('Mix', 7n, taken)).toBe('Mix [7] (2)');
  });
});
