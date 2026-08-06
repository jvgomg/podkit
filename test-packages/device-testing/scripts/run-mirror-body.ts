#!/usr/bin/env bun
/**
 * The single two-phase "mirror" body that both `quality` and `quality:rc`
 * share.
 *
 * The quality suite runs the same surfaces regardless of *where* its assets
 * come from — the only difference between a local check and a
 * release-candidate check is the value of a handful of override environment
 * variables (`PODKIT_CLI_BINARY`, `PODKIT_LINUX_BINARY`,
 * `PODKIT_DOCKER_DIST_IMAGE`). To guarantee the two commands can never drift in
 * *which* surfaces run, both funnel through this one body:
 *
 *   Phase 1 — `turbo run qa` (lint, typecheck, build, unit, integration, host
 *             e2e, host-docker source e2e, and the VM suite `test:vm`).
 *   Phase 2 — `turbo run test:e2e:docker-dist test:e2e:docker-loopback` (the two
 *             shipped-image surfaces).
 *
 * Phase 2 is serialized after phase 1 because `test:vm` and `docker-dist` share
 * the one Lima harness VM and collide if driven concurrently.
 *
 * This module is asset-source agnostic: it never sets any `PODKIT_*` override
 * itself. The caller assembles the environment (local build outputs for
 * `quality`; fetched release-candidate artefacts for `quality:rc`) and then
 * invokes {@link runMirrorBody}, which spawns turbo with the ambient
 * environment inherited. Any extra CLI arguments are forwarded verbatim to both
 * phases so passthrough flags (`--force`, `-- --concurrency=N`, `--dry-run`)
 * reach turbo exactly as they did when this was an inline shell one-liner.
 *
 * @module
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: scripts/ → device-testing/ → test-packages/ → repo root. */
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

/** Phase 1 — the standard quality DAG (includes `test:vm`). */
const PHASE_1_TASKS = ['qa'];
/** Phase 2 — the two shipped-image surfaces, serialized after phase 1. */
const PHASE_2_TASKS = ['test:e2e:docker-dist', 'test:e2e:docker-loopback'];

/** Spawn `turbo run <tasks> <extraArgs>` from the repo root, inheriting stdio. */
async function runTurbo(tasks: string[], extraArgs: string[]): Promise<number> {
  const proc = Bun.spawn(['bunx', 'turbo', 'run', ...tasks, ...extraArgs], {
    cwd: REPO_ROOT,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  return proc.exited;
}

/**
 * Run the two-phase mirror body. Phase 2 only runs if phase 1 succeeds; the
 * first non-zero exit code short-circuits and is returned. `extraArgs` is
 * forwarded to both phases.
 */
export async function runMirrorBody(extraArgs: string[] = []): Promise<number> {
  const phase1 = await runTurbo(PHASE_1_TASKS, extraArgs);
  if (phase1 !== 0) return phase1;
  return runTurbo(PHASE_2_TASKS, extraArgs);
}

// Runnable directly as the `quality` body: `bun run-mirror-body.ts [args…]`.
if (import.meta.main) {
  runMirrorBody(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[quality] unexpected error: ${msg}\n`);
      process.exit(1);
    });
}
