/**
 * Build (or pull) the shipped podkit image *inside* the device substrate, from
 * the local Dockerfile and the prebuilt musl binaries.
 *
 * Every step goes through a {@link SubstrateLink}, so the same code builds on a
 * Lima VM and on an SSH-reachable box.
 *
 * ## Provenance
 *
 * The image is the production recipe — `packages/podkit-docker/Dockerfile`,
 * `FROM alpine:3.21` — so it is always built from the **musl** binaries; the
 * glibc ones cannot start in it. Its architecture is the run's target
 * architecture, which is the substrate's: the same resolution that decided
 * which musl binaries the build produced, so the two cannot disagree.
 *
 * ## Runtime
 *
 * Always the substrate contract's, {@link SUBSTRATE_CONTRACT_RUNTIME}
 * (`substrate-contract.sh`): present on every substrate, and daemonless, so
 * there is nothing to start. Its image store is the one the surfaces run
 * from, so they drive the same runtime.
 *
 * Context layout staged in the guest (rooted at {@link BUILD_CONTEXT_VM_DIR}):
 *
 *   packages/podkit-docker/Dockerfile     — the build recipe (`-f` target)
 *   packages/podkit-docker/entrypoint.sh  — COPYed to /entrypoint.sh
 *   bin/<arch>/podkit                     — COPYed to /usr/local/bin/podkit
 *   bin/<arch>/podkit-daemon              — COPYed to /usr/local/bin/podkit-daemon
 *
 * The Dockerfile keys its per-arch COPY on `ARG TARGETARCH`. buildx sets that
 * from `--platform`; a plain single-arch build does not, so it is passed
 * explicitly.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FILE_COPY_TIMEOUT_MS,
  normalizeTargetArch,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultPodkitMuslBinary,
  targetArch,
  type SubstrateExecResult,
  type SubstrateLink,
} from '@podkit/substrate';

import { repoRoot } from './paths.js';
import { SUBSTRATE_ROUND_TRIP_TIMEOUT_MS, deviceSubstrateLink } from './substrate.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default image tag. */
export const DEFAULT_PODKIT_IMAGE_TAG = 'podkit:docker-dist';
/**
 * Env var that switches the image source from a local build to a pull. Set it
 * to a fully-qualified tag — e.g. `ghcr.io/jvgomg/podkit:rc` — to run the
 * shipped-image surfaces against the GHA-built artifact. Unset → local build.
 */
export const DOCKER_DIST_IMAGE_ENV = 'PODKIT_DOCKER_DIST_IMAGE';
/** Guest directory that holds the staged build context. */
export const BUILD_CONTEXT_VM_DIR = '/tmp/podkit-image-ctx';
/** Fixed VERSION build-arg for a local build (CI supplies the real one). */
const DOCKER_DIST_VERSION = '0.0.0-docker-dist';
/** Relative path (inside the context) of the Dockerfile, matching CI. */
const DOCKERFILE_REL = 'packages/podkit-docker/Dockerfile';
/** Relative path (inside the context) of the entrypoint, matching the Dockerfile COPY. */
const ENTRYPOINT_REL = 'packages/podkit-docker/entrypoint.sh';

/**
 * Bound for `<runtime> system prune -af`.
 *
 * The one step whose cost scales — with the image store and build cache. It
 * still scales gently, because clearing them is unlinking blobs rather than
 * moving bytes: measured at 267 ms against a 353 MB image plus its build cache.
 * The store cannot outgrow the substrate's 20 GB disk, so two minutes is
 * roughly two full-disk prunes of headroom; past it, the runtime is not
 * answering rather than the store being large.
 */
export const IMAGE_PRUNE_TIMEOUT_MS = 120_000;

/** The container runtime `substrate-contract.sh` guarantees on every substrate. */
export const SUBSTRATE_CONTRACT_RUNTIME = 'podman';

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

interface ImageOpts {
  /** Link to the substrate. Defaults to the selected device substrate. */
  link?: SubstrateLink;
}

/** Options for {@link buildPodkitImageInVm}. */
export interface BuildPodkitImageInVmOpts extends ImageOpts {
  /** Image tag. Defaults to {@link DEFAULT_PODKIT_IMAGE_TAG}. */
  tag?: string;
  /** Rebuild even if the tag already exists. */
  force?: boolean;
}

/** Result of a build or pull. */
export interface BuildPodkitImageInVmResult {
  /** The image tag that now exists in the substrate. */
  tag: string;
}

/** Options for {@link pullPodkitImageInVm}. */
export interface PullPodkitImageInVmOpts extends ImageOpts {
  /** Fully-qualified image tag to pull. */
  tag: string;
}

/** Options for {@link ensurePodkitImageInVm}. */
export interface EnsurePodkitImageInVmOpts extends ImageOpts {
  /** Tag for a local build (ignored on the pull path). */
  tag?: string;
  /** Force a fresh local build (ignored on the pull path). */
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guestFailure(what: string, link: SubstrateLink, result: SubstrateExecResult): Error {
  return new Error(
    `${what} in ${link.description} (exit=${result.exitCode}): ` +
      (result.stderr.trim() || result.stdout.trim() || '(no output)')
  );
}

/** Run a short housekeeping step, throwing on a non-zero exit. */
async function housekeep(link: SubstrateLink, argv: string[], what: string): Promise<void> {
  const result = await link.exec(argv, { timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS });
  if (result.exitCode !== 0) throw guestFailure(`failed to ${what}`, link, result);
}

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

/** Copy a single host file into the guest at `guestDest`, creating parent dirs first. */
async function stageFile(link: SubstrateLink, hostPath: string, guestDest: string): Promise<void> {
  const parent = path.posix.dirname(guestDest);
  await housekeep(link, ['mkdir', '-p', parent], `mkdir ${parent}`);
  // The largest payload is a ~120 MB compiled binary — exactly the case
  // `FILE_COPY_TIMEOUT_MS` is derived from.
  await link.copyIn(hostPath, guestDest, { timeoutMs: FILE_COPY_TIMEOUT_MS });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the shipped image inside the substrate.
 *
 * Unless `force`, skips when the tag already exists — so a caller that must
 * exercise the current binaries passes `force`.
 */
export async function buildPodkitImageInVm(
  opts: BuildPodkitImageInVmOpts = {}
): Promise<BuildPodkitImageInVmResult> {
  const runtime = SUBSTRATE_CONTRACT_RUNTIME;
  const link = opts.link ?? deviceSubstrateLink();
  const tag = opts.tag ?? DEFAULT_PODKIT_IMAGE_TAG;

  if (!opts.force) {
    const inspect = await link.exec(['sudo', runtime, 'image', 'inspect', tag], {
      timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS,
    });
    if (inspect.exitCode === 0) return { tag };
  }

  // The binaries were built for the run's target; the box behind the link is
  // the authority on whether they can start there.
  const target = targetArch();
  const uname = await link.exec(['uname', '-m'], { timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS });
  if (uname.exitCode !== 0) throw guestFailure('failed to read the architecture', link, uname);
  const machine = normalizeTargetArch(uname.stdout, `${link.description} \`uname -m\``);
  if (machine !== target) {
    throw new Error(
      `buildPodkitImageInVm: this run targets ${target}, but ${link.description} is ${machine}. ` +
        'Set PODKIT_TARGET_ARCH to match, or select the substrate the binaries were built for.'
    );
  }
  // Docker names the architectures `amd64`/`arm64`; the build names them `x64`/`arm64`.
  const imageArch = target === 'arm64' ? 'arm64' : 'amd64';
  const recipe: Array<[host: string, guestRel: string]> = [
    [path.resolve(repoRoot(), DOCKERFILE_REL), DOCKERFILE_REL],
    [path.resolve(repoRoot(), ENTRYPOINT_REL), ENTRYPOINT_REL],
  ];
  const binaries: Array<[host: string, guestRel: string]> = [
    [resolveDefaultPodkitMuslBinary(), `bin/${imageArch}/podkit`],
    [resolveDefaultDaemonLinuxMuslBinary(), `bin/${imageArch}/podkit-daemon`],
  ];
  const inputs = [...recipe, ...binaries];
  for (const [host] of inputs) {
    if (!fs.existsSync(host)) {
      throw new Error(
        `buildPodkitImageInVm: host file not found: ${host}\n` +
          'Build the musl binaries first: bunx turbo run build:musl-binary --filter @podkit/device-testing'
      );
    }
  }

  const cliVersion = await readPackageVersion(
    path.resolve(repoRoot(), 'packages', 'podkit-cli', 'package.json')
  );
  const daemonVersion = await readPackageVersion(
    path.resolve(repoRoot(), 'packages', 'podkit-daemon', 'package.json')
  );

  // A fresh context every time, so a stale binary cannot leak into the build.
  await housekeep(link, ['rm', '-rf', BUILD_CONTEXT_VM_DIR], `clear ${BUILD_CONTEXT_VM_DIR}`);
  for (const [host, guestRel] of inputs) {
    await stageFile(link, host, path.posix.join(BUILD_CONTEXT_VM_DIR, guestRel));
  }
  // Neither link preserves the host mode.
  const staged = binaries.map(([, rel]) => path.posix.join(BUILD_CONTEXT_VM_DIR, rel));
  await housekeep(link, ['chmod', '+x', ...staged], 'chmod the staged binaries');

  // Disk guard: the substrate's disk is small, and every build leaves layers.
  const prune = await link.exec(['sudo', runtime, 'system', 'prune', '-af'], {
    timeoutMs: IMAGE_PRUNE_TIMEOUT_MS,
  });
  if (prune.exitCode !== 0) throw guestFailure(`${runtime} system prune failed`, link, prune);

  // No `timeoutMs`: a cold build pulls the Alpine base over the network and
  // writes ~230 MB of layers. The network leg is not something a wall clock
  // can bound honestly, and aborting mid-flight leaves a partial image.
  const build = await link.exec(
    [
      'sudo',
      runtime,
      'build',
      '--build-arg',
      `VERSION=${DOCKER_DIST_VERSION}`,
      '--build-arg',
      `CLI_VERSION=${cliVersion}`,
      '--build-arg',
      `DAEMON_VERSION=${daemonVersion}`,
      '--build-arg',
      `BUILD_DATE=${new Date().toISOString()}`,
      '--build-arg',
      `TARGETARCH=${imageArch}`,
      '-t',
      tag,
      '-f',
      DOCKERFILE_REL,
      '.',
    ],
    { cwd: BUILD_CONTEXT_VM_DIR }
  );
  if (build.exitCode !== 0) {
    const tail = (build.stderr || build.stdout).trim().split('\n').slice(-25).join('\n');
    throw new Error(
      `buildPodkitImageInVm: ${runtime} build failed in ${link.description} ` +
        `(exit=${build.exitCode}):\n${tail}`
    );
  }

  return { tag };
}

/**
 * Pull a pre-built image into the substrate. `ghcr.io/jvgomg/podkit` is public,
 * so the pull is anonymous.
 */
export async function pullPodkitImageInVm(
  opts: PullPodkitImageInVmOpts
): Promise<BuildPodkitImageInVmResult> {
  const tag = opts.tag?.trim();
  if (!tag) throw new Error('pullPodkitImageInVm: a non-empty image tag is required');
  const link = opts.link ?? deviceSubstrateLink();

  // Unbounded, for the same reason as the build: a registry fetch of a
  // multi-hundred-megabyte image over whatever link the developer is on.
  const pull = await link.exec(['sudo', SUBSTRATE_CONTRACT_RUNTIME, 'pull', tag]);
  if (pull.exitCode !== 0) throw guestFailure(`failed to pull image ${tag}`, link, pull);

  return { tag };
}

/**
 * Fail with the remedy when the substrate predates the contract's container
 * runtime, rather than with `sudo: podman: command not found` mid-build.
 */
async function requireContractRuntime(link: SubstrateLink): Promise<void> {
  const probe = await link.exec(['sh', '-c', `command -v ${SUBSTRATE_CONTRACT_RUNTIME}`], {
    timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS,
  });
  if (probe.exitCode !== 0) {
    throw new Error(
      `${link.description} has no ${SUBSTRATE_CONTRACT_RUNTIME}, the substrate contract's ` +
        'container runtime. Re-apply the contract: `bun run harness:setup` on a Lima ' +
        'substrate, or docs/environments/device-substrate-proxmox.md §5 on a remote one.'
    );
  }
}

/**
 * Resolve the image a shipped-image surface runs against, honouring
 * {@link DOCKER_DIST_IMAGE_ENV}: set → pull that tag; unset → build locally.
 *
 * @returns the tag the container steps must reference.
 */
export async function ensurePodkitImageInVm(opts: EnsurePodkitImageInVmOpts = {}): Promise<string> {
  const link = opts.link ?? deviceSubstrateLink();
  await requireContractRuntime(link);
  const override = process.env[DOCKER_DIST_IMAGE_ENV]?.trim();
  if (override) {
    return (await pullPodkitImageInVm({ tag: override, link })).tag;
  }
  return (await buildPodkitImageInVm({ ...opts, link })).tag;
}
