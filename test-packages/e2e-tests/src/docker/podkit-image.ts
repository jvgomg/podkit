/**
 * Build the shipped podkit Docker image on the **host** Docker daemon.
 *
 * This is the host-side sibling of `buildPodkitImageInVm`
 * (`test-packages/device-testing/src/runners/lima-docker-image.ts`): that one
 * runs `nerdctl build` inside the Lima VM for the `usb-synth` (Tier-5) surface;
 * this one runs plain `docker build` on the dev host for the VM-free
 * `loopback-fat` (Tier-4) CLI surface. Both stage the exact context layout that
 * `packages/podkit-docker/Dockerfile` expects and key the per-arch `COPY` on
 * `TARGETARCH`.
 *
 * The image is `FROM alpine:3.21` (musl), so it copies the **musl** binaries —
 * the glibc ones cannot start in the container. Those binaries are produced by
 * `@podkit/device-testing#build:musl-binary` (the Lima Alpine builder VM) and
 * land on the host at `packages/podkit-{cli,daemon}/bin/*-linux-<suffix>-musl`.
 * Wiring that turbo task as a dependency of `test:e2e:docker-loopback` is what
 * keeps this a VM-free *runtime* while still sourcing real musl binaries.
 *
 * Single native arch only: a dev host's Docker Desktop runs one architecture,
 * so there is no buildx / QEMU / `--platform` juggling here.
 */

import { existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { runDockerCommand } from './container-manager.js';

/** Docker `TARGETARCH` values ↔ the `-<suffix>-musl` binary naming. */
type ImageArch = 'arm64' | 'amd64';

/** Resolve the repo root by walking up for the workspace marker (`turbo.json`). */
function repoRoot(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'turbo.json')) && existsSync(join(dir, 'bun.lock'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('podkit-image: could not locate repo root (no turbo.json + bun.lock ancestor)');
}

/** Map the host's `process.arch` to the image's `TARGETARCH`. */
function nativeImageArch(): ImageArch {
  switch (process.arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
      return 'amd64';
    default:
      throw new Error(`podkit-image: unsupported host arch '${process.arch}' (need arm64 or x64)`);
  }
}

/** Musl binary suffix for an image arch (`amd64` binaries are named `x64`). */
function muslSuffix(arch: ImageArch): 'arm64' | 'x64' {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function hostCliMuslBinary(arch: ImageArch): string {
  return resolve(
    repoRoot(),
    'packages',
    'podkit-cli',
    'bin',
    `podkit-linux-${muslSuffix(arch)}-musl`
  );
}

function hostDaemonMuslBinary(arch: ImageArch): string {
  return resolve(
    repoRoot(),
    'packages',
    'podkit-daemon',
    'bin',
    `podkit-daemon-linux-${muslSuffix(arch)}-musl`
  );
}

export interface BuildPodkitImageOptions {
  /** Image tag to produce. Default `podkit:loopback-test`. */
  tag?: string;
  /** Override the target arch. Defaults to the host's native arch. */
  arch?: ImageArch;
}

/**
 * Build the shipped image on the host Docker daemon and return its tag.
 *
 * Throws a pointed error if the required musl binaries are missing (they are a
 * turbo dependency of the test task, so this only fires when run ad-hoc).
 */
export async function buildPodkitImageOnHost(
  options: BuildPodkitImageOptions = {}
): Promise<string> {
  const arch = options.arch ?? nativeImageArch();
  const tag = options.tag ?? 'podkit:loopback-test';
  const root = repoRoot();

  const cliBin = hostCliMuslBinary(arch);
  const daemonBin = hostDaemonMuslBinary(arch);
  for (const [label, bin] of [
    ['podkit (CLI)', cliBin],
    ['podkit-daemon', daemonBin],
  ] as const) {
    if (!existsSync(bin)) {
      throw new Error(
        `podkit-image: missing musl binary for ${label}: ${bin}\n` +
          `Build it first: bunx turbo run build:musl-binary --filter @podkit/device-testing`
      );
    }
  }

  const dockerfile = resolve(root, 'packages', 'podkit-docker', 'Dockerfile');
  const entrypoint = resolve(root, 'packages', 'podkit-docker', 'entrypoint.sh');

  // Stage the minimal context the Dockerfile references: the recipe + entrypoint
  // under packages/podkit-docker/, and bin/<arch>/{podkit,podkit-daemon}.
  const ctx = mkdtempSync(join(tmpdir(), 'podkit-loopback-img-'));
  try {
    mkdirSync(join(ctx, 'packages', 'podkit-docker'), { recursive: true });
    mkdirSync(join(ctx, 'bin', arch), { recursive: true });
    copyFileSync(dockerfile, join(ctx, 'packages', 'podkit-docker', 'Dockerfile'));
    copyFileSync(entrypoint, join(ctx, 'packages', 'podkit-docker', 'entrypoint.sh'));
    copyFileSync(cliBin, join(ctx, 'bin', arch, 'podkit'));
    copyFileSync(daemonBin, join(ctx, 'bin', arch, 'podkit-daemon'));
    chmodSync(join(ctx, 'bin', arch, 'podkit'), 0o755);
    chmodSync(join(ctx, 'bin', arch, 'podkit-daemon'), 0o755);

    await runDockerCommand([
      'build',
      '--quiet',
      '--build-arg',
      `TARGETARCH=${arch}`,
      '--build-arg',
      'VERSION=loopback-test',
      '--build-arg',
      'CLI_VERSION=loopback-test',
      '--build-arg',
      'DAEMON_VERSION=loopback-test',
      '-f',
      join(ctx, 'packages', 'podkit-docker', 'Dockerfile'),
      '-t',
      tag,
      ctx,
    ]);
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }

  return tag;
}
