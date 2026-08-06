/**
 * Unit tests for the docker-dist image source switch — the pull path and the
 * `ensurePodkitImageInVm` build-vs-pull selection. Strategy mirrors the other
 * lima-test-vm runner tests: inject a scripted `SubprocessRunner` that records
 * `limactl` invocations and returns canned results. No real `limactl`, no VM.
 *
 * The build path itself (`buildPodkitImageInVm`) is exercised end-to-end by the
 * vm-docker-image e2e; here we only assert the *routing* and the pull mechanics.
 */

import { describe, it, expect, afterEach } from 'bun:test';

import {
  pullPodkitImageInVm,
  ensurePodkitImageInVm,
  DEFAULT_PODKIT_IMAGE_TAG,
  DOCKER_DIST_IMAGE_ENV,
} from './lima-docker-image.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Scripted SubprocessRunner
// ---------------------------------------------------------------------------

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });
const nonZero = (stderr: string, exitCode = 1): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode,
});

type Responder = SubprocessRunResult | ((call: ScriptedCall) => SubprocessRunResult);

function makeScriptedRunner(script: Responder[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        const call: ScriptedCall = { command, args, opts };
        calls.push(call);
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`unexpected subprocess call #${i}: ${command} ${args.join(' ')}`);
        }
        return typeof responder === 'function' ? responder(call) : responder;
      },
    },
  };
}

/** The final positional args of a `limactl shell <vm> -- sudo ...` invocation. */
function vmCommand(call: ScriptedCall): string[] {
  const dashDash = call.args.indexOf('--');
  return dashDash >= 0 ? call.args.slice(dashDash + 1) : call.args;
}

// ---------------------------------------------------------------------------
// env helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  delete process.env[DOCKER_DIST_IMAGE_ENV];
});

// ---------------------------------------------------------------------------
// pullPodkitImageInVm
// ---------------------------------------------------------------------------

describe('pullPodkitImageInVm', () => {
  const TAG = 'ghcr.io/jvgomg/podkit:edge';

  it('starts containerd then pulls the tag, returning it', async () => {
    const { runner, calls } = makeScriptedRunner([ok(), ok('done')]);

    const result = await pullPodkitImageInVm({ tag: TAG, subprocess: runner });

    expect(result).toEqual({ tag: TAG });
    expect(calls).toHaveLength(2);
    expect(vmCommand(calls[0]!)).toEqual(['sudo', 'systemctl', 'start', 'containerd']);
    expect(vmCommand(calls[1]!)).toEqual(['sudo', 'nerdctl', 'pull', TAG]);
    // Pull must NOT touch buildkit — it needs only the image store.
    expect(calls.some((c) => vmCommand(c).includes('buildkit'))).toBe(false);
  });

  it('rejects an empty tag before touching the VM', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    await expect(pullPodkitImageInVm({ tag: '   ', subprocess: runner })).rejects.toThrow(
      /non-empty image tag/
    );
    expect(calls).toHaveLength(0);
  });

  it('throws with the pull stderr when nerdctl pull fails', async () => {
    const { runner } = makeScriptedRunner([ok(), nonZero('manifest unknown')]);
    await expect(pullPodkitImageInVm({ tag: TAG, subprocess: runner })).rejects.toThrow(
      /failed to pull image .*edge.*manifest unknown/s
    );
  });

  it('throws when containerd will not start', async () => {
    const { runner } = makeScriptedRunner([nonZero('unit not found')]);
    await expect(pullPodkitImageInVm({ tag: TAG, subprocess: runner })).rejects.toThrow(
      /failed to start containerd/
    );
  });
});

// ---------------------------------------------------------------------------
// ensurePodkitImageInVm — build-vs-pull routing
// ---------------------------------------------------------------------------

describe('ensurePodkitImageInVm', () => {
  it('pulls the override tag when the env switch is set', async () => {
    const override = 'ghcr.io/jvgomg/podkit:edge';
    process.env[DOCKER_DIST_IMAGE_ENV] = override;
    const { runner, calls } = makeScriptedRunner([ok(), ok()]);

    const tag = await ensurePodkitImageInVm({ subprocess: runner });

    expect(tag).toBe(override);
    expect(vmCommand(calls.at(-1)!)).toEqual(['sudo', 'nerdctl', 'pull', override]);
  });

  it('trims whitespace-only env values back to the build path', async () => {
    process.env[DOCKER_DIST_IMAGE_ENV] = '   ';
    // Build path: ensureContainerServices (containerd, buildkit) then an image
    // inspect that succeeds → idempotent early return with the default tag. No
    // host files or real build needed.
    const { runner, calls } = makeScriptedRunner([ok(), ok(), ok()]);

    const tag = await ensurePodkitImageInVm({ subprocess: runner });

    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(calls.some((c) => vmCommand(c).includes('pull'))).toBe(false);
  });

  it('builds locally (default tag) when the env switch is unset', async () => {
    // containerd start, buildkit start, image inspect (exit 0 → already built).
    const { runner, calls } = makeScriptedRunner([ok(), ok(), ok()]);

    const tag = await ensurePodkitImageInVm({ subprocess: runner });

    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(vmCommand(calls[0]!)).toEqual(['sudo', 'systemctl', 'start', 'containerd']);
    expect(vmCommand(calls[1]!)).toEqual(['sudo', 'systemctl', 'start', 'buildkit']);
    expect(calls.some((c) => vmCommand(c).includes('pull'))).toBe(false);
  });
});
