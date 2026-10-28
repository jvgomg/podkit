/**
 * Video quality reaches the video plan through runSync: configured global
 * and device quality apply without a CLI flag, and the flags keep their
 * precedence (`--video-quality` > `--quality` > device > global).
 *
 * The configured chain needs the device's capabilities, which are only
 * known after the device is open, so this runs against a real test iPod.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestIpod, TestModels } from '@podkit/gpod-testing';
import {
  ensureFixturesExist,
  getVideoFixturesDir,
  requireFFmpeg,
  requireGpodTool,
} from '@podkit/test-fixtures';
import { requireLibgpodNode } from '@podkit/libgpod-node';
import { runSync } from './sync.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type DeviceConfig,
  type PodkitConfig,
} from '../config/index.js';

requireFFmpeg();
requireGpodTool();
requireLibgpodNode();
ensureFixturesExist('video');

describe('runSync video quality resolution', () => {
  let ipod: Awaited<ReturnType<typeof createTestIpod>>;
  let videoDir: string;

  beforeAll(async () => {
    ipod = await createTestIpod({ model: TestModels.VIDEO_60GB, name: 'Video iPod' });
    videoDir = await mkdtemp(join(tmpdir(), 'podkit-video-quality-'));
    await copyFile(
      join(getVideoFixturesDir(), 'movie-with-metadata.mp4'),
      join(videoDir, 'Test Movie (2024).mp4')
    );
  });

  afterAll(async () => {
    await ipod?.cleanup();
    if (videoDir) await rm(videoDir, { recursive: true, force: true });
  });

  async function videoQualityLine(
    global: Partial<PodkitConfig>,
    device: DeviceConfig | undefined,
    flags: { quality?: string; videoQuality?: string } = {}
  ): Promise<string | undefined> {
    const config: PodkitConfig = {
      artwork: true,
      tips: false,
      transforms: DEFAULT_TRANSFORMS_CONFIG,
      videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
      devices: device ? { nano: { ...device, path: ipod.path } as DeviceConfig } : {},
      music: {},
      video: { films: { path: videoDir } },
      ...global,
    } as PodkitConfig;
    const ctx: CliContext = {
      config,
      globalOpts: {
        json: false,
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: false,
        device: device ? 'nano' : ipod.path,
      },
      configResult: { config, configPath: undefined, configFileExists: false },
    };
    const stdout = new BufferSink();
    const stderr = new BufferSink();
    const out = new OutputContext({
      mode: 'text',
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode: new BufferExitCodeSink(),
    });
    await runWithContext(ctx, () =>
      runAction(out, () =>
        runSync({ type: ['video'], collection: 'films', dryRun: true, ...flags } as never, out)
      )
    );
    const text = stdout.text();
    if (!text.includes('=== Video Sync Plan'))
      throw new Error(`no video plan:\n${text}\n${stderr.text()}`);
    const section = text.slice(text.indexOf('=== Video Sync Plan'));
    return section.split('\n').find((l) => l.startsWith('Quality:'));
  }

  it('applies the global quality without a CLI flag', async () => {
    expect(await videoQualityLine({ quality: 'low' }, undefined)).toBe('Quality: low');
  });

  it('applies the global videoQuality over the global quality', async () => {
    expect(await videoQualityLine({ quality: 'low', videoQuality: 'medium' }, undefined)).toBe(
      'Quality: medium'
    );
  });

  it('applies the device videoQuality over the global settings', async () => {
    expect(
      await videoQualityLine({ quality: 'low' }, { videoQuality: 'max' } as DeviceConfig)
    ).toBe('Quality: max');
  });

  it('lets --quality override the configured chain and --video-quality override --quality', async () => {
    const device = { videoQuality: 'max' } as DeviceConfig;
    expect(await videoQualityLine({ quality: 'low' }, device, { quality: 'medium' })).toBe(
      'Quality: medium'
    );
    expect(
      await videoQualityLine({ quality: 'low' }, device, { quality: 'medium', videoQuality: 'low' })
    ).toBe('Quality: low');
  });
});
