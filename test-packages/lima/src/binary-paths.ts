/**
 * Host-side binary path resolvers for artefacts staged into the Lima VMs.
 *
 * Each resolver reads an optional env override and otherwise falls back to the
 * per-arch default under the repo's build output tree (matching the Turbo
 * build layout). Architecture is a runtime concern here: the suffix comes from
 * the host's `process.arch`, mapped to Bun's `arm64`/`x64` filename convention.
 *
 * @module
 */

import * as path from 'node:path';
import { repoRoot } from './paths.js';

/**
 * Map Node.js `process.arch` to the suffix used in Linux binary filenames.
 * The VMs are `aarch64` on Apple Silicon hosts and `x86_64` on Intel; binary
 * filenames use `arm64` and `x64` (Bun's convention).
 */
export function vmArch(): 'arm64' | 'x64' {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Resolve the default host path to the compiled podkit linux binary.
 *
 * Reads `PODKIT_LINUX_BINARY` if set; otherwise falls back to the per-arch
 * default at `packages/podkit-cli/bin/podkit-linux-<arch>` (matching the
 * Turbo build output).
 */
export function resolveDefaultPodkitBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_LINUX_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(repoRoot(), 'packages', 'podkit-cli', 'bin', `podkit-linux-${arch}`);
}

/**
 * Resolve the default host path to the compiled podkit-debug linux binary.
 *
 * Same shape as {@link resolveDefaultPodkitBinary} but for the dev-hooks-active
 * build (`bin/podkit-debug-linux-<arch>`). Reads `PODKIT_LINUX_DEBUG_BINARY` if
 * set; otherwise falls back to the per-arch default. See
 * `documents/architecture/dev-builds.md` for why the debug binary ships
 * side-by-side with the production one.
 */
export function resolveDefaultPodkitDebugBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_LINUX_DEBUG_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(repoRoot(), 'packages', 'podkit-cli', 'bin', `podkit-debug-linux-${arch}`);
}

/**
 * Resolve the default host path to the compiled podkit-daemon linux binary.
 *
 * Mirrors {@link resolveDefaultPodkitBinary} for the background sync daemon.
 * Reads `PODKIT_DAEMON_LINUX_BINARY` if set; otherwise falls back to the
 * per-arch default at `packages/podkit-daemon/bin/podkit-daemon-linux-<arch>`
 * (matching the Turbo build output). Used when staging the Docker build
 * context inside the VM.
 */
export function resolveDefaultDaemonLinuxBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_DAEMON_LINUX_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(
    repoRoot(),
    'packages',
    'podkit-daemon',
    'bin',
    `podkit-daemon-linux-${arch}`
  );
}

/**
 * Resolve the default host path to the compiled **musl** podkit linux binary.
 *
 * The podkit Docker image is `FROM alpine:3.21` (musl), so anything COPYed into
 * it must be musl-linked — the glibc binaries above cannot start there. Reads
 * `PODKIT_LINUX_MUSL_BINARY` if set; otherwise falls back to the per-arch
 * default at `packages/podkit-cli/bin/podkit-linux-<arch>-musl` (the
 * `build:musl-binary` output).
 */
export function resolveDefaultPodkitMuslBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_LINUX_MUSL_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(repoRoot(), 'packages', 'podkit-cli', 'bin', `podkit-linux-${arch}-musl`);
}

/**
 * Resolve the default host path to the compiled **musl** podkit-daemon linux
 * binary. Mirrors {@link resolveDefaultPodkitMuslBinary} for the daemon. Reads
 * `PODKIT_DAEMON_LINUX_MUSL_BINARY` if set; otherwise the per-arch default at
 * `packages/podkit-daemon/bin/podkit-daemon-linux-<arch>-musl`.
 */
export function resolveDefaultDaemonLinuxMuslBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_DAEMON_LINUX_MUSL_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(
    repoRoot(),
    'packages',
    'podkit-daemon',
    'bin',
    `podkit-daemon-linux-${arch}-musl`
  );
}

/** Resolve the host path of the dummy-hcd-daemon binary (per arch). */
export function resolveDefaultDummyHcdDaemonBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_DUMMY_HCD_DAEMON_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(
    repoRoot(),
    'test-packages',
    'device-testing-daemon',
    'dist',
    `dummy-hcd-daemon-linux-${arch}`
  );
}

/**
 * Resolve the host path of the gpod-tool linux binary.
 *
 * gpod-tool is a REQUIRED part of the device-testing harness. The default
 * resolves to the per-arch output of the
 * `@podkit/gpod-testing#build:linux-binary` turbo task. The
 * `PODKIT_GPOD_TOOL_BINARY` env var remains an optional override for
 * developers pointing at a custom build.
 */
export function resolveDefaultGpodToolBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_GPOD_TOOL_BINARY'];
  if (override && override.length > 0) return override;
  const arch = vmArch();
  return path.resolve(
    repoRoot(),
    'test-packages',
    'gpod-testing',
    'bin',
    `gpod-tool-linux-${arch}`
  );
}
