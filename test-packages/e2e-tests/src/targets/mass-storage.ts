/**
 * Mass-storage `SyncTarget` — a temp directory standing in for a USB DAP.
 *
 * No hardware: the device is a temp dir configured with a built-in preset
 * (echo-mini / rockbox / generic). `getTracks()` walks the preset's music
 * directory and ffprobes each file, normalising into the same `TrackInfo`
 * shape the iPod targets return so the matrix can read either backend
 * uniformly.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { TrackInfo } from '@podkit/gpod-testing';
import {
  BUILT_IN_PRESETS,
  type BuiltInPresetId,
  type MassStoragePreset,
} from '@podkit/devices-mass-storage';

import type { DeviceConfigFragment, SyncTarget } from './sync-target';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.flac',
  '.ogg',
  '.opus',
  '.wav',
  '.aiff',
  '.aif',
]);

interface FfprobeTags {
  title?: string;
  artist?: string;
  album?: string;
  track?: string;
}

interface FfprobeResult {
  format?: { tags?: Record<string, string>; bit_rate?: string; duration?: string };
  streams?: Array<{ codec_type?: string; sample_rate?: string }>;
}

/**
 * Lower-case the tag keys ffprobe returns. Vorbis comment field names
 * (FLAC/OGG) are case-insensitive *by spec*, and FFmpeg writes them upper-case
 * (`TITLE`/`ARTIST`) when it muxes a FLAC — so a case-sensitive `tags.title`
 * lookup would miss every copied FLAC. Normalising keys makes this reader
 * spec-compliant, which is all that's needed for track matching.
 *
 * Note this deliberately reads device files with ffprobe — an *independent*
 * tool — rather than podkit's own `music-metadata`. Reusing podkit's reader
 * would couple the verification to the system under test: a bug in podkit's
 * write path (or in music-metadata) could be mutually masked because the test
 * would interpret the bytes exactly as the code that wrote them did. Keep this
 * reader independent; just keep it spec-correct.
 */
function normalizeTags(raw: Record<string, string> | undefined): FfprobeTags {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    out[key.toLowerCase()] = value;
  }
  return out as FfprobeTags;
}

/** Recursively collect audio files under a directory. */
async function findAudioFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // directory doesn't exist yet (nothing synced)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findAudioFiles(full)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && AUDIO_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

async function ffprobe(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=bit_rate,duration:format_tags=title,artist,album,track:stream=codec_type,sample_rate',
    '-of',
    'json',
    filePath,
  ]);
  return JSON.parse(stdout) as FfprobeResult;
}

/**
 * A mass-storage device backed by a temp directory + a built-in preset.
 */
export class MassStorageTarget implements SyncTarget {
  readonly kind = 'mass-storage' as const;
  readonly isRealDevice = false;

  private constructor(
    readonly path: string,
    readonly name: string,
    readonly model: BuiltInPresetId,
    private readonly preset: MassStoragePreset,
    private readonly deviceName: string
  ) {}

  get capabilities(): MassStoragePreset {
    return this.preset;
  }

  static async create(options?: {
    preset?: BuiltInPresetId;
    name?: string;
    deviceName?: string;
  }): Promise<MassStorageTarget> {
    const preset = options?.preset ?? 'generic';
    const presetData = BUILT_IN_PRESETS[preset];
    const path = await mkdtemp(join(tmpdir(), `podkit-ms-${preset}-`));
    const name = options?.name ?? `Mass Storage (${preset})`;
    const deviceName = options?.deviceName ?? 'test';
    return new MassStorageTarget(path, name, preset, presetData, deviceName);
  }

  deviceConfig(): DeviceConfigFragment {
    return {
      name: this.deviceName,
      toml: `[devices.${this.deviceName}]\ntype = "${this.model}"\npath = "${this.path}"\n`,
    };
  }

  musicRoot(): string {
    const musicDir = this.preset.contentPaths.musicDir;
    return musicDir ? join(this.path, musicDir) : this.path;
  }

  async getTracks(): Promise<TrackInfo[]> {
    const musicDir = this.preset.contentPaths.musicDir;
    const searchRoot = musicDir ? join(this.path, musicDir) : this.path;
    const files = await findAudioFiles(searchRoot);

    const tracks: TrackInfo[] = [];
    let id = 1;
    for (const file of files) {
      let probe: FfprobeResult;
      try {
        probe = await ffprobe(file);
      } catch {
        continue; // skip unreadable files
      }
      const tags = normalizeTags(probe.format?.tags);
      const hasArtwork = (probe.streams ?? []).some((s) => s.codec_type === 'video');
      const audioStream = (probe.streams ?? []).find((s) => s.codec_type === 'audio');
      tracks.push({
        id: id++,
        title: tags.title ?? '',
        artist: tags.artist ?? null,
        album: tags.album ?? null,
        trackNumber: tags.track ? Number.parseInt(tags.track, 10) || 0 : 0,
        durationMs: probe.format?.duration
          ? Math.round(Number.parseFloat(probe.format.duration) * 1000)
          : 0,
        bitrate: probe.format?.bit_rate
          ? Math.round(Number.parseInt(probe.format.bit_rate, 10) / 1000)
          : 0,
        sampleRate: audioStream?.sample_rate ? Number.parseInt(audioStream.sample_rate, 10) : 0,
        size: 0,
        hasArtwork,
      });
    }
    return tracks;
  }

  async cleanup(): Promise<void> {
    try {
      await rm(this.path, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
