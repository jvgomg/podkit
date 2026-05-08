/**
 * Integration tests for `collection music` / `collection video` runners.
 *
 * Calls runCollectionMusic / runCollectionVideo in-process with real fixture
 * directories. No CLI subprocess. Each test scopes its own CliContext via
 * runWithContext so the suite is concurrency-friendly across files.
 *
 * For built-binary smoke coverage see `packages/e2e-tests/src/commands/collection.e2e.test.ts`.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCollectionMusic, runCollectionVideo } from './collection.js';
import { OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
} from '../config/index.js';

const AUDIO_FIXTURES_PATH = resolve(__dirname, '../../../../test/fixtures/audio');
const VIDEO_FIXTURES_PATH = resolve(__dirname, '../../../../test/fixtures/video');

// =============================================================================
// Helpers
// =============================================================================

interface ContextOptions {
  music?: PodkitConfig['music'];
  video?: PodkitConfig['video'];
  defaults?: PodkitConfig['defaults'];
}

function makeContext(opts: ContextOptions = {}): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    music: opts.music ?? {},
    video: opts.video ?? {},
    devices: {},
    defaults: opts.defaults,
  };
  const globalOpts: GlobalOptions = {
    json: false,
    quiet: true,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
  };
  const configResult: LoadConfigResult = {
    config,
    configPath: undefined,
    configFileExists: false,
  };
  return { config, globalOpts, configResult };
}

interface CapturedOutput {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
}

function makeOut(json = false): CapturedOutput {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({
    mode: json ? 'json' : 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
  });
  return { out, stdout, stderr };
}

const musicConfig = (path: string): ContextOptions => ({
  music: { test: { path } },
  defaults: { music: 'test' },
});

const videoConfig = (path: string): ContextOptions => ({
  video: { test: { path } },
  defaults: { video: 'test' },
});

// =============================================================================
// collection music
// =============================================================================

describe('runCollectionMusic', () => {
  let emptyDir: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('scans directory and prints a tracks table by default format', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'table' }, out));
    expect(process.exitCode).toBe(0);
    const text = stdout.text();
    expect(text).toContain('Title');
    expect(text).toContain('Artist');
  });

  it('returns track metadata in JSON format with required fields', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(0);
    const tracks =
      stdout.json<
        Array<{
          title: string;
          artist: string;
          album: string;
          duration: number;
          durationFormatted: string;
        }>
      >();
    expect(Array.isArray(tracks)).toBe(true);
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      expect(track).toHaveProperty('title');
      expect(track).toHaveProperty('artist');
      expect(track).toHaveProperty('album');
      expect(typeof track.duration).toBe('number');
      expect(track.durationFormatted).toMatch(/^\d+:\d{2}$/);
    }
  });

  it('finds the known Harmony fixture with expected metadata', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'json' }, out));
    const tracks = stdout.json<Array<{ title: string; artist: string; album: string }>>();
    const harmony = tracks.find((t) => t.title === 'Harmony');
    expect(harmony).toBeDefined();
    expect(harmony!.artist).toBe('Podkit Test Generator');
    expect(harmony!.album).toBe('Synthetic Classics');
  });

  it('handles an empty directory by reporting "No tracks found"', async () => {
    const ctx = makeContext(musicConfig(emptyDir));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'table' }, out));
    expect(process.exitCode).toBe(0);
    expect(stdout.text()).toContain('No tracks found');
  });

  it('respects --format csv (header row + data rows)', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'csv' }, out));
    expect(process.exitCode).toBe(0);
    const lines = stdout.text().trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Artist');
    expect(lines[0]).toContain('Album');
  });

  it('respects --fields, returning only the requested keys', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () =>
      runCollectionMusic({ tracks: true, format: 'json', fields: 'title,artist' }, out)
    );
    expect(process.exitCode).toBe(0);
    const tracks = stdout.json<Array<Record<string, unknown>>>();
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]).toHaveProperty('title');
    expect(tracks[0]).toHaveProperty('artist');
    expect(tracks[0]).not.toHaveProperty('album');
  });

  // -------------------------------------------------------------------------
  // Coverage gaps from the audit (newly added)
  // -------------------------------------------------------------------------

  it('default mode is stats (no flag) and prints a stats heading', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ format: 'table' }, out));
    expect(process.exitCode).toBe(0);
    expect(stdout.text()).toContain("Music in collection 'test'");
  });

  it('--albums aggregates by album and emits JSON in JSON mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ albums: true, format: 'json' }, out));
    expect(process.exitCode).toBe(0);
    const albums = stdout.json<Array<{ album: string; tracks: number }>>();
    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]).toHaveProperty('album');
    expect(typeof albums[0]!.tracks).toBe('number');
  });

  it('--artists aggregates by artist and emits JSON in JSON mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionMusic({ artists: true, format: 'json' }, out));
    expect(process.exitCode).toBe(0);
    const artists = stdout.json<Array<{ artist: string; albums: number; tracks: number }>>();
    expect(artists.length).toBeGreaterThan(0);
    expect(artists[0]).toHaveProperty('artist');
    expect(typeof artists[0]!.tracks).toBe('number');
  });

  it('rejects --fields when not in --tracks mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () =>
      runCollectionMusic({ albums: true, fields: 'title', format: 'json' }, out)
    );
    expect(process.exitCode).toBe(1);
    expect(stdout.json<{ error: boolean; message: string }>()).toEqual({
      error: true,
      message: '--fields can only be used with --tracks',
    });
  });

  it('rejects an invalid field name', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () =>
      runCollectionMusic({ tracks: true, fields: 'title,bogus', format: 'json' }, out)
    );
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message.toLowerCase()).toContain('bogus');
  });
});

// =============================================================================
// collection music — error paths (resolver, missing path)
// =============================================================================

describe('runCollectionMusic error paths', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('reports an error when the collection path does not exist', async () => {
    const ctx = makeContext(musicConfig('/this/path/does/not/exist/ever'));
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message).toContain('does not exist');
    expect(err.message).toContain('/this/path/does/not/exist/ever');
  });

  it('reports an error for an unknown collection name', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () =>
      runCollectionMusic({ collection: 'nonexistent', tracks: true, format: 'json' }, out)
    );
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message.toLowerCase()).toContain('nonexistent');
  });

  it('reports an error when no default music collection is set', async () => {
    const ctx = makeContext({ music: { mylib: { path: AUDIO_FIXTURES_PATH } } });
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message.toLowerCase()).toMatch(/default|specify|collection/);
  });

  it('reports an error when no music collections are configured', async () => {
    const ctx = makeContext({});
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () => runCollectionMusic({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message.toLowerCase()).toMatch(/no.*collection|configured|add/);
  });
});

// =============================================================================
// collection video
// =============================================================================

// Resolve at module load so it.skipIf evaluates synchronously at registration.
const videoFixturesExist =
  existsSync(VIDEO_FIXTURES_PATH) && existsSync(join(VIDEO_FIXTURES_PATH, 'compatible-h264.mp4'));

describe('runCollectionVideo', () => {
  let emptyDir: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await rm(emptyDir, { recursive: true, force: true });
  });

  it.skipIf(!videoFixturesExist)('scans for video files and prints a Title column', async () => {
    const ctx = makeContext(videoConfig(VIDEO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionVideo({ tracks: true, format: 'table' }, out));
    expect(process.exitCode).toBe(0);
    expect(stdout.text()).toContain('Title');
  });

  it.skipIf(!videoFixturesExist)('returns video metadata in JSON', async () => {
    const ctx = makeContext(videoConfig(VIDEO_FIXTURES_PATH));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionVideo({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(0);
    const videos =
      stdout.json<Array<{ title: string; duration: number; durationFormatted: string }>>();
    expect(videos.length).toBeGreaterThan(0);
    for (const v of videos) {
      expect(v).toHaveProperty('title');
      expect(typeof v.duration).toBe('number');
      expect(v.durationFormatted).toMatch(/^\d+:\d{2}$/);
    }
  });

  it('handles an empty directory by reporting "No tracks found"', async () => {
    const ctx = makeContext(videoConfig(emptyDir));
    const { out, stdout } = makeOut();
    await runWithContext(ctx, () => runCollectionVideo({ tracks: true, format: 'table' }, out));
    expect(process.exitCode).toBe(0);
    expect(stdout.text()).toContain('No tracks found');
  });

  it('reports an error when no video collections are configured', async () => {
    const ctx = makeContext({});
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () => runCollectionVideo({ tracks: true, format: 'json' }, out));
    expect(process.exitCode).toBe(1);
    const err = stdout.json<{ error: boolean; message: string }>();
    expect(err.error).toBe(true);
    expect(err.message.toLowerCase()).toMatch(/no.*collection|configured|add/);
  });

  it('rejects --fields when not in --tracks mode', async () => {
    const ctx = makeContext(videoConfig(emptyDir));
    const { out, stdout } = makeOut(true);
    await runWithContext(ctx, () =>
      runCollectionVideo({ albums: true, fields: 'title', format: 'json' }, out)
    );
    expect(process.exitCode).toBe(1);
    expect(stdout.json<{ error: boolean; message: string }>()).toEqual({
      error: true,
      message: '--fields can only be used with --tracks',
    });
  });
});
