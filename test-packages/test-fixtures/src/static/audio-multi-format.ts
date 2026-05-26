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
import { join } from 'node:path';
import { requireEncoder } from '../encoder-guard.js';
import {
  ensureDir,
  generateCoverJpeg,
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
   * Whether the container can carry an attached-picture stream via the same
   * `-c:v mjpeg -disposition:v attached_pic` invocation used everywhere else.
   *
   * False for WAV and AIFF — ffmpeg's wav/aiff muxers reject video streams
   * outright. We still generate the audio file in those embedded scenarios;
   * the matrix then records device.hasArtwork=false as the expected outcome.
   */
  supportsAttachedPic: boolean;
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
    supportsAttachedPic: false,
  },
  {
    filename: '02-aiff-track.aiff',
    title: 'AIFF Test Track',
    albumCategory: 'Lossless Collection',
    track: 2,
    frequency: 523.25,
    encoder: 'pcm_s16be',
    sampleRate: 44100,
    extraArgs: [],
    supportsAttachedPic: false,
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
    supportsAttachedPic: true,
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
    supportsAttachedPic: true,
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
    supportsAttachedPic: true,
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
    supportsAttachedPic: true,
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
    // Embedded art in OGG/Opus uses METADATA_BLOCK_PICTURE in Vorbis comments
    // (base64-encoded FLAC PICTURE block). ffmpeg refuses to mux an image
    // stream into the OGG container directly, and producing the base64
    // payload manually is outside this generator's scope. The matrix records
    // the embedded scenario as expectedBroken for OGG/Opus.
    supportsAttachedPic: false,
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
    supportsAttachedPic: false,
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
  /** Suffix appended to each album category tag, e.g. ' (Embedded)' → 'Lossless Collection (Embedded)'. */
  albumSuffix: string;
  /** If true, embed the cover JPEG into the output file's attached_pic stream. */
  embedded: boolean;
  /** If true, write a `cover.jpg` sidecar next to the audio files. */
  sidecar: boolean;
  /** Colour of the generated cover JPEG. */
  coverColor: string;
  /** Label used by the sentinel file. */
  sentinelLabel: string;
}

/**
 * Core generator. All four public variants delegate here.
 *
 * When `embedded` is true, runs ffmpeg with the cover as an extra input and
 * the appropriate `-map` / `attached_pic` flags so the output file embeds
 * the image. For containers without standard art support (WAV, AIFF), ffmpeg
 * is asked to embed it anyway — whether the read-back round-trips is part of
 * what the matrix discovers.
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

  const coverPath = join(outputDir, 'cover.jpg');
  if (opts.embedded || opts.sidecar) {
    await generateCoverJpeg(coverPath, opts.coverColor);
  }

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    const albumTag = `${track.albumCategory}${opts.albumSuffix}`;
    const embedIntoThisTrack = opts.embedded && track.supportsAttachedPic;

    const args: string[] = [];
    if (embedIntoThisTrack) {
      // Cover is input 0 (image), audio is generated by lavfi as input 1.
      args.push(
        '-i',
        coverPath,
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
    args.push(
      '-ar',
      String(track.sampleRate),
      '-ac',
      '2',
      ...track.extraArgs,
      ...metadataArgs({
        title: track.title,
        artist: opts.artist,
        album: albumTag,
        track: track.track,
        date: COMMON.date,
        genre: COMMON.genre,
      }),
      outPath
    );

    await runFfmpeg(args);
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

/** Exposed so the matrix tests can build the expected `Artist - Title` strings. */
export { SCENARIO_ARTISTS };
