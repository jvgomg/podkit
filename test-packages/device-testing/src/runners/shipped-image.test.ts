/**
 * Unit tests for building and pulling the shipped image inside the substrate.
 *
 * The seam is the {@link SubstrateLink}: every assertion reads what the module
 * asked the link to do, so the same assertions hold whichever provisioner sits
 * behind it. The build itself is exercised end to end by the vm-docker-image
 * suites; here we pin the routing, the per-runtime differences, the context
 * layout and the wall-clock bounds.
 */

import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FILE_COPY_TIMEOUT_MS,
  TARGET_ARCH_ENV_VAR,
  targetArch,
  type SubstrateCommand,
  type SubstrateCopyOpts,
  type SubstrateExecOpts,
  type SubstrateExecResult,
  type SubstrateLink,
} from '@podkit/substrate';

import {
  buildPodkitImageInVm,
  ensurePodkitImageInVm,
  pullPodkitImageInVm,
  BUILD_CONTEXT_VM_DIR,
  DEFAULT_PODKIT_IMAGE_TAG,
  DOCKER_DIST_IMAGE_ENV,
  IMAGE_PRUNE_TIMEOUT_MS,
} from './shipped-image.js';
import { SUBSTRATE_ROUND_TRIP_TIMEOUT_MS } from './substrate.js';

// ---------------------------------------------------------------------------
// A link that records what it was asked to do
// ---------------------------------------------------------------------------

interface ExecCall {
  argv: string[];
  opts: SubstrateExecOpts;
}

interface CopyCall {
  hostPath: string;
  guestPath: string;
  opts: SubstrateCopyOpts;
}

type Responder = (argv: string[]) => SubstrateExecResult | undefined;

const ok = (stdout = ''): SubstrateExecResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string, exitCode = 1): SubstrateExecResult => ({
  stdout: '',
  stderr,
  exitCode,
});

function recordingLink(respond: Responder = () => undefined): {
  link: SubstrateLink;
  execs: ExecCall[];
  copies: CopyCall[];
} {
  const execs: ExecCall[] = [];
  const copies: CopyCall[] = [];
  const link: SubstrateLink = {
    substrateId: 'fake',
    description: 'a recording link',
    async exec(command: SubstrateCommand, opts: SubstrateExecOpts = {}) {
      if (typeof command === 'string') throw new Error(`expected argv, got "${command}"`);
      const argv = [...command];
      execs.push({ argv, opts });
      return respond(argv) ?? (argv[0] === 'uname' ? ok(substrateMachine()) : ok());
    },
    async copyIn(hostPath, guestPath, opts = {}) {
      copies.push({ hostPath, guestPath, opts });
    },
    async copyOut() {
      throw new Error('copyOut is never used by the image module');
    },
    async stageTree() {
      throw new Error('stageTree is never used by the image module');
    },
    spawn() {
      throw new Error('spawn is never used by the image module');
    },
  };
  return { link, execs, copies };
}

/** The single exec whose argv contains every fragment. */
function execWith(execs: ExecCall[], ...fragments: string[]): ExecCall {
  const match = execs.filter((call) => fragments.every((f) => call.argv.includes(f)));
  if (match.length !== 1) {
    throw new Error(
      `expected exactly one exec containing [${fragments.join(', ')}], found ${match.length}: ` +
        JSON.stringify(execs.map((c) => c.argv))
    );
  }
  return match[0]!;
}

/** By default the substrate is whatever the run targets, spelled as `uname -m` would. */
const substrateMachine = (): string => (targetArch() === 'arm64' ? 'aarch64\n' : 'x86_64\n');

/** Image-existence probe reports "absent", so a build proceeds. */
const imageAbsent: Responder = (argv) =>
  argv.includes('inspect') ? fail('no such image') : undefined;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TOUCHED_ENV = [
  DOCKER_DIST_IMAGE_ENV,
  TARGET_ARCH_ENV_VAR,
  'PODKIT_LINUX_MUSL_BINARY',
  'PODKIT_DAEMON_LINUX_MUSL_BINARY',
];
let savedEnv: Record<string, string | undefined>;
let stubDir: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(TOUCHED_ENV.map((k) => [k, process.env[k]]));
  delete process.env[DOCKER_DIST_IMAGE_ENV];
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-shipped-image-'));
  const cli = path.join(stubDir, 'podkit');
  const daemon = path.join(stubDir, 'podkit-daemon');
  fs.writeFileSync(cli, '#!/bin/sh\n');
  fs.writeFileSync(daemon, '#!/bin/sh\n');
  process.env['PODKIT_LINUX_MUSL_BINARY'] = cli;
  process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY'] = daemon;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(stubDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

describe('pullPodkitImageInVm', () => {
  const TAG = 'ghcr.io/jvgomg/podkit:rc';

  it('pulls with podman directly — it has no daemon to start', async () => {
    const { link, execs } = recordingLink();

    const result = await pullPodkitImageInVm({ tag: TAG, runtime: 'podman', link });

    expect(result).toEqual({ tag: TAG });
    expect(execs.map((c) => c.argv)).toEqual([['sudo', 'podman', 'pull', TAG]]);
  });

  it('starts containerd, and only containerd, before a nerdctl pull', async () => {
    const { link, execs } = recordingLink();

    await pullPodkitImageInVm({ tag: TAG, runtime: 'nerdctl', link });

    expect(execs.map((c) => c.argv)).toEqual([
      ['sudo', 'systemctl', 'start', 'containerd'],
      ['sudo', 'nerdctl', 'pull', TAG],
    ]);
  });

  it('rejects an empty tag before touching the substrate', async () => {
    const { link, execs } = recordingLink();
    await expect(pullPodkitImageInVm({ tag: '   ', runtime: 'podman', link })).rejects.toThrow(
      /non-empty image tag/
    );
    expect(execs).toHaveLength(0);
  });

  it('throws with the runtime stderr when the pull fails', async () => {
    const { link } = recordingLink((argv) =>
      argv.includes('pull') ? fail('manifest unknown') : undefined
    );
    await expect(pullPodkitImageInVm({ tag: TAG, runtime: 'podman', link })).rejects.toThrow(
      /failed to pull image .*rc.*manifest unknown/s
    );
  });

  it('throws when a runtime service will not start', async () => {
    const { link } = recordingLink((argv) =>
      argv.includes('systemctl') ? fail('unit not found') : undefined
    );
    await expect(pullPodkitImageInVm({ tag: TAG, runtime: 'nerdctl', link })).rejects.toThrow(
      /failed to start containerd/
    );
  });
});

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

describe('buildPodkitImageInVm', () => {
  it('skips the build when the tag already exists and force is not set', async () => {
    const { link, execs, copies } = recordingLink();

    const result = await buildPodkitImageInVm({ runtime: 'podman', link });

    expect(result).toEqual({ tag: DEFAULT_PODKIT_IMAGE_TAG });
    expect(execs.map((c) => c.argv)).toEqual([
      ['sudo', 'podman', 'image', 'inspect', DEFAULT_PODKIT_IMAGE_TAG],
    ]);
    expect(copies).toHaveLength(0);
  });

  it('stages the context the Dockerfile expects, keyed on the target architecture', async () => {
    process.env[TARGET_ARCH_ENV_VAR] = 'x86_64';
    const { link, copies } = recordingLink(imageAbsent);

    await buildPodkitImageInVm({ runtime: 'podman', link });

    expect(copies.map((c) => c.guestPath)).toEqual([
      `${BUILD_CONTEXT_VM_DIR}/packages/podkit-docker/Dockerfile`,
      `${BUILD_CONTEXT_VM_DIR}/packages/podkit-docker/entrypoint.sh`,
      `${BUILD_CONTEXT_VM_DIR}/bin/amd64/podkit`,
      `${BUILD_CONTEXT_VM_DIR}/bin/amd64/podkit-daemon`,
    ]);
    expect(copies[2]!.hostPath).toBe(process.env['PODKIT_LINUX_MUSL_BINARY']!);
    expect(copies[3]!.hostPath).toBe(process.env['PODKIT_DAEMON_LINUX_MUSL_BINARY']!);
  });

  it('builds from the context directory with TARGETARCH set explicitly', async () => {
    process.env[TARGET_ARCH_ENV_VAR] = 'aarch64';
    const { link, execs } = recordingLink(imageAbsent);

    await buildPodkitImageInVm({ runtime: 'podman', tag: 'podkit:x', link });

    const build = execWith(execs, 'build');
    expect(build.argv.slice(0, 3)).toEqual(['sudo', 'podman', 'build']);
    expect(build.argv).toContain('TARGETARCH=arm64');
    expect(build.argv.slice(-5)).toEqual([
      '-t',
      'podkit:x',
      '-f',
      'packages/podkit-docker/Dockerfile',
      '.',
    ]);
    expect(build.opts.cwd).toBe(BUILD_CONTEXT_VM_DIR);
  });

  it('starts no services for podman, and containerd + buildkit for nerdctl', async () => {
    const podman = recordingLink(imageAbsent);
    await buildPodkitImageInVm({ runtime: 'podman', link: podman.link });
    expect(podman.execs.some((c) => c.argv.includes('systemctl'))).toBe(false);

    const nerdctl = recordingLink(imageAbsent);
    await buildPodkitImageInVm({ runtime: 'nerdctl', link: nerdctl.link });
    const started = nerdctl.execs
      .filter((c) => c.argv.includes('systemctl'))
      .map((c) => c.argv.at(-1));
    expect(started).toEqual(['containerd', 'buildkit']);
    expect(execWith(nerdctl.execs, 'build').argv.slice(0, 3)).toEqual(['sudo', 'nerdctl', 'build']);
  });

  it('refuses to build for an architecture the substrate is not, before staging', async () => {
    process.env[TARGET_ARCH_ENV_VAR] = 'aarch64';
    const { link, execs, copies } = recordingLink((argv) =>
      argv[0] === 'uname' ? ok('x86_64\n') : imageAbsent(argv)
    );

    await expect(buildPodkitImageInVm({ runtime: 'podman', link })).rejects.toThrow(
      /targets arm64, but .* is x64/
    );
    expect(copies).toHaveLength(0);
    expect(execs.some((c) => c.argv.includes('build'))).toBe(false);
  });

  it('refuses a missing host binary before building', async () => {
    process.env['PODKIT_LINUX_MUSL_BINARY'] = path.join(stubDir, 'absent');
    const { link, execs } = recordingLink(imageAbsent);

    await expect(buildPodkitImageInVm({ runtime: 'podman', force: true, link })).rejects.toThrow(
      /host file not found: .*absent/
    );
    expect(execs.some((c) => c.argv.includes('build'))).toBe(false);
  });

  it('surfaces the tail of the build output when the build fails', async () => {
    const { link } = recordingLink((argv) =>
      argv.includes('build') ? fail('step 3/9: COPY failed: no such file') : undefined
    );
    await expect(buildPodkitImageInVm({ runtime: 'podman', force: true, link })).rejects.toThrow(
      /podman build failed .*COPY failed/s
    );
  });
});

// ---------------------------------------------------------------------------
// Build-vs-pull routing
// ---------------------------------------------------------------------------

describe('ensurePodkitImageInVm', () => {
  it('pulls the override tag with the requested runtime when the switch is set', async () => {
    process.env[DOCKER_DIST_IMAGE_ENV] = 'ghcr.io/jvgomg/podkit:rc';
    const { link, execs } = recordingLink();

    const tag = await ensurePodkitImageInVm({ runtime: 'podman', link });

    expect(tag).toBe('ghcr.io/jvgomg/podkit:rc');
    expect(execs.at(-1)!.argv).toEqual(['sudo', 'podman', 'pull', 'ghcr.io/jvgomg/podkit:rc']);
  });

  it('treats a whitespace-only switch as unset and builds', async () => {
    process.env[DOCKER_DIST_IMAGE_ENV] = '   ';
    const { link, execs } = recordingLink();

    const tag = await ensurePodkitImageInVm({ runtime: 'podman', link });

    expect(tag).toBe(DEFAULT_PODKIT_IMAGE_TAG);
    expect(execs.some((c) => c.argv.includes('pull'))).toBe(false);
  });

  it('builds under the requested tag when the switch is unset', async () => {
    const { link, execs } = recordingLink(imageAbsent);

    const tag = await ensurePodkitImageInVm({
      runtime: 'podman',
      tag: 'podkit:loopback',
      force: true,
      link,
    });

    expect(tag).toBe('podkit:loopback');
    expect(execWith(execs, 'build').argv).toContain('podkit:loopback');
  });
});

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// The build is a long tail hanging off a series of very short steps. The short
// ones must be bounded — an unbounded `mkdir` behind a wedged session blocks
// with nothing naming what is being waited on. The long ones must NOT be,
// because a bound that fires on a legitimate slow build is worse than none.
// ---------------------------------------------------------------------------

describe('wall-clock bounds', () => {
  async function recordBuild(runtime: 'podman' | 'nerdctl') {
    const recorded = recordingLink();
    await buildPodkitImageInVm({ runtime, force: true, link: recorded.link });
    return recorded;
  }

  it('bounds every short housekeeping step on the round-trip budget', async () => {
    const { execs } = await recordBuild('nerdctl');
    for (const fragments of [
      ['systemctl', 'containerd'],
      ['systemctl', 'buildkit'],
      ['rm', '-rf'],
      ['chmod', '+x'],
    ]) {
      expect(execWith(execs, ...fragments).opts.timeoutMs).toBe(SUBSTRATE_ROUND_TRIP_TIMEOUT_MS);
    }
    const mkdirs = execs.filter((c) => c.argv.includes('mkdir'));
    expect(mkdirs.length).toBeGreaterThan(0);
    for (const mkdir of mkdirs) expect(mkdir.opts.timeoutMs).toBe(SUBSTRATE_ROUND_TRIP_TIMEOUT_MS);
  });

  it('bounds the image-existence probe', async () => {
    const { link, execs } = recordingLink();
    await buildPodkitImageInVm({ runtime: 'podman', link });
    expect(execWith(execs, 'inspect').opts.timeoutMs).toBe(SUBSTRATE_ROUND_TRIP_TIMEOUT_MS);
  });

  it('bounds each staged file copy on the shared copy bound', async () => {
    const { copies } = await recordBuild('podman');
    expect(copies).toHaveLength(4);
    for (const copy of copies) expect(copy.opts.timeoutMs).toBe(FILE_COPY_TIMEOUT_MS);
  });

  // Prune scales with the image store rather than being constant-time, so it
  // carries its own, larger bound.
  it('bounds the prune separately from the housekeeping steps', async () => {
    const { execs } = await recordBuild('podman');
    expect(execWith(execs, 'prune').opts.timeoutMs).toBe(IMAGE_PRUNE_TIMEOUT_MS);
    expect(IMAGE_PRUNE_TIMEOUT_MS).toBeGreaterThan(SUBSTRATE_ROUND_TRIP_TIMEOUT_MS);
  });

  it('leaves the build and the pull unbounded', async () => {
    const { execs } = await recordBuild('podman');
    expect(execWith(execs, 'build').opts.timeoutMs).toBeUndefined();

    const pulled = recordingLink();
    await pullPodkitImageInVm({
      tag: 'ghcr.io/jvgomg/podkit:rc',
      runtime: 'podman',
      link: pulled.link,
    });
    expect(execWith(pulled.execs, 'pull').opts.timeoutMs).toBeUndefined();
  });
});
