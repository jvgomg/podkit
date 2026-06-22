import { describe, expect, test } from 'bun:test';
import { MediaType } from '@podkit/libgpod-node';
import {
  planPath,
  createCollisionState,
  classifyMediaType,
  type PlannerTrack,
} from './archive-path-planner.js';

/** Build a PlannerTrack with sensible defaults, overridable per test. */
function track(overrides: Partial<PlannerTrack> = {}): PlannerTrack {
  return {
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Album Artist',
    trackNumber: 1,
    dbid: 100n,
    ipodPath: ':iPod_Control:Music:F00:ABCD.m4a',
    mediaType: MediaType.Audio,
    compilation: false,
    tvShow: null,
    seasonNumber: 0,
    episodeNumber: 0,
    movieFlag: false,
    ...overrides,
  };
}

describe('planPath — music layout', () => {
  test('builds Music/<AlbumArtist>/<Album>/NN Title.ext (spaces preserved)', () => {
    const rel = planPath(track(), createCollisionState());
    expect(rel).toBe('Music/Album Artist/Album/01 Song.m4a');
  });

  test('zero-pads the track number to two digits', () => {
    expect(planPath(track({ trackNumber: 7 }), createCollisionState())).toBe(
      'Music/Album Artist/Album/07 Song.m4a'
    );
    expect(planPath(track({ trackNumber: 12 }), createCollisionState())).toBe(
      'Music/Album Artist/Album/12 Song.m4a'
    );
    expect(planPath(track({ trackNumber: 105 }), createCollisionState())).toBe(
      'Music/Album Artist/Album/105 Song.m4a'
    );
  });

  test('omits the NN prefix when there is no track number', () => {
    expect(planPath(track({ trackNumber: 0 }), createCollisionState())).toBe(
      'Music/Album Artist/Album/Song.m4a'
    );
  });

  test('derives the extension from the ipodPath, lowercased', () => {
    expect(
      planPath(track({ ipodPath: ':iPod_Control:Music:F03:ZZZZ.MP3' }), createCollisionState())
    ).toBe('Music/Album Artist/Album/01 Song.mp3');
  });

  test('handles an ipodPath with no extension', () => {
    expect(
      planPath(track({ ipodPath: ':iPod_Control:Music:F03:NOEXT' }), createCollisionState())
    ).toBe('Music/Album Artist/Album/01 Song');
  });
});

describe('planPath — fallbacks', () => {
  test('falls back to the artist when albumArtist is absent', () => {
    expect(planPath(track({ albumArtist: null }), createCollisionState())).toBe(
      'Music/Artist/Album/01 Song.m4a'
    );
  });

  test('falls back to Unknown Artist when both artist fields are absent', () => {
    expect(planPath(track({ albumArtist: null, artist: null }), createCollisionState())).toBe(
      'Music/Unknown Artist/Album/01 Song.m4a'
    );
  });

  test('falls back to Unknown Album when album is absent', () => {
    expect(planPath(track({ album: null }), createCollisionState())).toBe(
      'Music/Album Artist/Unknown Album/01 Song.m4a'
    );
  });

  test('falls back to the source basename when the title is absent', () => {
    expect(
      planPath(
        track({ title: null, ipodPath: ':iPod_Control:Music:F00:ABCD1234.m4a' }),
        createCollisionState()
      )
    ).toBe('Music/Album Artist/Album/01 ABCD1234.m4a');
  });

  test('falls back to Unknown Title when the title sanitises away but a basename exists', () => {
    // Title is all reserved chars (sanitises to empty); basename is usable.
    expect(
      planPath(
        track({ title: '???', ipodPath: ':iPod_Control:Music:F00:track.m4a' }),
        createCollisionState()
      )
    ).toBe('Music/Album Artist/Album/01 track.m4a');

    // Both title and basename unusable → constant fallback.
    expect(
      planPath(
        track({ title: '???', ipodPath: ':iPod_Control:Music:F00:***.m4a' }),
        createCollisionState()
      )
    ).toBe('Music/Album Artist/Album/01 Unknown Title.m4a');
  });
});

describe('planPath — sanitisation', () => {
  test('replaces reserved characters in every segment (spaces kept)', () => {
    const rel = planPath(
      track({ albumArtist: 'AC/DC', album: 'Back: In', title: 'Hells*Bells' }),
      createCollisionState()
    );
    expect(rel).toBe('Music/AC_DC/Back_ In/01 Hells_Bells.m4a');
  });

  test('strips trailing dots and spaces from segments', () => {
    const rel = planPath(
      track({ albumArtist: 'Artist.', album: 'Album ', title: 'Song.' }),
      createCollisionState()
    );
    expect(rel).toBe('Music/Artist/Album/01 Song.m4a');
  });

  test('prefixes Windows reserved device names', () => {
    const rel = planPath(
      track({ albumArtist: 'CON', album: 'PRN', title: 'NUL' }),
      createCollisionState()
    );
    expect(rel).toBe('Music/_CON/_PRN/01 _NUL.m4a');
  });

  test('caps over-long segments at a portable byte length', () => {
    const long = 'a'.repeat(400);
    const rel = planPath(track({ album: long }), createCollisionState());
    const albumSegment = rel!.split('/')[2]!;
    expect(albumSegment.length).toBeLessThanOrEqual(200);
    expect(albumSegment.length).toBeGreaterThan(0);
  });

  test('normalises non-ASCII metadata to NFC (decomposed === composed)', () => {
    // "é" composed (U+00E9) vs decomposed ("e" + U+0301) must plan to the same path.
    const composed = planPath(track({ album: 'Café' }), createCollisionState());
    const decomposed = planPath(track({ album: 'Café' }), createCollisionState());
    expect(composed).toBe(decomposed);
    expect(composed).toBe('Music/Album Artist/Café/01 Song.m4a');
  });
});

describe('planPath — collisions', () => {
  test('appends the dbid before the extension on a collision', () => {
    const state = createCollisionState();
    const first = planPath(track({ dbid: 11n }), state);
    const second = planPath(track({ dbid: 22n }), state);
    expect(first).toBe('Music/Album Artist/Album/01 Song.m4a');
    expect(second).toBe('Music/Album Artist/Album/01 Song [22].m4a');
  });

  test('collision resolution is deterministic regardless of order', () => {
    const a = createCollisionState();
    const r1 = planPath(track({ dbid: 7n }), a);
    const r2 = planPath(track({ dbid: 9n }), a);

    const b = createCollisionState();
    const s1 = planPath(track({ dbid: 7n }), b);
    const s2 = planPath(track({ dbid: 9n }), b);

    expect(r1).toBe(s1);
    expect(r2).toBe(s2);
    expect(new Set([r1, r2]).size).toBe(2);
  });

  test('a third collision still resolves uniquely via its own dbid', () => {
    const state = createCollisionState();
    const r1 = planPath(track({ dbid: 1n }), state);
    const r2 = planPath(track({ dbid: 2n }), state);
    const r3 = planPath(track({ dbid: 3n }), state);
    expect(new Set([r1, r2, r3]).size).toBe(3);
  });

  test('never reuses a path even when a dbid-suffixed name itself collides', () => {
    const state = createCollisionState();
    // Track A: plain "Song" → "01 Song.m4a".
    const a = planPath(track({ title: 'Song', dbid: 42n }), state);
    // Track B's literal title is "Song [42]" → "01 Song [42].m4a".
    const b = planPath(track({ title: 'Song [42]', dbid: 7n }), state);
    // Track C: plain "Song", dbid 42 → base collides with A, dbid-suffix
    // collides with B → must fall through to a counter variant.
    const c = planPath(track({ title: 'Song', dbid: 42n }), state);

    expect(a).toBe('Music/Album Artist/Album/01 Song.m4a');
    expect(b).toBe('Music/Album Artist/Album/01 Song [42].m4a');
    expect(c).toBe('Music/Album Artist/Album/01 Song [42] (2).m4a');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('planPath — segmentOr fallback chain', () => {
  test('falls through to artist when albumArtist sanitises entirely to empty', () => {
    // ':::' contains only colons (illegal chars → replaced then stripped), so
    // sanitizePathSegment produces ''. The segmentOr chain must skip it and
    // use the artist instead.
    expect(
      planPath(track({ albumArtist: ':::', artist: 'Real Artist' }), createCollisionState())
    ).toBe('Music/Real Artist/Album/01 Song.m4a');
  });
});

describe('planPath — no audio', () => {
  test('returns null for a null ipodPath', () => {
    expect(planPath(track({ ipodPath: null }), createCollisionState())).toBeNull();
  });

  test('returns null for an empty / colon-only ipodPath', () => {
    expect(planPath(track({ ipodPath: '' }), createCollisionState())).toBeNull();
    expect(planPath(track({ ipodPath: ':::' }), createCollisionState())).toBeNull();
  });
});

describe('classifyMediaType', () => {
  test('plain audio is music', () => {
    expect(classifyMediaType(track())).toBe('music');
  });

  test('compilation flag (audio) is compilation', () => {
    expect(classifyMediaType(track({ compilation: true }))).toBe('compilation');
  });

  test('each non-music flag maps to its kind', () => {
    expect(classifyMediaType(track({ mediaType: MediaType.Podcast }))).toBe('podcast');
    expect(classifyMediaType(track({ mediaType: MediaType.Audiobook }))).toBe('audiobook');
    expect(classifyMediaType(track({ mediaType: MediaType.MusicVideo }))).toBe('musicVideo');
    expect(classifyMediaType(track({ mediaType: MediaType.TVShow }))).toBe('tvShow');
    expect(classifyMediaType(track({ mediaType: MediaType.Movie }))).toBe('movie');
    expect(classifyMediaType(track({ mediaType: MediaType.Audio, movieFlag: true }))).toBe('movie');
  });

  test('tests bits with AND, not equality (extra flags do not break matching)', () => {
    // Audio bit also set alongside Podcast — equality would fail, AND must pass.
    expect(classifyMediaType(track({ mediaType: MediaType.Audio | MediaType.Podcast }))).toBe(
      'podcast'
    );
  });

  test('precedence: TV show wins over movie when both flags are set', () => {
    expect(
      classifyMediaType(track({ mediaType: MediaType.TVShow | MediaType.Movie, movieFlag: true }))
    ).toBe('tvShow');
  });

  test('precedence: a podcast that is also flagged compilation is a podcast', () => {
    expect(classifyMediaType(track({ mediaType: MediaType.Podcast, compilation: true }))).toBe(
      'podcast'
    );
  });
});

describe('planPath — compilations', () => {
  test('routes to Music/Compilations/<Album>/NN Title (no album-artist)', () => {
    expect(planPath(track({ compilation: true }), createCollisionState())).toBe(
      'Music/Compilations/Album/01 Song.m4a'
    );
  });

  test('keeps the NN prefix and album grouping; ignores albumArtist', () => {
    expect(
      planPath(
        track({ compilation: true, albumArtist: 'Various', album: 'Hits', trackNumber: 9 }),
        createCollisionState()
      )
    ).toBe('Music/Compilations/Hits/09 Song.m4a');
  });

  test('falls back to Unknown Album when album is absent', () => {
    expect(planPath(track({ compilation: true, album: null }), createCollisionState())).toBe(
      'Music/Compilations/Unknown Album/01 Song.m4a'
    );
  });
});

describe('planPath — podcasts', () => {
  test('routes to Podcasts/<Show>/Title with no NN prefix (show = album)', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Podcast, album: 'My Show', trackNumber: 5 }),
        createCollisionState()
      )
    ).toBe('Podcasts/My Show/Song.m4a');
  });

  test('show falls back to the artist when album is absent', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Podcast, album: null, artist: 'Host' }),
        createCollisionState()
      )
    ).toBe('Podcasts/Host/Song.m4a');
  });

  test('show falls back to Unknown Podcast when album and artist are absent', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Podcast, album: null, artist: null }),
        createCollisionState()
      )
    ).toBe('Podcasts/Unknown Podcast/Song.m4a');
  });
});

describe('planPath — audiobooks', () => {
  test('routes to Audiobooks/<Author>/Title (author = albumArtist)', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Audiobook, albumArtist: 'The Author' }),
        createCollisionState()
      )
    ).toBe('Audiobooks/The Author/Song.m4a');
  });

  test('author falls back to the artist, then Unknown Author', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Audiobook, albumArtist: null, artist: 'Reader' }),
        createCollisionState()
      )
    ).toBe('Audiobooks/Reader/Song.m4a');

    expect(
      planPath(
        track({ mediaType: MediaType.Audiobook, albumArtist: null, artist: null }),
        createCollisionState()
      )
    ).toBe('Audiobooks/Unknown Author/Song.m4a');
  });
});

describe('planPath — music videos', () => {
  test('routes to Video/Music Videos/Title', () => {
    expect(planPath(track({ mediaType: MediaType.MusicVideo }), createCollisionState())).toBe(
      'Video/Music Videos/Song.m4a'
    );
  });
});

describe('planPath — movies', () => {
  test('routes to Video/Movies/Title via the Movie media flag', () => {
    expect(planPath(track({ mediaType: MediaType.Movie }), createCollisionState())).toBe(
      'Video/Movies/Song.m4a'
    );
  });

  test('routes to Video/Movies/Title via the movieFlag boolean', () => {
    expect(
      planPath(track({ mediaType: MediaType.Audio, movieFlag: true }), createCollisionState())
    ).toBe('Video/Movies/Song.m4a');
  });
});

describe('planPath — TV shows', () => {
  test('routes to Video/TV Shows/<Show>/Season NN/EE Title with season + episode', () => {
    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: 'My Show',
          seasonNumber: 2,
          episodeNumber: 7,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/My Show/Season 02/07 Song.m4a');
  });

  test('show falls back to album, then Unknown Show', () => {
    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: null,
          album: 'Album Show',
          seasonNumber: 1,
          episodeNumber: 3,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Album Show/Season 01/03 Song.m4a');

    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: null,
          album: null,
          seasonNumber: 0,
          trackNumber: 0,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Unknown Show/Song.m4a');
  });

  test('omits the Season directory when no season number is set', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.TVShow, tvShow: 'Show', seasonNumber: 0, episodeNumber: 4 }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Show/04 Song.m4a');
  });

  test('episode prefix falls back to the track number, and is omitted when neither is set', () => {
    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: 'Show',
          seasonNumber: 3,
          episodeNumber: 0,
          trackNumber: 11,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Show/Season 03/11 Song.m4a');

    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: 'Show',
          seasonNumber: 3,
          episodeNumber: 0,
          trackNumber: 0,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Show/Season 03/Song.m4a');
  });

  test('sanitises the show name (reserved chars replaced)', () => {
    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow,
          tvShow: 'Law: Order/SVU',
          seasonNumber: 1,
          episodeNumber: 2,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Law_ Order_SVU/Season 01/02 Song.m4a');
  });
});

describe('planPath — media-type precedence in routing', () => {
  test('a track flagged TVShow + Movie routes as a TV show', () => {
    expect(
      planPath(
        track({
          mediaType: MediaType.TVShow | MediaType.Movie,
          movieFlag: true,
          tvShow: 'Show',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
        createCollisionState()
      )
    ).toBe('Video/TV Shows/Show/Season 01/01 Song.m4a');
  });

  test('extra Audio bit alongside Podcast still routes as a podcast', () => {
    expect(
      planPath(
        track({ mediaType: MediaType.Audio | MediaType.Podcast, album: 'Show' }),
        createCollisionState()
      )
    ).toBe('Podcasts/Show/Song.m4a');
  });
});
