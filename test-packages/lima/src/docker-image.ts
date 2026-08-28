/**
 * docker-image — build (or pull) the podkit Docker image *inside* the
 * device-harness Lima VM from the local Dockerfile and the prebuilt linux
 * binaries.
 *
 * The device-harness VM ships nerdctl + containerd and a native arm64 kernel,
 * so a single-arch (native) image build needs no buildx / QEMU / `--platform`.
 * This stages a build context that matches the layout the Dockerfile expects
 * (the same layout CI assembles), then runs `nerdctl build` inside the VM.
 *
 * Context layout staged in the VM (rooted at {@link BUILD_CONTEXT_VM_DIR}):
 *
 *   packages/podkit-docker/Dockerfile     — the build recipe (`-f` target)
 *   packages/podkit-docker/entrypoint.sh  — COPYed to /entrypoint.sh
 *   bin/<arch>/podkit                     — COPYed to /usr/local/bin/podkit
 *   bin/<arch>/podkit-daemon              — COPYed to /usr/local/bin/podkit-daemon
 *
 * The Dockerfile keys its per-arch COPY on `ARG TARGETARCH`. buildx sets that
 * automatically from `--platform`; plain `nerdctl build` does not, so this
 * runner passes `--build-arg TARGETARCH=<imageArch>` explicitly.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import { limactlError, runLimactl, shellQuote } from './limactl.js';
import { FILE_COPY_TIMEOUT_MS } from './transport.js';
import { repoRoot } from './paths.js';
import { LIMA_DEVICE_HARNESS_VM_NAME } from './registry.js';
import {
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultPodkitMuslBinary,
} from './binary-paths.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default image tag produced by {@link buildPodkitImageInVm}. */
export const DEFAULT_PODKIT_IMAGE_TAG = 'podkit:docker-dist';
/**
 * Env var that switches the docker-dist image source from `local-build` (build
 * in-VM from the current musl binaries) to `pull:<tag>` (pull a pre-built image
 * from a registry). Set it to a fully-qualified tag — e.g.
 * `ghcr.io/jvgomg/podkit:edge` — to run the harness against the actual
 * GHA-built artifact instead of a local build. The same env name + semantics
 * are honoured by the host (tier-4 loopback) runner's `ensurePodkitImageOnHost`
 * so one variable drives both surfaces. Unset → local build.
 */
export const DOCKER_DIST_IMAGE_ENV = 'PODKIT_DOCKER_DIST_IMAGE';
/** In-VM directory that holds the staged build context. */
export const BUILD_CONTEXT_VM_DIR = '/tmp/podkit-image-ctx';
/** Fixed VERSION build-arg for the local Tier-5 build (CI supplies the real one). */
const DOCKER_DIST_VERSION = '0.0.0-docker-dist';
/** Relative path (inside the context) of the Dockerfile, matching CI. */
const DOCKERFILE_REL = 'packages/podkit-docker/Dockerfile';
/** Relative path (inside the context) of the entrypoint, matching the Dockerfile COPY. */
const ENTRYPOINT_REL = 'packages/podkit-docker/entrypoint.sh';

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// Bounded per call site, not per module — same rule as `./lifecycle.js` and
// `./transport.js`, and for the same reason: a bound that fires on a legitimate
// slow operation is worse than no bound at all.
//
// The build path is a long tail hanging off a series of very short steps. The
// short ones (`systemctl start`, `mkdir -p`, `chmod`, `rm -rf`, `nerdctl image
// inspect`, `nerdctl system prune`) all complete in well under a second on the
// harness VM and are bounded here. The two that legitimately run for minutes —
// `nerdctl build` and `nerdctl pull` — are not, and say so at their call sites.
//
// Every bound is passed through `runLimactl`, which owns the descriptive
// `timed out after Nms` message.
// ---------------------------------------------------------------------------

/**
 * Bound for the short in-VM steps that bracket the build: `systemctl start`,
 * `mkdir -p`, `chmod +x`, `rm -rf` of the staged context, and `nerdctl image
 * inspect`.
 *
 * None of these does meaningful work. Measured on the device-harness VM they
 * land between 69 ms and 310 ms — including genuinely cold starts of
 * `containerd` and `buildkit`, both `Type=notify`, at ~110 ms each, and an
 * `rm -rf` of a context holding 230 MB of staged binaries at 77 ms (unlinking
 * four files is metadata work, not data movement).
 *
 * So the bound is not sized off the operation at all; it is sized off how far
 * the one SSH round trip in front of it can stretch on a loaded host. That is
 * the same reasoning — and deliberately the same value — as the persona daemon
 * units in `@podkit/device-testing`. Two orders of magnitude above the measured
 * worst case: anything slower is a wedged `limactl shell`, not a slow `mkdir`.
 */
export const VM_HOUSEKEEPING_TIMEOUT_MS = 45_000;

/**
 * Bound for `nerdctl system prune -af`.
 *
 * Separated from {@link VM_HOUSEKEEPING_TIMEOUT_MS} because its cost is the one
 * in this group that scales with something: the size of the containerd content
 * store and the buildkit cache. It still scales gently, because clearing them
 * is unlinking blobs rather than moving bytes — measured at 267 ms against a
 * populated store (a 353 MB image plus its build cache).
 *
 * The store cannot outgrow the harness VM's 20 GB disk, so extrapolating that
 * rate to a full disk stays well under a minute even allowing an order of
 * magnitude for a store made of many small blobs. Two minutes is therefore
 * roughly two full-disk prunes' worth of headroom; past it, buildkitd is not
 * answering rather than the store being large.
 */
export const IMAGE_PRUNE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

/** Options for {@link buildPodkitImageInVm}. */
export interface BuildPodkitImageInVmOpts {
  /** Lima instance name. Defaults to {@link LIMA_DEVICE_HARNESS_VM_NAME}. */
  vmName?: string;
  /** Image tag. Defaults to {@link DEFAULT_PODKIT_IMAGE_TAG}. */
  tag?: string;
  /**
   * Architecture the image targets — drives both the host binary paths and the
   * `TARGETARCH` build-arg / `bin/<arch>/…` COPY paths. Defaults to `arm64`
   * (the native arch of the device-harness VM on Apple Silicon).
   */
  imageArch?: 'arm64' | 'amd64';
  /** Force a rebuild even if the tag already exists in the VM. */
  force?: boolean;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/** Result of {@link buildPodkitImageInVm}. */
export interface BuildPodkitImageInVmResult {
  /** The image tag that now exists in the VM. */
  tag: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read `.version` from a host package.json; throws with a clear message on failure. */
async function readPackageVersion(pkgJsonPath: string): Promise<string> {
  let raw: unknown;
  try {
    raw = await Bun.file(pkgJsonPath).json();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`buildPodkitImageInVm: cannot read version from ${pkgJsonPath} (${cause})`);
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`buildPodkitImageInVm: ${pkgJsonPath} has no string "version" field`);
  }
  return version;
}

/**
 * Host binary path resolvers keyed by arch. The image is always `FROM
 * alpine:3.21` (musl), so these resolve the **musl** binaries — the glibc ones
 * cannot start in the container. The default resolvers read `process.arch`;
 * when the caller requests a non-native `imageArch` we resolve the per-arch
 * musl path directly instead.
 */
function hostCliBinaryPath(arch: 'arm64' | 'amd64'): string {
  const suffix = arch === 'arm64' ? 'arm64' : 'x64';
  return path.resolve(repoRoot(), 'packages', 'podkit-cli', 'bin', `podkit-linux-${suffix}-musl`);
}

function hostDaemonBinaryPath(arch: 'arm64' | 'amd64'): string {
  const suffix = arch === 'arm64' ? 'arm64' : 'x64';
  return path.resolve(
    repoRoot(),
    'packages',
    'podkit-daemon',
    'bin',
    `podkit-daemon-linux-${suffix}-musl`
  );
}

/** `systemctl start <unit>` in the VM (idempotent — no-op if already active). */
async function startUnit(
  subprocess: SubprocessRunner,
  vmName: string,
  unit: string
): Promise<void> {
  const start = await runLimactl(
    subprocess,
    ['shell', vmName, '--', 'sudo', 'systemctl', 'start', unit],
    { timeoutMs: VM_HOUSEKEEPING_TIMEOUT_MS }
  );
  if (start.exitCode !== 0) {
    throw limactlError(`failed to start ${unit}.service in ${vmName}`, start);
  }
}

/**
 * Ensure the container runtime services `nerdctl build` depends on are up.
 *
 * The device-harness VM ships containerd + buildkit as systemd units, but
 * they're `disabled` by default (the harness's primary job is USB-gadget
 * testing, not containers). `nerdctl build` needs both: containerd for the
 * image store and buildkitd for the build backend.
 */
async function ensureContainerServices(
  subprocess: SubprocessRunner,
  vmName: string
): Promise<void> {
  for (const unit of ['containerd', 'buildkit']) {
    await startUnit(subprocess, vmName, unit);
  }
}

/** Copy a single host file into the VM at `vmDest`, creating parent dirs first. */
async function copyIntoVm(
  subprocess: SubprocessRunner,
  vmName: string,
  hostPath: string,
  vmDest: string
): Promise<void> {
  if (!fs.existsSync(hostPath)) {
    throw new Error(`buildPodkitImageInVm: host file not found: ${hostPath}`);
  }
  const parent = path.posix.dirname(vmDest);
  const mkdir = await runLimactl(subprocess, ['shell', vmName, '--', 'mkdir', '-p', parent], {
    timeoutMs: VM_HOUSEKEEPING_TIMEOUT_MS,
  });
  if (mkdir.exitCode !== 0) {
    throw limactlError(`failed to mkdir ${parent} in ${vmName}`, mkdir);
  }
  // The payload here is a ~120 MB compiled binary, which is exactly the case
  // `FILE_COPY_TIMEOUT_MS` is derived from — share it rather than restate it.
  const copy = await runLimactl(subprocess, ['copy', hostPath, `${vmName}:${vmDest}`], {
    timeoutMs: FILE_COPY_TIMEOUT_MS,
  });
  if (copy.exitCode !== 0) {
    throw limactlError(`failed to copy ${hostPath} → ${vmName}:${vmDest}`, copy);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the podkit Docker image inside the device-harness Lima VM.
 *
 * Steps:
 *   1. Idempotency: unless `force`, skip if `nerdctl image inspect <tag>` succeeds.
 *   2. Stage a fresh build context under {@link BUILD_CONTEXT_VM_DIR} with the
 *      layout the Dockerfile expects (Dockerfile, entrypoint, `bin/<arch>/…`).
 *   3. `chmod +x` the binaries in-VM.
 *   4. `nerdctl system prune -af` (disk guard on the small harness disk).
 *   5. `nerdctl build` with cwd = the context dir. Native arch, no buildx.
 *
 * @returns the tag now present in the VM.
 */
export async function buildPodkitImageInVm(
  opts: BuildPodkitImageInVmOpts = {}
): Promise<BuildPodkitImageInVmResult> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  const tag = opts.tag ?? DEFAULT_PODKIT_IMAGE_TAG;
  const imageArch = opts.imageArch ?? 'arm64';

  // 0. Ensure containerd + buildkit are running — nerdctl needs both, and the
  //    harness VM leaves them disabled by default.
  await ensureContainerServices(subprocess, vmName);

  // 1. Idempotency: skip when the image already exists and force is falsy.
  if (!opts.force) {
    const inspect = await runLimactl(
      subprocess,
      ['shell', vmName, '--', 'sudo', 'nerdctl', 'image', 'inspect', tag],
      { timeoutMs: VM_HOUSEKEEPING_TIMEOUT_MS }
    );
    if (inspect.exitCode === 0) {
      return { tag };
    }
  }

  // Resolve host inputs. The image is Alpine/musl, so we ALWAYS stage the musl
  // binaries (glibc binaries can't start in the container). The musl resolvers
  // honour env overrides for the host's native arch; for an explicit
  // non-native imageArch we resolve the musl path by suffix.
  const nativeArch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const cliBinary =
    imageArch === nativeArch ? resolveDefaultPodkitMuslBinary() : hostCliBinaryPath(imageArch);
  const daemonBinary =
    imageArch === nativeArch
      ? resolveDefaultDaemonLinuxMuslBinary()
      : hostDaemonBinaryPath(imageArch);
  const dockerfileHost = path.resolve(repoRoot(), DOCKERFILE_REL);
  const entrypointHost = path.resolve(repoRoot(), ENTRYPOINT_REL);

  const cliVersion = await readPackageVersion(
    path.resolve(repoRoot(), 'packages', 'podkit-cli', 'package.json')
  );
  const daemonVersion = await readPackageVersion(
    path.resolve(repoRoot(), 'packages', 'podkit-daemon', 'package.json')
  );
  const buildDate = new Date().toISOString();

  // 2. Stage a fresh context. Wipe any prior context so a stale binary can't
  //    leak into the build.
  const rm = await runLimactl(
    subprocess,
    ['shell', vmName, '--', 'rm', '-rf', BUILD_CONTEXT_VM_DIR],
    { timeoutMs: VM_HOUSEKEEPING_TIMEOUT_MS }
  );
  if (rm.exitCode !== 0) {
    throw limactlError(`failed to clear ${BUILD_CONTEXT_VM_DIR} in ${vmName}`, rm);
  }

  const cliVmPath = path.posix.join(BUILD_CONTEXT_VM_DIR, 'bin', imageArch, 'podkit');
  const daemonVmPath = path.posix.join(BUILD_CONTEXT_VM_DIR, 'bin', imageArch, 'podkit-daemon');
  const dockerfileVmPath = path.posix.join(BUILD_CONTEXT_VM_DIR, DOCKERFILE_REL);
  const entrypointVmPath = path.posix.join(BUILD_CONTEXT_VM_DIR, ENTRYPOINT_REL);

  await copyIntoVm(subprocess, vmName, dockerfileHost, dockerfileVmPath);
  await copyIntoVm(subprocess, vmName, entrypointHost, entrypointVmPath);
  await copyIntoVm(subprocess, vmName, cliBinary, cliVmPath);
  await copyIntoVm(subprocess, vmName, daemonBinary, daemonVmPath);

  // 3. chmod +x the binaries in-VM (limactl copy does not preserve mode).
  const chmod = await runLimactl(
    subprocess,
    ['shell', vmName, '--', 'chmod', '+x', cliVmPath, daemonVmPath],
    { timeoutMs: VM_HOUSEKEEPING_TIMEOUT_MS }
  );
  if (chmod.exitCode !== 0) {
    throw limactlError(`failed to chmod binaries in ${vmName}`, chmod);
  }

  // 4. Disk guard: prune dangling images/containers/build cache before build.
  const prune = await runLimactl(
    subprocess,
    ['shell', vmName, '--', 'sudo', 'nerdctl', 'system', 'prune', '-af'],
    { timeoutMs: IMAGE_PRUNE_TIMEOUT_MS }
  );
  if (prune.exitCode !== 0) {
    throw limactlError(`nerdctl system prune failed in ${vmName}`, prune);
  }

  // 5. Build. cwd = the context dir; `-f` points at the staged Dockerfile.
  //    TARGETARCH must be passed explicitly (no buildx to infer it).
  const buildCmd = [
    'sudo',
    'nerdctl',
    'build',
    '--build-arg',
    `VERSION=${DOCKER_DIST_VERSION}`,
    '--build-arg',
    `CLI_VERSION=${cliVersion}`,
    '--build-arg',
    `DAEMON_VERSION=${daemonVersion}`,
    '--build-arg',
    `BUILD_DATE=${buildDate}`,
    '--build-arg',
    `TARGETARCH=${imageArch}`,
    '-t',
    tag,
    '-f',
    DOCKERFILE_REL,
    '.',
  ]
    .map(shellQuote)
    .join(' ');

  // No `timeoutMs`: this is the genuinely open-ended call in the module. A
  // cold build pulls the Alpine base over the network, copies ~230 MB of
  // binaries into layers and writes them to the content store; a warm one with
  // the buildkit cache primed is a fraction of that. Measured end to end
  // (including the base-image pull) at ~29s on this host, but the network leg
  // is not something a wall clock can bound honestly, and aborting a build
  // mid-flight leaves the caller reasoning about a partial image. Liveness is
  // the right instrument here, and callers that want it inject the provisioning
  // runner through the `subprocess` seam.
  const build = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sh',
    '-c',
    `cd ${shellQuote(BUILD_CONTEXT_VM_DIR)} && ${buildCmd}`,
  ]);
  if (build.exitCode !== 0) {
    const tail = (build.stderr || build.stdout).trim().split('\n').slice(-25).join('\n');
    throw new Error(
      `buildPodkitImageInVm: nerdctl build failed in ${vmName} (exit=${build.exitCode}):\n${tail}`
    );
  }

  return { tag };
}

// ---------------------------------------------------------------------------
// Pull path (Stage 2 — run the harness against the real GHA-built artifact)
// ---------------------------------------------------------------------------

/** Options for {@link pullPodkitImageInVm}. */
export interface PullPodkitImageInVmOpts {
  /** Fully-qualified image tag to pull, e.g. `ghcr.io/jvgomg/podkit:edge`. */
  tag: string;
  /** Lima instance name. Defaults to {@link LIMA_DEVICE_HARNESS_VM_NAME}. */
  vmName?: string;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/**
 * Pull a pre-built podkit image into the device-harness Lima VM.
 *
 * The image lives at `ghcr.io/jvgomg/podkit`, which is a **public** package —
 * anonymous pull works, so there is no `nerdctl login` / read-token step. Only
 * `containerd` is needed (the image store); `buildkit` is a build-time
 * dependency and is deliberately not started here.
 *
 * @returns the tag now present in the VM.
 */
export async function pullPodkitImageInVm(
  opts: PullPodkitImageInVmOpts
): Promise<BuildPodkitImageInVmResult> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  const tag = opts.tag?.trim();
  if (!tag) {
    throw new Error('pullPodkitImageInVm: a non-empty image tag is required');
  }

  await startUnit(subprocess, vmName, 'containerd');

  // No `timeoutMs`, for the same reason as `nerdctl build`: the dominant term
  // is a registry fetch of a multi-hundred-megabyte image over whatever
  // connection the developer happens to be on. Any wall clock tight enough to
  // catch a wedged pull would abort a legitimate one on a slow link.
  const pull = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'nerdctl',
    'pull',
    tag,
  ]);
  if (pull.exitCode !== 0) {
    throw limactlError(`failed to pull image ${tag} in ${vmName}`, pull);
  }

  return { tag };
}

/** Options for {@link ensurePodkitImageInVm}. */
export interface EnsurePodkitImageInVmOpts {
  /** Force a fresh local build (ignored on the pull path). */
  force?: boolean;
  /** Lima instance name. Defaults to {@link LIMA_DEVICE_HARNESS_VM_NAME}. */
  vmName?: string;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/**
 * Resolve the docker-dist image the VM suite should run against, honouring the
 * {@link DOCKER_DIST_IMAGE_ENV} switch:
 *
 *   - env set   → pull that tag ({@link pullPodkitImageInVm}) — Stage 2, the
 *     real GHA-built artifact.
 *   - env unset → build in-VM from the current musl binaries
 *     ({@link buildPodkitImageInVm}) — Stage 1, the fast dev loop.
 *
 * @returns the resolved image tag the container steps must reference.
 */
export async function ensurePodkitImageInVm(opts: EnsurePodkitImageInVmOpts = {}): Promise<string> {
  const override = process.env[DOCKER_DIST_IMAGE_ENV]?.trim();
  if (override) {
    const { tag } = await pullPodkitImageInVm({
      tag: override,
      vmName: opts.vmName,
      subprocess: opts.subprocess,
    });
    return tag;
  }
  const { tag } = await buildPodkitImageInVm({
    force: opts.force,
    vmName: opts.vmName,
    subprocess: opts.subprocess,
  });
  return tag;
}
