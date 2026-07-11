/**
 * lima-docker-image — build the podkit Docker image *inside* the
 * `podkit-device-harness` Lima VM from the local Dockerfile and the prebuilt
 * linux binaries.
 *
 * The device-harness VM ships nerdctl + containerd and a native arm64 kernel,
 * so a single-arch (native) image build needs no buildx / QEMU / `--platform`.
 * This is the Tier-5 Docker scaffold: it stages a build context that matches
 * the layout {@link file://../../../../packages/podkit-docker/Dockerfile}
 * expects (the same layout CI assembles in `.github/workflows/docker.yml`),
 * then runs `nerdctl build` inside the VM.
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

import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl, shellQuote } from './lima-limactl.js';
import { repoRoot } from './paths.js';
import {
  LIMA_DEVICE_HARNESS_VM_NAME,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultPodkitMuslBinary,
} from './lima-test-vm.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default image tag produced by {@link buildPodkitImageInVm}. */
export const DEFAULT_PODKIT_IMAGE_TAG = 'podkit:tier5';
/** In-VM directory that holds the staged build context. */
export const BUILD_CONTEXT_VM_DIR = '/tmp/podkit-image-ctx';
/** Fixed VERSION build-arg for the local Tier-5 build (CI supplies the real one). */
const TIER5_VERSION = '0.0.0-tier5';
/** Relative path (inside the context) of the Dockerfile, matching CI. */
const DOCKERFILE_REL = 'packages/podkit-docker/Dockerfile';
/** Relative path (inside the context) of the entrypoint, matching the Dockerfile COPY. */
const ENTRYPOINT_REL = 'packages/podkit-docker/entrypoint.sh';

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

/**
 * Ensure the container runtime services `nerdctl build` depends on are up.
 *
 * The device-harness VM ships containerd + buildkit as systemd units, but
 * they're `disabled` by default (the harness's primary job is USB-gadget
 * testing, not containers). `nerdctl build` needs both: containerd for the
 * image store and buildkitd for the build backend. `systemctl start` is
 * idempotent — a no-op when the unit is already active.
 */
async function ensureContainerServices(
  subprocess: SubprocessRunner,
  vmName: string
): Promise<void> {
  for (const unit of ['containerd', 'buildkit']) {
    const start = await runLimactl(subprocess, [
      'shell',
      vmName,
      '--',
      'sudo',
      'systemctl',
      'start',
      unit,
    ]);
    if (start.exitCode !== 0) {
      throw limactlError(`failed to start ${unit}.service in ${vmName}`, start);
    }
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
  const mkdir = await runLimactl(subprocess, ['shell', vmName, '--', 'mkdir', '-p', parent]);
  if (mkdir.exitCode !== 0) {
    throw limactlError(`failed to mkdir ${parent} in ${vmName}`, mkdir);
  }
  const copy = await runLimactl(subprocess, ['copy', hostPath, `${vmName}:${vmDest}`]);
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
    const inspect = await runLimactl(subprocess, [
      'shell',
      vmName,
      '--',
      'sudo',
      'nerdctl',
      'image',
      'inspect',
      tag,
    ]);
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
  const rm = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'rm',
    '-rf',
    BUILD_CONTEXT_VM_DIR,
  ]);
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
  const chmod = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'chmod',
    '+x',
    cliVmPath,
    daemonVmPath,
  ]);
  if (chmod.exitCode !== 0) {
    throw limactlError(`failed to chmod binaries in ${vmName}`, chmod);
  }

  // 4. Disk guard: prune dangling images/containers/build cache before build.
  const prune = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'nerdctl',
    'system',
    'prune',
    '-af',
  ]);
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
    `VERSION=${TIER5_VERSION}`,
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
