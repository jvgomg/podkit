/**
 * Generators for the multi-format audio fixture sets.
 *
 * Produces 8 short (5s) audio files covering every codec podkit accepts as
 * input, with deterministic metadata so collection-source tests can assert
 * exact `title` / `artist` / `album` values.
 *
 * Four variants exist, parameterised by artwork configuration:
 *
 *   - **multi-format**          — no embedded artwork, no sidecar (scenario A).
 *   - **multi-format-embedded** — embedded artwork only (scenario B).
 *   - **multi-format-sidecar**  — no embedded artwork; `cover.jpg` sidecar (scenario C).
 *   - **multi-format-both**     — embedded artwork + `cover.jpg` sidecar (scenario D).
 *
 * The track table (filenames, encoders, frequencies, metadata) is shared
 * across every variant. The variants differ only in (a) the album tag they
 * write and (b) whether they invoke ffmpeg with an embedded-art input and/or
 * write a sidecar cover.
 *
 * Each track carries a unique sine frequency so listeners can audibly
 * distinguish them when manually inspecting a generated collection.
 *
 * @module
 */
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { requireEncoder } from '../encoder-guard.js';
import {
  buildMetadataBlockPicture,
  ensureDir,
  generateCoverJpeg,
  injectId3v2ApicIntoWav,
  metadataArgs,
  runFfmpeg,
  writeGeneratedSentinel,
} from './shared.js';

const COMMON = {
  date: '2026',
  genre: 'Electronic',
} as const;

/**
 * Artist per scenario. Scenario A keeps the legacy `Multi-Format Test`
 * because other tests already depend on it; B/C/D use distinct artists so
 * that operations[].track strings in sync output (which embed the artist)
 * disambiguate which scenario a given track came from. None of the four
 * artists is a substring of another, so the Subsonic adapter's substring
 * filter never aliases scenarios.
 */
const SCENARIO_ARTISTS = {
  none: 'Multi-Format Test',
  embedded: 'Multi-Format Embedded',
  sidecar: 'Multi-Format Sidecar',
  both: 'Multi-Format Both',
} as const;

/**
 * Distinct cover colour per scenario so manual inspection can tell at a
 * glance which variant a fixture came from.
 */
const COVER_COLORS = {
  embedded: '#d94a4a',
  embeddedAlt: '#4a4ad9',
  sidecar: '#4ad97c',
  both: '#9b4ad9',
} as const;

/**
 * One track in the multi-format set. Hoisted to a type so the generator
 * loop and the README docs share a single source of truth.
 */
interface MultiFormatTrack {
  filename: string;
  title: string;
  /** Album category — same across every variant; the suffix below disambiguates variants. */
  albumCategory: 'Lossless Collection' | 'Compatible Lossy' | 'Incompatible Lossy';
  track: number;
  frequency: number;
  /** ffmpeg encoder name (passed to `-c:a`). */
  encoder: string;
  /** Sample rate. Opus is forced to 48 kHz because libopus rejects 44.1k. */
  sampleRate: number;
  /** Extra ffmpeg args specific to this codec (bitrate, quality flags). */
  extraArgs: readonly string[];
  /**
   * How to embed cover art into this track when the variant calls for it.
   *
   * - `'attached_pic'`: standard `-c:v mjpeg -disposition:v attached_pic`
   *   invocation. Used by FLAC / ALAC / MP3 / AAC and by AIFF when paired
   *   with `-write_id3v2 1` in `extraArgs`.
   * - `'vorbis_comment'`: ffmpeg writes a `METADATA_BLOCK_PICTURE` Vorbis
   *   comment containing a base64-encoded FLAC PICTURE block (the official
   *   Xiph convention). Used for OGG / Opus, whose muxers reject any video
   *   stream but accept the `-metadata METADATA_BLOCK_PICTURE=<base64>` flag.
   * - `'wav_id3_chunk'`: ffmpeg writes audio only; a post-process step
   *   appends an `id3 ` RIFF chunk with an ID3v2.3 APIC frame. WAV's muxer
   *   rejects video streams outright, so the tag has to be spliced manually
   *   (see {@link injectId3v2ApicIntoWav}). iTunes / `music-metadata` /
   *   Windows Media Player all read this chunk back as the cover.
   */
  embedStrategy: 'attached_pic' | 'vorbis_comment' | 'wav_id3_chunk';
}

const TRACKS: readonly MultiFormatTrack[] = [
  {
    filename: '01-wav-track.wav',
    title: 'WAV Test Track',
    albumCategory: 'Lossless Collection',
    track: 1,
    frequency: 440,
    encoder: 'pcm_s16le',
    sampleRate: 44100,
    extraArgs: [],
    embedStrategy: 'wav_id3_chunk',
  },
  {
    filename: '02-aiff-track.aiff',
    title: 'AIFF Test Track',
    albumCategory: 'Lossless Collection',
    track: 2,
    frequency: 523.25,
    encoder: 'pcm_s16be',
    sampleRate: 44100,
    // ffmpeg's AIFF muxer only writes native NAME/AUTH/ANNO/(c) chunks by
    // default — anything outside those (artist/album/track/date/genre) is
    // silently dropped and attached_pic is rejected. `-write_id3v2 1` adds
    // an ID3v2 tag to the AIFF FORM, which Apple/iTunes uses in the wild
    // and which music-metadata / iTunes / podkit all read correctly.
    extraArgs: ['-write_id3v2', '1'],
    embedStrategy: 'attached_pic',
  },
  {
    filename: '03-flac-track.flac',
    title: 'FLAC Test Track',
    albumCategory: 'Lossless Collection',
    track: 3,
    frequency: 659.25,
    encoder: 'flac',
    sampleRate: 44100,
    extraArgs: [],
    embedStrategy: 'attached_pic',
  },
  {
    filename: '04-alac-track.m4a',
    title: 'ALAC Test Track',
    albumCategory: 'Lossless Collection',
    track: 4,
    frequency: 783.99,
    encoder: 'alac',
    sampleRate: 44100,
    extraArgs: [],
    embedStrategy: 'attached_pic',
  },
  {
    filename: '05-mp3-track.mp3',
    title: 'MP3 Test Track',
    albumCategory: 'Compatible Lossy',
    track: 1,
    frequency: 329.63,
    encoder: 'libmp3lame',
    sampleRate: 44100,
    extraArgs: ['-q:a', '0'],
    embedStrategy: 'attached_pic',
  },
  {
    filename: '06-aac-track.m4a',
    title: 'AAC Test Track',
    albumCategory: 'Compatible Lossy',
    track: 2,
    frequency: 392,
    encoder: 'aac',
    sampleRate: 44100,
    extraArgs: ['-b:a', '256k'],
    embedStrategy: 'attached_pic',
  },
  {
    filename: '07-ogg-track.ogg',
    title: 'OGG Test Track',
    albumCategory: 'Incompatible Lossy',
    track: 1,
    frequency: 493.88,
    encoder: 'libvorbis',
    sampleRate: 44100,
    extraArgs: ['-q:a', '7'],
    embedStrategy: 'vorbis_comment',
  },
  {
    filename: '08-opus-track.opus',
    title: 'Opus Test Track',
    albumCategory: 'Incompatible Lossy',
    track: 2,
    frequency: 587.33,
    encoder: 'libopus',
    sampleRate: 48000,
    extraArgs: ['-b:a', '128k'],
    embedStrategy: 'vorbis_comment',
  },
];

/**
 * Encoders required by the multi-format generators. Surfaced separately so
 * the build-time `check-ffmpeg.ts` and the runtime generator share the same
 * list.
 */
export const REQUIRED_ENCODERS = [
  'pcm_s16le',
  'pcm_s16be',
  'flac',
  'alac',
  'libmp3lame',
  'aac',
  'libvorbis',
  'libopus',
] as const;

interface MultiFormatVariantOptions {
  /** Artist tag for every track in this variant. See {@link SCENARIO_ARTISTS}. */
  artist: string;
  /**
   * Per-track artist override. When set, takes precedence over {@link artist}
   * for each track — used by the compilation variant to give every track a
   * distinct artist while sharing one album.
   */
  artistFor?: (track: MultiFormatTrack) => string;
  /** Suffix appended to each album category tag, e.g. ' (Embedded)' → 'Lossless Collection (Embedded)'. */
  albumSuffix: string;
  /**
   * Shared album tag for every track. When set, overrides the per-track
   * `albumCategory${albumSuffix}` album — used by the compilation variant so
   * all tracks share one album (with differing artists).
   */
  album?: string;
  /** `album_artist` tag written to every track when set (compilation variant). */
  albumArtist?: string;
  /** Sets the `compilation` flag tag on every track when true. */
  compilation?: boolean;
  /** If true, embed the cover JPEG into the output file's attached_pic stream. */
  embedded: boolean;
  /**
   * Per-track embed override (only consulted when {@link embedded} is true).
   * Lets a variant embed art in some tracks but not others — used by the
   * compilation variant to leave WAV/OGG/Opus without art so the album-cache
   * `(artist, album)` split can be observed.
   */
  embedTrack?: (track: MultiFormatTrack) => boolean;
  /** If true, write a `cover.jpg` sidecar next to the audio files. */
  sidecar: boolean;
  /** Colour of the generated cover JPEG. */
  coverColor: string;
  /**
   * Per-track cover colour override (attached_pic tracks only). When set, each
   * track embeds a distinctly-coloured cover instead of the shared one — used
   * by the compilation variant to give every track a unique, identifiable cover
   * so album-cache *collisions* (a track ending up with a sibling's art) are
   * detectable, not just inferred.
   */
  coverColorFor?: (track: MultiFormatTrack) => string;
  /** Square cover edge length in px (default 500). Larger exercises downscale. */
  coverSize?: number;
  /** Label used by the sentinel file. */
  sentinelLabel: string;
}

/**
 * Core generator. All four public variants delegate here.
 *
 * When `embedded` is true, every track gets a cover embedded via its
 * format-specific strategy — see {@link MultiFormatTrack.embedStrategy} for
 * the per-format details.
 */
async function generateMultiFormatWithArt(
  outputDir: string,
  opts: MultiFormatVariantOptions
): Promise<void> {
  for (const encoder of REQUIRED_ENCODERS) {
    requireEncoder(encoder);
  }
  if (opts.embedded || opts.sidecar) {
    requireEncoder('mjpeg');
  }
  await ensureDir(outputDir);

  const coverSize = opts.coverSize ?? MULTI_FORMAT_DEFAULT_COVER_SIZE;
  const coverPath = join(outputDir, 'cover.jpg');
  if (opts.embedded || opts.sidecar) {
    await generateCoverJpeg(coverPath, opts.coverColor, coverSize);
  }

  // Pre-compute the Vorbis-comment cover blob once per album; OGG and Opus
  // tracks share it. (Hot-loop reuse: building the base64 is cheap but
  // re-reading the JPEG per track is wasteful.)
  const vorbisCoverValue = opts.embedded
    ? await buildMetadataBlockPicture(coverPath, { width: coverSize, height: coverSize })
    : '';

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    const trackArtist = opts.artistFor ? opts.artistFor(track) : opts.artist;
    const albumTag = opts.album ?? `${track.albumCategory}${opts.albumSuffix}`;
    const embedThis = opts.embedded && (opts.embedTrack ? opts.embedTrack(track) : true);
    const meta = metadataArgs({
      title: track.title,
      artist: trackArtist,
      album: albumTag,
      album_artist: opts.albumArtist,
      compilation: opts.compilation ? 1 : undefined,
      track: track.track,
      date: COMMON.date,
      genre: COMMON.genre,
    });

    // Per-track distinct cover, if the variant asks for one (attached_pic only).
    let perTrackCover: string | null = null;
    if (embedThis && track.embedStrategy === 'attached_pic' && opts.coverColorFor) {
      perTrackCover = join(outputDir, `.cover-${track.filename}.jpg`);
      await generateCoverJpeg(perTrackCover, opts.coverColorFor(track), coverSize);
    }
    const embedCoverPath = perTrackCover ?? coverPath;

    const args: string[] = [];
    if (embedThis && track.embedStrategy === 'attached_pic') {
      // Cover is input 0 (image), audio is generated by lavfi as input 1.
      args.push(
        '-i',
        embedCoverPath,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${track.frequency}:duration=5:sample_rate=${track.sampleRate}`,
        '-map',
        '1:a',
        '-map',
        '0:v',
        '-c:a',
        track.encoder,
        '-c:v',
        'mjpeg',
        '-disposition:v',
        'attached_pic'
      );
    } else {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${track.frequency}:duration=5:sample_rate=${track.sampleRate}`,
        '-c:a',
        track.encoder
      );
    }
    args.push('-ar', String(track.sampleRate), '-ac', '2', ...track.extraArgs, ...meta);
    if (embedThis && track.embedStrategy === 'vorbis_comment') {
      // libvorbis / libopus accept the FLAC PICTURE block as a Vorbis
      // comment via the standard -metadata key=value path.
      args.push('-metadata', `METADATA_BLOCK_PICTURE=${vorbisCoverValue}`);
    }
    args.push(outPath);

    await runFfmpeg(args);

    if (perTrackCover) {
      await unlink(perTrackCover);
    }

    if (embedThis && track.embedStrategy === 'wav_id3_chunk') {
      // ffmpeg's WAV muxer refuses video streams, so the tag is spliced in
      // after the audio is written. We mirror title/artist/album into the
      // ID3 frames because TagLib (Navidrome) prefers ID3 over the LIST INFO
      // chunk ffmpeg already wrote and would otherwise see the track as
      // Unknown. See injectId3v2ApicIntoWav() for the RIFF chunk layout.
      await injectId3v2ApicIntoWav(outPath, coverPath, {
        title: track.title,
        artist: trackArtist,
        album: albumTag,
        track: track.track,
        date: COMMON.date,
        genre: COMMON.genre,
      });
    }
  }

  // The cover sidecar is left in place when sidecar=true, removed when
  // sidecar=false (embedded-only). We rewrite a fresh sidecar above only
  // when embedded||sidecar; for embedded-only we just don't keep it.
  if (opts.embedded && !opts.sidecar) {
    // Delete the cover.jpg we used as an ffmpeg input.
    const { unlink } = await import('node:fs/promises');
    await unlink(coverPath);
  }

  await writeGeneratedSentinel(outputDir, opts.sentinelLabel);
}

/**
 * Generate the multi-format set with no artwork (scenario A).
 */
export async function generateMultiFormat(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.none,
    albumSuffix: '',
    embedded: false,
    sidecar: false,
    coverColor: '#000000',
    sentinelLabel: 'multi-format',
  });
}

/**
 * Generate the multi-format set with embedded artwork only (scenario B).
 */
export async function generateMultiFormatEmbedded(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.embedded,
    albumSuffix: ' (Embedded)',
    embedded: true,
    sidecar: false,
    coverColor: COVER_COLORS.embedded,
    sentinelLabel: 'multi-format-embedded',
  });
}

/**
 * Generate the multi-format set with a `cover.jpg` sidecar but no embedded
 * artwork (scenario C).
 */
export async function generateMultiFormatSidecar(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.sidecar,
    albumSuffix: ' (Sidecar)',
    embedded: false,
    sidecar: true,
    coverColor: COVER_COLORS.sidecar,
    sentinelLabel: 'multi-format-sidecar',
  });
}

/**
 * Generate the multi-format set with both embedded artwork and a `cover.jpg`
 * sidecar (scenario D).
 */
export async function generateMultiFormatBoth(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.both,
    albumSuffix: ' (Both)',
    embedded: true,
    sidecar: true,
    coverColor: COVER_COLORS.both,
    sentinelLabel: 'multi-format-both',
  });
}

/**
 * Generate the multi-format set with embedded artwork only — same artist /
 * album / title tags as {@link generateMultiFormatEmbedded}, but a different
 * cover JPEG. Used by artwork-change tests to mutate the source cover bytes
 * between syncs without disturbing the track's match key.
 */
export async function generateMultiFormatEmbeddedAlt(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.embedded,
    albumSuffix: ' (Embedded)',
    embedded: true,
    sidecar: false,
    coverColor: COVER_COLORS.embeddedAlt,
    sentinelLabel: 'multi-format-embedded-alt',
  });
}

/**
 * Generate the multi-format set with the embedded variant's exact artist /
 * album / title tags but *no* embedded artwork. Used by the artwork-change
 * matrix to model the source-loses-art transition: sync the embedded variant,
 * then swap in this stripped variant so the cover bytes vanish without
 * disturbing the track's match key.
 */
export async function generateMultiFormatEmbeddedStripped(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: SCENARIO_ARTISTS.embedded,
    albumSuffix: ' (Embedded)',
    embedded: false,
    sidecar: false,
    coverColor: '#000000',
    sentinelLabel: 'multi-format-embedded-stripped',
  });
}

/** Exposed so the matrix tests can build the expected `Artist - Title` strings. */
export { SCENARIO_ARTISTS };

/**
 * Source cover edge length (px) for the default multi-format embedded /
 * sidecar / both variants (anything not labelled "hires"). Matches the
 * `coverSize` default inside `generateMultiFormatWithArt` — exposed so the
 * matrix predictors can compute `expectedSidecarSize(source, caps)` without
 * hardcoding the number twice.
 */
export const MULTI_FORMAT_DEFAULT_COVER_SIZE = 500;

/** Artist tag for the high-resolution-cover variant. */
export const HIRES_ARTIST = 'Multi-Format Hires';
/** Source cover edge length (px) for the high-resolution variant. */
export const HIRES_COVER_SIZE = 1024;

/**
 * Generate the multi-format set with a high-resolution (1024px) embedded cover.
 * Same track table as the embedded variant but the cover is larger than every
 * device's `artworkMaxResolution`, so the resize matrix can observe a real
 * downscale (embedded-art devices shrink the file cover to their max; iPod
 * leaves the file cover at source size and resizes only the iTunesDB thumbnail).
 */
export async function generateMultiFormatEmbeddedHires(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: HIRES_ARTIST,
    albumSuffix: ' (Hires)',
    embedded: true,
    sidecar: false,
    coverColor: '#4ad9d9',
    coverSize: HIRES_COVER_SIZE,
    sentinelLabel: 'multi-format-embedded-hires',
  });
}

// ---------------------------------------------------------------------------
// Compilation variant (various-artist album)
// ---------------------------------------------------------------------------

/** Shared album tag for the compilation variant. */
export const COMPILATION_ALBUM = 'Various Artists Compilation';
/** Shared `album_artist` tag for the compilation variant. */
export const COMPILATION_ALBUM_ARTIST = 'Various Artists';

/**
 * Per-track artist for the compilation variant — distinct per track (so the
 * album-cache's `(artist, album)` key isolates each one) yet sharing a single
 * album. Derived from the format token in the title so no two are substrings
 * of one another. e.g. `WAV Test Track` → `VA WAV`.
 */
export function compilationArtist(title: string): string {
  return `VA ${title.split(' ')[0]}`;
}

/**
 * Titles that ship WITHOUT embedded art in the compilation variant. WAV / OGG
 * / Opus are deliberately left bare so the album-cache split is observable:
 * with differing per-track artists, these tracks cannot inherit an
 * embed-capable sibling's cover the way they would in a single-artist album.
 */
const COMPILATION_NONEMBED_TITLES: ReadonlySet<string> = new Set([
  'WAV Test Track',
  'OGG Test Track',
  'Opus Test Track',
]);

/** Whether the compilation variant embeds art in the track with this title. */
export function compilationTrackEmbeds(title: string): boolean {
  return !COMPILATION_NONEMBED_TITLES.has(title);
}

/**
 * Distinct, well-separated cover colour per embed-capable compilation track, so
 * each track's cover is uniquely identifiable on the device. Lets the matrix
 * *prove* the album cache gave each track its own cover (no collision) rather
 * than inferring it from the `(artist, album)` key — a coarser key would make
 * all tracks share one colour. Saturated + far apart so the lossy
 * JPEG→RGB565→resize round-trip still classifies unambiguously.
 */
const COMPILATION_COVER_COLORS: Readonly<Record<string, string>> = {
  'FLAC Test Track': '#e02020', // red
  'ALAC Test Track': '#20b020', // green
  'MP3 Test Track': '#2040e0', // blue
  'AAC Test Track': '#e0d020', // yellow
  'AIFF Test Track': '#c020c0', // magenta
};

/** Cover colour for an embed-capable compilation track, or undefined if bare. */
export function compilationCoverColor(title: string): string | undefined {
  return COMPILATION_COVER_COLORS[title];
}

/**
 * Generate the multi-format set as a various-artists compilation: every track
 * keeps its title but gets a distinct artist (`VA <FORMAT>`), and all tracks
 * share one album (`Various Artists Compilation`), a shared `album_artist`, and
 * the `compilation` flag. The embed-capable anchors (FLAC/ALAC/MP3/AAC/AIFF)
 * carry the cover; WAV/OGG/Opus are left bare. Used to exercise the album
 * artwork cache's `(artist, album)` keying for shared-album differing-artist
 * tracks (see doc-039 §"Concrete test gaps to close" #4).
 */
export async function generateMultiFormatCompilation(outputDir: string): Promise<void> {
  await generateMultiFormatWithArt(outputDir, {
    artist: COMPILATION_ALBUM_ARTIST,
    artistFor: (track) => compilationArtist(track.title),
    album: COMPILATION_ALBUM,
    albumArtist: COMPILATION_ALBUM_ARTIST,
    compilation: true,
    albumSuffix: '',
    embedded: true,
    embedTrack: (track) => compilationTrackEmbeds(track.title),
    // Each anchor gets its own distinct cover colour so the matrix can prove
    // no album-cache collision (each track keeps its own cover, not a sibling's).
    coverColorFor: (track) => compilationCoverColor(track.title) ?? '#d9a14a',
    sidecar: false,
    coverColor: '#d9a14a',
    sentinelLabel: 'multi-format-compilation',
  });
}
