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

import { spawn } from 'node:child_process';

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
