/**
 * Is a container runtime usable in this environment?
 *
 * Suites that need a container must **skip loudly**, not fail: an environment
 * without a runtime has not broken anything, it simply cannot cover that
 * surface. A failure there is indistinguishable from a real regression, which
 * is what made the Linux dev host look like it had four broken suites (ADR-028
 * §5).
 *
 * The probe is deliberately **synchronous**. `describe.skipIf` needs its
 * condition at module scope, before any `beforeAll` has run, so an async probe
 * would force every caller through a preload and make the skip depend on load
 * order. One cached `spawnSync` per process is the cheaper trade.
 *
 * Skipping is not the same as passing. The quality gate reports skipped
 * surfaces and exits non-zero — see `run-mirror-body.ts`.
 */

import { spawnSync } from 'node:child_process';
import { describe } from 'bun:test';
import { containerRuntime, CONTAINER_RUNTIME_ENV } from './runtime.js';

export interface ContainerRuntimeStatus {
  /** The binary that was probed. */
  runtime: string;
  /** Whether `<runtime> version` succeeded — i.e. a daemon/engine answered. */
  available: boolean;
  /** Human-readable explanation when unavailable. */
  reason?: string;
}

let cached: ContainerRuntimeStatus | undefined;

/**
 * Probe the configured container runtime, caching the result for the process.
 *
 * Uses `version` rather than merely checking `$PATH`: with Docker the CLI can
 * be installed while the daemon is down, and that must read as unavailable.
 */
export function containerRuntimeStatus(): ContainerRuntimeStatus {
  if (cached) return cached;

  const runtime = containerRuntime();
  const result = spawnSync(runtime, ['version'], { stdio: 'ignore', timeout: 30000 });

  if (result.error) {
    const isMissing = (result.error as NodeJS.ErrnoException).code === 'ENOENT';
    cached = {
      runtime,
      available: false,
      reason: isMissing
        ? `'${runtime}' is not on $PATH (set ${CONTAINER_RUNTIME_ENV} to choose another runtime)`
        : `'${runtime} version' could not be run: ${result.error.message}`,
    };
  } else if (result.status !== 0) {
    cached = {
      runtime,
      available: false,
      reason: `'${runtime} version' exited ${result.status ?? 'null'} — the engine is installed but not responding`,
    };
  } else {
    cached = { runtime, available: true };
  }

  return cached;
}

/** Convenience predicate over {@link containerRuntimeStatus}. */
export function isContainerRuntimeAvailable(): boolean {
  return containerRuntimeStatus().available;
}

const announced = new Set<string>();

/**
 * `describe` for a suite that cannot run without a container runtime.
 *
 * Skips the whole suite — announcing why, once per reason — instead of throwing
 * from `beforeAll`.
 */
export function describeContainerSuite(title: string, body: () => void): void {
  const status = containerRuntimeStatus();

  if (!status.available && !announced.has(status.reason ?? '')) {
    announced.add(status.reason ?? '');
    console.warn(`[skip] container-runtime surface unavailable: ${status.reason}`);
  }

  describe.skipIf(!status.available)(title, body);
}
