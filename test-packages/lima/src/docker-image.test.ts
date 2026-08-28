/**
 * Unit tests for the docker-dist image source switch — the pull path and the
 * `ensurePodkitImageInVm` build-vs-pull selection. Strategy mirrors the other
 * substrate tests: inject a scripted `SubprocessRunner` that records `limactl`
 * invocations and returns canned results. No real `limactl`, no VM.
 *
 * The build path itself (`buildPodkitImageInVm`) is exercised end-to-end by the
 * vm-docker-image e2e; here we only assert the *routing* and the pull mechanics.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildPodkitImageInVm,
  pullPodkitImageInVm,
  ensurePodkitImageInVm,
  DEFAULT_PODKIT_IMAGE_TAG,
  DOCKER_DIST_IMAGE_ENV,
  VM_HOUSEKEEPING_TIMEOUT_MS,
  IMAGE_PRUNE_TIMEOUT_MS,
} from './docker-image.js';
import { FILE_COPY_TIMEOUT_MS } from './transport.js';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

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

afterEach(() => {
  delete process.env[DOCKER_DIST_IMAGE_ENV];
});

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

describe('ensurePodkitImageInVm — build-vs-pull routing', () => {
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
    const { runner, calls } = makeScriptedRunner([ok(), ok(), ok()]);

    const tag = await ensurePodkitImageInVm({ subprocess: runner });

    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(calls.some((c) => vmCommand(c).includes('pull'))).toBe(false);
  });

  it('builds locally (default tag) when the env switch is unset', async () => {
    const { runner, calls } = makeScriptedRunner([ok(), ok(), ok()]);

    const tag = await ensurePodkitImageInVm({ subprocess: runner });

    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(vmCommand(calls[0]!)).toEqual(['sudo', 'systemctl', 'start', 'containerd']);
    expect(vmCommand(calls[1]!)).toEqual(['sudo', 'systemctl', 'start', 'buildkit']);
    expect(calls.some((c) => vmCommand(c).includes('pull'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// The build path is a long tail hanging off a series of very short steps. The
// short ones must be bounded — an unbounded `mkdir` behind a wedged SSH session
// blocks with no output and nothing naming what is being waited on. The long
// ones must NOT be, because a bound that fires on a legitimate slow build is
// worse than no bound at all.
//
// Every assertion here reads the `opts` the injected runner was handed, which
// is the same object `runLimactl` forwards — so it also pins that these calls
// go through the wrapper that owns the descriptive `timed out after Nms`
// message, rather than spawning `limactl` directly.
// ---------------------------------------------------------------------------

/** Stub host binaries so the build path can run without a real compile. */
function withStubbedMuslBinaries(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-image-bounds-'));
  const cli = path.join(dir, 'podkit');
  const daemon = path.join(dir, 'podkit-daemon');
  fs.writeFileSync(cli, '#!/bin/sh\n');
  fs.writeFileSync(daemon, '#!/bin/sh\n');
  const priorCli = process.env['PODKIT_LINUX_MUSL_BINARY'];
  const priorDaemon = process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY'];
  process.env['PODKIT_LINUX_MUSL_BINARY'] = cli;
  process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY'] = daemon;
  return {
    dir,
    restore() {
      if (priorCli === undefined) delete process.env['PODKIT_LINUX_MUSL_BINARY'];
      else process.env['PODKIT_LINUX_MUSL_BINARY'] = priorCli;
      if (priorDaemon === undefined) delete process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY'];
      else process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY'] = priorDaemon;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Find the single recorded call whose in-VM argv contains every fragment. */
function callWith(calls: ScriptedCall[], ...fragments: string[]): ScriptedCall {
  const match = calls.filter((call) => fragments.every((f) => call.args.includes(f)));
  if (match.length !== 1) {
    throw new Error(
      `expected exactly one call containing [${fragments.join(', ')}], found ${match.length}`
    );
  }
  return match[0]!;
}

describe('docker-image wall-clock bounds', () => {
  it('bounds `systemctl start` on the pull path', async () => {
    const { runner, calls } = makeScriptedRunner([ok(), ok()]);
    await pullPodkitImageInVm({ tag: 'ghcr.io/jvgomg/podkit:edge', subprocess: runner });
    expect(callWith(calls, 'systemctl', 'containerd').opts?.timeoutMs).toBe(
      VM_HOUSEKEEPING_TIMEOUT_MS
    );
  });

  // A registry fetch of a multi-hundred-megabyte image over whatever connection
  // the developer is on. No wall clock is simultaneously tight enough to catch
  // a wedge and loose enough to spare a legitimate pull on a slow link.
  it('leaves `nerdctl pull` unbounded', async () => {
    const { runner, calls } = makeScriptedRunner([ok(), ok()]);
    await pullPodkitImageInVm({ tag: 'ghcr.io/jvgomg/podkit:edge', subprocess: runner });
    expect(callWith(calls, 'pull').opts?.timeoutMs).toBeUndefined();
  });

  it('bounds the image-existence probe on the idempotency check', async () => {
    const { runner, calls } = makeScriptedRunner([ok(), ok(), ok()]);
    const tag = await ensurePodkitImageInVm({ subprocess: runner });
    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(callWith(calls, 'inspect').opts?.timeoutMs).toBe(VM_HOUSEKEEPING_TIMEOUT_MS);
  });

  describe('the full build path', () => {
    let stubs: ReturnType<typeof withStubbedMuslBinaries>;
    beforeAll(() => {
      stubs = withStubbedMuslBinaries();
    });
    afterAll(() => stubs.restore());

    async function recordBuild(): Promise<ScriptedCall[]> {
      const { runner, calls } = makeScriptedRunner(Array.from({ length: 20 }, () => ok()));
      await buildPodkitImageInVm({
        force: true,
        imageArch: process.arch === 'arm64' ? 'arm64' : 'amd64',
        subprocess: runner,
      });
      return calls;
    }

    it('bounds every short housekeeping step', async () => {
      const calls = await recordBuild();
      for (const fragments of [
        ['systemctl', 'containerd'],
        ['systemctl', 'buildkit'],
        ['rm', '-rf'],
        ['chmod', '+x'],
      ]) {
        expect(callWith(calls, ...fragments).opts?.timeoutMs).toBe(VM_HOUSEKEEPING_TIMEOUT_MS);
      }
      const mkdirs = calls.filter((call) => call.args.includes('mkdir'));
      expect(mkdirs.length).toBeGreaterThan(0);
      for (const mkdir of mkdirs) {
        expect(mkdir.opts?.timeoutMs).toBe(VM_HOUSEKEEPING_TIMEOUT_MS);
      }
    });

    it('bounds each staged file copy on the shared transport bound', async () => {
      const calls = await recordBuild();
      const copies = calls.filter((call) => call.args[0] === 'copy');
      // Dockerfile, entrypoint, CLI binary, daemon binary.
      expect(copies).toHaveLength(4);
      for (const copy of copies) {
        expect(copy.opts?.timeoutMs).toBe(FILE_COPY_TIMEOUT_MS);
      }
    });

    // Prune scales with the content store rather than being constant-time like
    // the housekeeping steps, so it carries its own (larger) bound.
    it('bounds the prune separately from the housekeeping steps', async () => {
      const calls = await recordBuild();
      expect(callWith(calls, 'prune').opts?.timeoutMs).toBe(IMAGE_PRUNE_TIMEOUT_MS);
      expect(IMAGE_PRUNE_TIMEOUT_MS).toBeGreaterThan(VM_HOUSEKEEPING_TIMEOUT_MS);
    });

    // The genuinely open-ended call: a cold build pulls a base image over the
    // network and writes hundreds of megabytes of layers, and aborting one
    // mid-flight leaves the caller reasoning about a partial image.
    it('leaves `nerdctl build` unbounded', async () => {
      const calls = await recordBuild();
      const build = calls.at(-1)!;
      expect(build.args.at(-1)).toContain('nerdctl');
      expect(build.args.at(-1)).toContain('build');
      expect(build.opts?.timeoutMs).toBeUndefined();
    });
  });
});
