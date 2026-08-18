/**
 * Unit tests for the `device info` runner.
 *
 * The richer end-to-end coverage (real iPod fixtures, full status block)
 * lives in `device.integration.test.ts`. These tests target the deps seam
 * added in TASK-315 — they confirm that:
 *   - DEVICE_NOT_RESOLVED is thrown when no device can be resolved
 *   - the runner respects `deps.loadCore` (no real `@podkit/core` import)
 *   - the runner respects `deps.getDeviceManager` (no real USB walk)
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runDeviceInfo, type DeviceInfoDeps, DeviceErrorCodes } from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
} from '../config/index.js';

function makeContext(): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: {},
    music: {},
    video: {},
  };
  const globalOpts: GlobalOptions = {
    json: true,
    quiet: false,
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

function makeOut(mode: 'json' | 'text' = 'json') {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode,
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

function fakeManager(overrides: Partial<DeviceManager> = {}): DeviceManager {
  const base: Partial<DeviceManager> = {
    platform: 'test',
    isSupported: true,
    scan: async () => [],
    locate: async () => null,
  };
  return { ...base, ...overrides } as DeviceManager;
}

function run(ctx: CliContext, out: OutputContext, deps?: DeviceInfoDeps): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
}

interface InfoErrorJson {
  success: false;
  error: string;
  code: string;
}

describe('runDeviceInfo', () => {
  it('throws DEVICE_NOT_RESOLVED when no device specified and no default', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    let loadCoreCalled = false;
    const deps: DeviceInfoDeps = {
      loadCore: async () => {
        loadCoreCalled = true;
        return {} as typeof import('@podkit/core');
      },
    };
    await run(ctx, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<InfoErrorJson>();
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_NOT_RESOLVED);
    // The runner bails before touching `@podkit/core`.
    expect(loadCoreCalled).toBe(false);
  });

  it('honours deps.getDeviceManager — no real USB walk when device path is given', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const mount = await mkdtemp(join(tmpdir(), 'info-runner-'));

    try {
      // Simulate a path-mode invocation by patching globalOpts.device on the ctx
      const ctx = makeContext();
      ctx.globalOpts.device = mount;

      const { out, stdout, exitCode } = makeOut();

      let managerCalled = false;
      const deps: DeviceInfoDeps = {
        loadCore: async () =>
          ({
            isMusicMediaType: () => true,
            isVideoMediaType: () => false,
            checkReadiness: async () => ({ level: 'unknown', stages: [] }),
            ipodFromBlock: (block: unknown) => ({
              kind: 'ipod',
              block,
              matchedBy: 'block-only',
            }),
            IpodError: class IpodError extends Error {},
            getDeviceManager: () => fakeManager(),
          }) as unknown as typeof import('@podkit/core'),
        getDeviceManager: () => {
          managerCalled = true;
          return fakeManager({
            isSupported: true,
            locate: async () =>
              ({ volumeUuid: 'STUB-UUID', isMounted: false }) as Awaited<
                ReturnType<DeviceManager['locate']>
              >,
          });
        },
      };

      await run(ctx, out, deps);
      expect(managerCalled).toBe(true);
      // The runner doesn't throw on a non-fatal live-status failure — info
      // still emits a structured payload (success: true) describing what it
      // could observe. We only verify here that the seam was honoured.
      const raw = stdout.text();
      expect(raw.length).toBeGreaterThan(0);
      expect(exitCode.get()).toBeUndefined();
    } finally {
      await rm(mount, { recursive: true, force: true });
    }
  });

  // ── Identity source: cascade, never libgpod ──────────────────────────────
  //
  // The scenario these pin is a real, owned device: an iPod shuffle 2nd gen
  // whose serial suffix and product ID are in none of libgpod's tables, so
  // `getInfo().device.generation` is `'unknown'` while podkit's own cascade
  // resolves it exactly. `info` used to render both views at once and
  // contradict itself — naming the model in the header while reporting it as
  // unidentifiable, and unsyncable, further down.
  //
  // `openDevice` is stubbed only to keep native libgpod out of a unit test;
  // the identity + validation logic under test runs for real.

  /** libgpod's view of a device its tables cannot identify. */
  const libgpodBlindDevice = {
    modelName: 'iPod',
    modelNumber: null,
    generation: 'unknown',
    capacity: 0,
    supportsArtwork: false,
    supportsVideo: false,
    supportsPodcast: false,
  };

  const shuffle2g = {
    displayName: 'iPod shuffle 1GB Pink (2nd Generation)',
    generationId: 'shuffle_2g',
    family: 'iPod shuffle',
    ordinal: 2,
    checksumType: 'none',
    modelNumber: 'A947',
    capacityGb: 1,
    color: 'Pink',
    source: 'serial',
  };

  const shuffleCapabilities = {
    artworkSources: [],
    artworkMaxResolution: null,
    supportedAudioCodecs: ['aac', 'mp3'],
    supportsVideo: false,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };

  /**
   * Build `info` deps for a mounted iPod: libgpod's `getInfo()` view, the
   * cascade-resolved model `openDevice` hands back, and an optional readiness
   * model (which drives the access-tier / support lines).
   */
  function ipodDeps(opts: {
    libgpodDevice?: unknown;
    model: unknown;
    capabilities: unknown;
    readinessModel?: unknown;
  }): DeviceInfoDeps {
    const fakeIpod = {
      getInfo: () => ({ device: opts.libgpodDevice ?? libgpodBlindDevice }),
      close: () => {},
    };
    return {
      loadCore: async () =>
        ({
          isMusicMediaType: () => true,
          isVideoMediaType: () => false,
          checkReadiness: async () => ({
            level: 'ready',
            stages: [
              { stage: 'usb', status: 'pass', summary: 'connected' },
              { stage: 'database', status: 'pass', summary: 'ok' },
            ],
            ...(opts.readinessModel ? { deviceModel: opts.readinessModel } : {}),
          }),
          ipodFromBlock: (block: unknown) => ({
            kind: 'ipod',
            block,
            matchedBy: 'block-only',
          }),
          IpodError: class IpodError extends Error {},
          getDeviceManager: () => fakeManager(),
        }) as unknown as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager({ isSupported: true }),
      // Stubbed so the test doesn't load native libgpod. Everything it
      // returns mirrors what the real `openDevice` produces.
      openDevice: async () =>
        ({
          adapter: { getTracks: () => [], close: () => {} } as never,
          capabilities: opts.capabilities,
          deviceSupportsAlac: false,
          isIpodDevice: true,
          ipod: fakeIpod as never,
          ipodModel: opts.model,
        }) as never,
    };
  }

  async function withMount<T>(fn: (mount: string) => Promise<T>): Promise<T> {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const mount = await mkdtemp(join(tmpdir(), 'info-identity-'));
    try {
      return await fn(mount);
    } finally {
      await rm(mount, { recursive: true, force: true });
    }
  }

  interface InfoStatusJson {
    status?: {
      model?: { name?: string; number?: string | null; generationId?: string; capacity?: number };
      capabilities?: unknown;
      validation?: { supported: boolean; issues: Array<{ message: string; type: string }> };
    };
  }

  it('sources status.model from the cascade when libgpod cannot identify the device', async () => {
    await withMount(async (mount) => {
      const ctx = makeContext();
      ctx.globalOpts.device = mount;
      const { out, stdout, exitCode } = makeOut();

      await run(ctx, out, ipodDeps({ model: shuffle2g, capabilities: shuffleCapabilities }));

      expect(exitCode.get()).toBeUndefined();
      const json = JSON.parse(stdout.text()) as InfoStatusJson;
      expect(json.status?.model).toEqual({
        name: 'iPod shuffle 1GB Pink (2nd Generation)',
        number: 'A947',
        generationId: 'shuffle_2g',
        capacity: 1,
      });
      // libgpod's blind view contributes nothing.
      expect(stdout.text()).not.toContain('unknown');
      // The libgpod-derived capability block is gone entirely.
      expect(json.status?.capabilities).toBeUndefined();
    });
  });

  it('raises no validation issue for a syncable device libgpod cannot identify', async () => {
    await withMount(async (mount) => {
      const ctx = makeContext();
      ctx.globalOpts.device = mount;
      const { out, stdout } = makeOut();

      await run(ctx, out, ipodDeps({ model: shuffle2g, capabilities: shuffleCapabilities }));

      const json = JSON.parse(stdout.text()) as InfoStatusJson;
      expect(json.status?.validation).toEqual({ supported: true, issues: [] });
    });
  });

  it('never prints "Unknown Generation" for a device the cascade identified', async () => {
    await withMount(async (mount) => {
      const ctx = makeContext();
      ctx.globalOpts.device = mount;
      const { out, stdout } = makeOut('text');

      await run(ctx, out, ipodDeps({ model: shuffle2g, capabilities: shuffleCapabilities }));

      const text = stdout.text();
      expect(text).not.toContain('Unknown Generation');
      expect(text).not.toContain('cannot sync this device');
      expect(text).toContain('Model');
      expect(text).toContain('iPod shuffle 1GB Pink (2nd Generation)');
      // Negative capability bullets name the cascade model, not libgpod's.
      expect(text).toContain('- Artwork (not supported on iPod shuffle (2nd Generation))');
    });
  });

  it('reports the cascade refusal for a read-only generation instead of hiding it', async () => {
    // Read-only generations used to have their validation issues suppressed
    // wholesale, because the libgpod-derived issue ("could not identify this
    // model") contradicted the read-only framing beside it. The issue now
    // comes from the same resolved model as the framing, so it is shown.
    await withMount(async (mount) => {
      const ctx = makeContext();
      ctx.globalOpts.device = mount;
      const { out, stdout } = makeOut('text');

      const shuffle4g = {
        displayName: 'iPod shuffle (4th Generation)',
        generationId: 'shuffle_4g',
        family: 'iPod shuffle',
        ordinal: 4,
        checksumType: 'none',
        source: 'usb',
        unsupportedReason: {
          kind: 'unsupported-device',
          headline: 'iPod shuffle (4th Generation) is read-only in podkit.',
          docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
        },
      };

      await run(
        ctx,
        out,
        ipodDeps({
          model: shuffle4g,
          capabilities: shuffleCapabilities,
          readinessModel: {
            displayName: 'iPod shuffle (4th Generation)',
            generationId: 'shuffle_4g',
            checksumType: 'none',
            source: 'usb',
          },
        })
      );

      const text = stdout.text();
      expect(text).toContain('read-only');
      expect(text).toContain('iPod shuffle (4th Generation) is read-only in podkit.');
      expect(text).not.toContain('Unknown Generation');

      // Exactly once. The summary zone frames it as a limitation ("readable
      // and archivable"); repeating the same sentence under a ✗ marker would
      // read as a fault contradicting that framing.
      const occurrences = text.split(
        'iPod shuffle (4th Generation) is read-only in podkit.'
      ).length;
      expect(occurrences - 1).toBe(1);
    });
  });

  it('marks a device carrying an unsupported reason as unsupported in JSON', async () => {
    await withMount(async (mount) => {
      const ctx = makeContext();
      ctx.globalOpts.device = mount;
      const { out, stdout } = makeOut();

      await run(
        ctx,
        out,
        ipodDeps({
          model: {
            displayName: 'iPod nano (6th Generation)',
            generationId: 'nano_6g',
            family: 'iPod nano',
            ordinal: 6,
            checksumType: 'none',
            source: 'usb',
            unsupportedReason: {
              kind: 'unsupported-device',
              headline: 'podkit cannot sync the iPod nano (6th Generation).',
              details: ['It uses a database format podkit does not write.'],
              docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
            },
          },
          capabilities: shuffleCapabilities,
        })
      );

      const json = JSON.parse(stdout.text()) as InfoStatusJson;
      expect(json.status?.validation?.supported).toBe(false);
      expect(json.status?.validation?.issues).toHaveLength(1);
      expect(json.status?.validation?.issues[0]?.type).toBe('unsupported_device');
      expect(json.status?.validation?.issues[0]?.message).toContain(
        'cannot sync the iPod nano (6th Generation)'
      );
    });
  });
});
