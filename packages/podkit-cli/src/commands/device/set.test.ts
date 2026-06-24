/**
 * Unit tests for `podkit device set` — per-device default collection options.
 *
 * Drives the real Commander subcommand against a temp config file written to
 * disk, then asserts the resulting TOML. The device name is taken from the
 * global `--device` context, matching production wiring.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setSubcommand } from './set.js';
import { setContext, clearContext } from '../../context.js';
import type { PodkitConfig } from '../../config/index.js';

let tempDir: string;
let configPath: string;
let savedExitCode: typeof process.exitCode;

/**
 * Seed a config file + context for a device. `type` defaults to a mass-storage
 * preset; pass `'ipod'` to exercise the non-gated path. `music`/`video` are the
 * collection names that should exist in the config.
 */
function seed(opts: {
  device: string;
  type?: string;
  music?: string[];
  video?: string[];
  deviceLines?: string[];
}): void {
  const music = opts.music ?? ['main'];
  const video = opts.video ?? [];
  const type = opts.type ?? 'echo-mini';

  let toml = `version = 2\n\n[devices.${opts.device}]\ntype = "${type}"\n`;
  for (const line of opts.deviceLines ?? []) {
    toml += `${line}\n`;
  }
  for (const name of music) {
    toml += `\n[music.${name}]\npath = "/music/${name}"\n`;
  }
  for (const name of video) {
    toml += `\n[video.${name}]\npath = "/video/${name}"\n`;
  }
  fs.writeFileSync(configPath, toml);

  const config: PodkitConfig = {
    music: Object.fromEntries(music.map((n) => [n, { path: `/music/${n}` }])),
    video: Object.fromEntries(video.map((n) => [n, { path: `/video/${n}` }])),
    devices: { [opts.device]: { type: type as any } },
  } as any;

  setContext({
    config,
    globalOpts: {
      json: false,
      quiet: true,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      device: opts.device,
    } as any,
    configResult: {
      config,
      configPath,
      configFileExists: true,
    } as any,
  });
}

async function run(args: string[]): Promise<void> {
  await setSubcommand.parseAsync(['node', 'set', ...args]);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-device-set-test-'));
  configPath = path.join(tempDir, 'config.toml');
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  clearContext();
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
});

describe('device set — default music collection', () => {
  it('writes --default-music <name> when the collection exists', async () => {
    seed({ device: 'mini', music: ['main'] });

    await run(['--default-music', 'main']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultMusic = "main"');
  });

  it('writes false for --no-default-music', async () => {
    seed({ device: 'mini', music: ['main'] });

    await run(['--no-default-music']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultMusic = false');
    expect(content).not.toContain('defaultMusic = "false"');
  });

  it('removes the value for --clear-default-music', async () => {
    seed({
      device: 'mini',
      music: ['main'],
      deviceLines: ['defaultMusic = "main"'],
    });

    await run(['--clear-default-music']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('defaultMusic');
  });

  it('lets --clear-default-music win when both clear and set are passed', async () => {
    seed({
      device: 'mini',
      music: ['main', 'other'],
      deviceLines: ['defaultMusic = "main"'],
    });

    // Both flags passed; clear takes precedence over the set value.
    await run(['--clear-default-music', '--default-music', 'other']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('defaultMusic');
  });

  it('errors and lists available collections for a missing --default-music name', async () => {
    seed({ device: 'mini', music: ['main', 'archive'] });

    await run(['--default-music', 'ghost']);

    expect(process.exitCode).toBe(1);
    // No write should have happened.
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('defaultMusic');
  });
});

describe('device set — default video collection', () => {
  it('writes --default-video <name> when the collection exists', async () => {
    seed({ device: 'mini', video: ['movies'] });

    await run(['--default-video', 'movies']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultVideo = "movies"');
  });

  it('writes false for --no-default-video', async () => {
    seed({ device: 'mini', video: ['movies'] });

    await run(['--no-default-video']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultVideo = false');
    // Must be the TOML boolean, not the string "false" (which would reload as
    // a collection literally named "false").
    expect(content).not.toContain('defaultVideo = "false"');
  });

  it('errors for a missing --default-video name', async () => {
    seed({ device: 'mini', video: ['movies'] });

    await run(['--default-video', 'ghost']);

    expect(process.exitCode).toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('defaultVideo');
  });
});

describe('device set — default collections are not mass-storage-gated', () => {
  it('accepts --default-music on a non-mass-storage iPod device', async () => {
    seed({ device: 'terapod', type: 'ipod', music: ['main'] });

    await run(['--default-music', 'main']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultMusic = "main"');
  });

  it('accepts --no-default-video on a non-mass-storage iPod device', async () => {
    seed({ device: 'terapod', type: 'ipod', video: ['movies'] });

    await run(['--no-default-video']);

    expect(process.exitCode).not.toBe(1);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defaultVideo = false');
  });
});

describe('device set — no-updates guard', () => {
  it('errors when no options are passed', async () => {
    seed({ device: 'mini', music: ['main'] });

    await run([]);

    expect(process.exitCode).toBe(1);
  });
});
