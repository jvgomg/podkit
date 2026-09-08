/**
 * The container runtime this package shells out to.
 *
 * Every container command in `@podkit/e2e-tests` funnels through
 * {@link runContainerCommand}, so the runtime binary is chosen in exactly one
 * place. This module deliberately has no imports from the rest of `docker/`:
 * `container-manager` and `container-registry` both need the spawn primitive,
 * and a shared leaf module is what lets them have it without an import cycle
 * (the cycle is why the primitive used to be copy-pasted into both).
 *
 * See docs/environments/linux-dev-host.md for the Podman-specific host setup,
 * and ADR-028 for why the Linux dev host runs this surface locally at all.
 */

import { spawn, spawnSync } from 'node:child_process';

/** Environment variable selecting the container runtime binary. */
export const CONTAINER_RUNTIME_ENV = 'PODKIT_CONTAINER_RUNTIME';

/** Runtime used when {@link CONTAINER_RUNTIME_ENV} is unset. */
export const DEFAULT_CONTAINER_RUNTIME = 'docker';

/**
 * The container runtime binary to invoke — `docker` unless
 * `PODKIT_CONTAINER_RUNTIME` says otherwise (`podman` is the tested
 * alternative).
 *
 * Read per call rather than cached at module load so a test can set the
 * variable after import without the value being frozen behind it.
 */
export function containerRuntime(): string {
  const configured = process.env[CONTAINER_RUNTIME_ENV]?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_CONTAINER_RUNTIME;
}

/**
 * Run a container-runtime command and resolve with stdout.
 *
 * Rejects on any non-zero exit. Callers that need the exit code instead of an
 * exception spawn {@link containerRuntime} directly.
 */
export function runContainerCommand(args: string[]): Promise<string> {
  const runtime = containerRuntime();

  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${runtime} command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/** Cached rootlessness probe result, populated once per process. */
let rootlessCache: boolean | null = null;

/**
 * Is the configured runtime rootless — i.e. does a container's `root` map to
 * the invoking user on the host rather than to the host's real root?
 *
 * This is the difference that decides file ownership on a bind mount. Rootless
 * Podman (the Linux dev host, see docs/environments/linux-dev-host.md) writes
 * container-root files as the invoking user, so the harness can clean them up.
 * Rootful Docker (GitHub runners) writes them as real root, and the test user
 * then cannot unlink them.
 *
 * Probed rather than inferred from the runtime's *name*: rootless Docker and
 * rootful Podman both exist, so `docker` vs `podman` is not the question being
 * asked. Podman exposes the answer directly; Docker only surfaces it inside
 * `SecurityOptions`.
 *
 * On an unreadable answer this reports rootless, which is the fail-safe
 * direction: it preserves the behaviour every caller had before this existed,
 * so a runtime we cannot interrogate is never made worse than it was.
 */
export function isRootlessRuntime(): boolean {
  if (rootlessCache !== null) return rootlessCache;

  const podman = runtimeInfo('{{.Host.Security.Rootless}}');
  if (podman.ok && (podman.out === 'true' || podman.out === 'false')) {
    return (rootlessCache = podman.out === 'true');
  }

  const docker = runtimeInfo('{{.SecurityOptions}}');
  if (docker.ok) {
    return (rootlessCache = /name=rootless/.test(docker.out));
  }

  return (rootlessCache = true);
}

/** `<runtime> info --format <format>`, reduced to success plus trimmed stdout. */
function runtimeInfo(format: string): { ok: boolean; out: string } {
  const result = spawnSync(containerRuntime(), ['info', '--format', format], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
}

/**
 * `uid:gid` of the current process, or null where the platform has no such
 * concept (Windows) — in which case the caller must not pass `--user`.
 */
export function hostUserSpec(): string | null {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? null : `${uid}:${gid}`;
}
