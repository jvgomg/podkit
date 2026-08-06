/**
 * Unit tests for the host-side docker-dist image source switch — the pull path
 * and the `ensurePodkitImageOnHost` build-vs-pull routing. Mirror of the
 * VM-side `lima-docker-image.test.ts`: inject a fake `docker` runner via the
 * `HostDockerRunner` seam and assert argv + routing. No real Docker.
 *
 * The build path itself (`buildPodkitImageOnHost`) is exercised by the
 * docker-loopback e2e; here we only assert the routing and the pull mechanics.
 */

import { describe, it, expect, afterEach } from 'bun:test';

import {
  pullPodkitImageOnHost,
  ensurePodkitImageOnHost,
  DOCKER_DIST_IMAGE_ENV,
  type HostDockerRunner,
} from './podkit-image.js';

/** A fake docker runner that records argv and returns canned stdout. */
function fakeRunner(stdout = ''): { run: HostDockerRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      return stdout;
    },
  };
}

afterEach(() => {
  delete process.env[DOCKER_DIST_IMAGE_ENV];
});

describe('pullPodkitImageOnHost', () => {
  const TAG = 'ghcr.io/jvgomg/podkit:edge';

  it('runs `docker pull <tag>` and returns the tag', async () => {
    const { run, calls } = fakeRunner();
    const result = await pullPodkitImageOnHost(TAG, run);
    expect(result).toBe(TAG);
    expect(calls).toEqual([['pull', TAG]]);
  });

  it('rejects an empty tag without touching docker', async () => {
    const { run, calls } = fakeRunner();
    await expect(pullPodkitImageOnHost('   ', run)).rejects.toThrow(/non-empty image tag/);
    expect(calls).toHaveLength(0);
  });

  it('propagates a docker pull failure', async () => {
    const failing: HostDockerRunner = async () => {
      throw new Error('manifest unknown');
    };
    await expect(pullPodkitImageOnHost(TAG, failing)).rejects.toThrow(/manifest unknown/);
  });
});

describe('ensurePodkitImageOnHost', () => {
  it('pulls the override tag when the env switch is set', async () => {
    const override = 'ghcr.io/jvgomg/podkit:edge';
    process.env[DOCKER_DIST_IMAGE_ENV] = override;
    const { run, calls } = fakeRunner();

    const tag = await ensurePodkitImageOnHost({ dockerRunner: run });

    expect(tag).toBe(override);
    expect(calls).toEqual([['pull', override]]);
  });

  it('ignores options.tag on the pull path (env tag wins)', async () => {
    process.env[DOCKER_DIST_IMAGE_ENV] = 'ghcr.io/jvgomg/podkit:edge';
    const { run, calls } = fakeRunner();

    const tag = await ensurePodkitImageOnHost({ tag: 'podkit:loopback-test', dockerRunner: run });

    expect(tag).toBe('ghcr.io/jvgomg/podkit:edge');
    expect(calls).toEqual([['pull', 'ghcr.io/jvgomg/podkit:edge']]);
  });

  // The unset / whitespace-env → build routing is NOT unit-tested here: the
  // build branch calls the real `buildPodkitImageOnHost` (docker build + musl
  // binaries) and stubbing it would only re-assert the trivial `?.trim()`
  // switch that the VM-side twin already covers. The host build path is
  // exercised end-to-end by the docker-loopback e2e.
});
