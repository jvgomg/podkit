#!/usr/bin/env bun
/**
 * Build the dummy-hcd daemon into a standalone Linux binary.
 *
 * ```
 *   bun scripts/build.ts                # the run's target arch (PODKIT_TARGET_ARCH, else host)
 *   bun scripts/build.ts linux-x64      # explicit target
 *   bun scripts/build.ts linux-arm64
 *   bun scripts/build.ts all            # both
 * ```
 *
 * Output: `dist/dummy-hcd-daemon-linux-<arch>`. Bun cross-compiles from macOS,
 * so no builder VM is needed.
 */

import { chmodSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

import { envWithRepoDotfile } from '@podkit/substrate';

import { resolveBuildTargets } from '../src/build-targets.js';

const daemonDir = path.resolve(import.meta.dir, '..');
const entry = path.join(daemonDir, 'src', 'main.ts');
const outDir = path.join(daemonDir, 'dist');

let targets;
try {
  targets = resolveBuildTargets({
    arg: process.argv[2],
    env: envWithRepoDotfile(),
    hostArch: process.arch,
  });
} catch (err) {
  console.error(`ERROR: ${(err as Error).message}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const target of targets) {
  const outfile = path.join(outDir, `dummy-hcd-daemon-${target}`);
  console.log(`==> bun build --compile --target=bun-${target} → ${outfile}`);
  const build = Bun.spawnSync(
    ['bun', 'build', '--compile', `--target=bun-${target}`, entry, '--outfile', outfile],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
  chmodSync(outfile, 0o755);
}
console.log('OK: build complete.');
