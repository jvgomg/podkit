/**
 * Host-side binary path resolvers for artefacts staged into a substrate.
 *
 * Each resolver reads an optional env override and otherwise falls back to the
 * per-arch default under the repo's build output tree (matching the Turbo
 * build layout).
 *
 * ## Why this lives in `@podkit/substrate` and not in `@podkit/lima`
 *
 * These paths name the artifacts that get installed *into a substrate*, and
 * the architecture in every one of those filenames is a property of the
 * substrate rather than of the provisioner that produced it or the host that
 * did the building. Lima is one provisioner; an SSH-reachable box is another,
 * and both need exactly these paths. The move follows the registry's, for the
 * same reason and with the same compatibility measure: `@podkit/lima`
 * re-exports everything here, so existing import sites resolve unchanged
 * (ADR-029 §1, §4).
 *
 * ## Architecture is resolved, not derived
 *
 * The suffix used to be `process.arch` mapped to a filename, which made an
 * amd64 artifact unnameable from an arm64 host. It now comes from
 * {@link targetArch}, which is substrate-derived when somebody resolved it and
 * host-defaulted when nobody did — see the bootstrapping note in
 * `./target-arch.ts` for why the resolvers below stay synchronous and never
 * probe anything themselves.
 *
 * @module
 */

import * as path from 'node:path';
import { repoRoot } from './paths.js';
import { targetArch } from './target-arch.js';

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
  const arch = targetArch(env);
  return path.resolve(repoRoot(), 'packages', 'podkit-cli', 'bin', `podkit-linux-${arch}`);
}

/**
 * Resolve the default host path to the compiled podkit-debug linux binary.
 *
 * Same shape as {@link resolveDefaultPodkitBinary} but for the dev-hooks-active
 * build (`bin/podkit-debug-linux-<arch>`). Reads `PODKIT_LINUX_DEBUG_BINARY` if
 * set; otherwise falls back to the per-arch default. See
 * `docs/architecture/dev-builds.md` for why the debug binary ships
 * side-by-side with the production one.
 */
export function resolveDefaultPodkitDebugBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['PODKIT_LINUX_DEBUG_BINARY'];
  if (override && override.length > 0) return override;
  const arch = targetArch(env);
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
  const arch = targetArch(env);
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
  const arch = targetArch(env);
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
  const arch = targetArch(env);
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
  const arch = targetArch(env);
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
  const arch = targetArch(env);
  return path.resolve(
    repoRoot(),
    'test-packages',
    'gpod-testing',
    'bin',
    `gpod-tool-linux-${arch}`
  );
}
