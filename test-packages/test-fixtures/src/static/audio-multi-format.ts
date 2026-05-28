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

  const coverPath = join(outputDir, 'cover.jpg');
  if (opts.embedded || opts.sidecar) {
    await generateCoverJpeg(coverPath, opts.coverColor);
  }

  // Pre-compute the Vorbis-comment cover blob once per album; OGG and Opus
  // tracks share it. (Hot-loop reuse: building the base64 is cheap but
  // re-reading the JPEG per track is wasteful.)
  const vorbisCoverValue = opts.embedded ? await buildMetadataBlockPicture(coverPath) : '';

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    const albumTag = `${track.albumCategory}${opts.albumSuffix}`;
    const embedThis = opts.embedded;
    const meta = metadataArgs({
      title: track.title,
      artist: opts.artist,
      album: albumTag,
      track: track.track,
      date: COMMON.date,
      genre: COMMON.genre,
    });

    const args: string[] = [];
    if (embedThis && track.embedStrategy === 'attached_pic') {
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
    args.push('-ar', String(track.sampleRate), '-ac', '2', ...track.extraArgs, ...meta);
    if (embedThis && track.embedStrategy === 'vorbis_comment') {
      // libvorbis / libopus accept the FLAC PICTURE block as a Vorbis
      // comment via the standard -metadata key=value path.
      args.push('-metadata', `METADATA_BLOCK_PICTURE=${vorbisCoverValue}`);
    }
    args.push(outPath);

    await runFfmpeg(args);

    if (embedThis && track.embedStrategy === 'wav_id3_chunk') {
      // ffmpeg's WAV muxer refuses video streams, so the tag is spliced in
      // after the audio is written. We mirror title/artist/album into the
      // ID3 frames because TagLib (Navidrome) prefers ID3 over the LIST INFO
      // chunk ffmpeg already wrote and would otherwise see the track as
      // Unknown. See injectId3v2ApicIntoWav() for the RIFF chunk layout.
      await injectId3v2ApicIntoWav(outPath, coverPath, {
        title: track.title,
        artist: opts.artist,
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

/** Exposed so the matrix tests can build the expected `Artist - Title` strings. */
export { SCENARIO_ARTISTS };
