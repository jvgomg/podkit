/**
 * Integration tests for `collection music` / `collection video` runners.
 *
 * Calls runCollectionMusic / runCollectionVideo in-process with real fixture
 * directories. No CLI subprocess. Each test scopes its own CliContext via
 * runWithContext so the suite is concurrency-friendly across files.
 *
 * For built-binary smoke coverage see `test-packages/e2e-host-tests/src/commands/collection.e2e.test.ts`.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCollectionMusic, runCollectionVideo } from './collection.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { expectCliError } from '../test-utils/cli-error.js';
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
  exitCode: BufferExitCodeSink;
}

/**
 * Construct an OutputContext with buffered stdout/stderr and a buffered
 * exit-code sink. Tests assert on the captured buffers and never mutate
 * `process.exitCode` — that's what allows future `it.concurrent` use.
 */
function makeOut(json = false): CapturedOutput {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode: json ? 'json' : 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
    exitCode,
  });
  return { out, stdout, stderr, exitCode };
}

const musicConfig = (path: string): ContextOptions => ({
  music: { test: { path } },
  defaults: { music: 'test' },
});

const videoConfig = (path: string): ContextOptions => ({
  video: { test: { path } },
  defaults: { video: 'test' },
});

/**
 * Run a collection runner the same way production does — through runAction so
 * thrown CliErrors become structured output + process.exitCode mutation.
 * Tests assert on the captured stdout/stderr just like a JSON consumer would.
 */
function runMusic(
  ctx: CliContext,
  options: Parameters<typeof runCollectionMusic>[0],
  out: OutputContext
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runCollectionMusic(options, out)));
}

function runVideo(
  ctx: CliContext,
  options: Parameters<typeof runCollectionVideo>[0],
  out: OutputContext
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runCollectionVideo(options, out)));
}

// =============================================================================
// collection music
// =============================================================================

describe('runCollectionMusic', () => {
  let emptyDir: string;

  beforeEach(async () => {
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('scans directory and prints a tracks table by default format', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { tracks: true, format: 'table' }, out);
    expect(exitCode.get()).toBeUndefined();
    const text = stdout.text();
    expect(text).toContain('Title');
    expect(text).toContain('Artist');
  });

  it('returns track metadata in JSON format with required fields', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBeUndefined();
    const tracks = stdout.json<
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
    await runMusic(ctx, { tracks: true, format: 'json' }, out);
    const tracks = stdout.json<Array<{ title: string; artist: string; album: string }>>();
    const harmony = tracks.find((t) => t.title === 'Harmony');
    expect(harmony).toBeDefined();
    expect(harmony!.artist).toBe('Podkit Test Generator');
    expect(harmony!.album).toBe('Synthetic Classics');
  });

  it('handles an empty directory by reporting "No tracks found"', async () => {
    const ctx = makeContext(musicConfig(emptyDir));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { tracks: true, format: 'table' }, out);
    expect(exitCode.get()).toBeUndefined();
    expect(stdout.text()).toContain('No tracks found');
  });

  it('respects --format csv (header row + data rows)', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { tracks: true, format: 'csv' }, out);
    expect(exitCode.get()).toBeUndefined();
    const lines = stdout.text().trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Artist');
    expect(lines[0]).toContain('Album');
  });

  it('respects --fields, returning only the requested keys', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { tracks: true, format: 'json', fields: 'title,artist' }, out);
    expect(exitCode.get()).toBeUndefined();
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
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { format: 'table' }, out);
    expect(exitCode.get()).toBeUndefined();
    expect(stdout.text()).toContain("Music in collection 'test'");
  });

  it('--albums aggregates by album and emits JSON in JSON mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { albums: true, format: 'json' }, out);
    expect(exitCode.get()).toBeUndefined();
    const albums = stdout.json<Array<{ album: string; tracks: number }>>();
    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]).toHaveProperty('album');
    expect(typeof albums[0]!.tracks).toBe('number');
  });

  it('--artists aggregates by artist and emits JSON in JSON mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut();
    await runMusic(ctx, { artists: true, format: 'json' }, out);
    expect(exitCode.get()).toBeUndefined();
    const artists = stdout.json<Array<{ artist: string; albums: number; tracks: number }>>();
    expect(artists.length).toBeGreaterThan(0);
    expect(artists[0]).toHaveProperty('artist');
    expect(typeof artists[0]!.tracks).toBe('number');
  });

  it('rejects --fields when not in --tracks mode', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { albums: true, fields: 'title', format: 'json' }, out);
    expectCliError(stdout, exitCode, {
      code: 'INVALID_FIELDS_USAGE',
      error: '--fields can only be used with --tracks',
    });
  });

  it('rejects an invalid field name', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { tracks: true, fields: 'title,bogus', format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error.toLowerCase()).toContain('bogus');
  });
});

// =============================================================================
// collection music — error paths (resolver, missing path)
// =============================================================================

describe('runCollectionMusic error paths', () => {
  it('reports an error when the collection path does not exist', async () => {
    const ctx = makeContext(musicConfig('/this/path/does/not/exist/ever'));
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error).toContain('does not exist');
    expect(err.error).toContain('/this/path/does/not/exist/ever');
  });

  it('reports an error for an unknown collection name', async () => {
    const ctx = makeContext(musicConfig(AUDIO_FIXTURES_PATH));
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { collection: 'nonexistent', tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error.toLowerCase()).toContain('nonexistent');
  });

  it('reports an error when no default music collection is set', async () => {
    const ctx = makeContext({ music: { mylib: { path: AUDIO_FIXTURES_PATH } } });
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error.toLowerCase()).toMatch(/default|specify|collection/);
  });

  it('reports an error when no music collections are configured', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut(true);
    await runMusic(ctx, { tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error.toLowerCase()).toMatch(/no.*collection|configured|add/);
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

  beforeEach(async () => {
    emptyDir = join(tmpdir(), `podkit-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(emptyDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(emptyDir, { recursive: true, force: true });
  });

  // Video tests spawn ffprobe per fixture file; under parallel integration-test
  // pressure (libgpod + ffmpeg in sibling suites) the default 5s timeout is too
  // tight. Probe runs in ~300ms in isolation, ~3-4s under load.
  const VIDEO_PROBE_TIMEOUT_MS = 30000;

  it.skipIf(!videoFixturesExist)(
    'scans for video files and prints a Title column',
    async () => {
      const ctx = makeContext(videoConfig(VIDEO_FIXTURES_PATH));
      const { out, stdout, exitCode } = makeOut();
      await runVideo(ctx, { tracks: true, format: 'table' }, out);
      expect(exitCode.get()).toBeUndefined();
      expect(stdout.text()).toContain('Title');
    },
    VIDEO_PROBE_TIMEOUT_MS
  );

  it.skipIf(!videoFixturesExist)(
    'returns video metadata in JSON',
    async () => {
      const ctx = makeContext(videoConfig(VIDEO_FIXTURES_PATH));
      const { out, stdout, exitCode } = makeOut();
      await runVideo(ctx, { tracks: true, format: 'json' }, out);
      expect(exitCode.get()).toBeUndefined();
      const videos =
        stdout.json<Array<{ title: string; duration: number; durationFormatted: string }>>();
      expect(videos.length).toBeGreaterThan(0);
      for (const v of videos) {
        expect(v).toHaveProperty('title');
        expect(typeof v.duration).toBe('number');
        expect(v.durationFormatted).toMatch(/^\d+:\d{2}$/);
      }
    },
    VIDEO_PROBE_TIMEOUT_MS
  );

  it('handles an empty directory by reporting "No tracks found"', async () => {
    const ctx = makeContext(videoConfig(emptyDir));
    const { out, stdout, exitCode } = makeOut();
    await runVideo(ctx, { tracks: true, format: 'table' }, out);
    expect(exitCode.get()).toBeUndefined();
    expect(stdout.text()).toContain('No tracks found');
  });

  it('reports an error when no video collections are configured', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut(true);
    await runVideo(ctx, { tracks: true, format: 'json' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<{ success: false; error: string; code: string }>();
    expect(err.success).toBe(false);
    expect(err.error.toLowerCase()).toMatch(/no.*collection|configured|add/);
  });

  it('rejects --fields when not in --tracks mode', async () => {
    const ctx = makeContext(videoConfig(emptyDir));
    const { out, stdout, exitCode } = makeOut(true);
    await runVideo(ctx, { albums: true, fields: 'title', format: 'json' }, out);
    expectCliError(stdout, exitCode, {
      code: 'INVALID_FIELDS_USAGE',
      error: '--fields can only be used with --tracks',
    });
  });
});
